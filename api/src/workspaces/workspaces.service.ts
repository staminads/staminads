import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickHouseService } from '../database/clickhouse.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import {
  Workspace,
  WorkspaceSettings,
  DEFAULT_WORKSPACE_SETTINGS,
} from './entities/workspace.entity';
import {
  Integration,
  AnthropicIntegration,
} from './entities/integration.entity';
import { encryptApiKey, generateId } from '../common/crypto';

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
}

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

interface WorkspaceRow extends Omit<Workspace, 'settings'> {
  settings: string; // JSON string from ClickHouse
}

function parseWorkspace(row: WorkspaceRow): Workspace {
  const settings = row.settings
    ? (JSON.parse(row.settings) as Partial<WorkspaceSettings>)
    : {};

  return {
    id: row.id,
    name: row.name,
    website: row.website,
    timezone: row.timezone,
    currency: row.currency,
    logo_url: row.logo_url,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    settings: {
      ...DEFAULT_WORKSPACE_SETTINGS,
      ...settings,
    },
  };
}

function serializeWorkspace(
  workspace: Workspace,
): Omit<Workspace, 'settings'> & { settings: string } {
  return {
    id: workspace.id,
    name: workspace.name,
    website: workspace.website,
    timezone: workspace.timezone,
    currency: workspace.currency,
    logo_url: workspace.logo_url,
    status: workspace.status,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    settings: JSON.stringify(workspace.settings),
  };
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly configService: ConfigService,
  ) {}

  async list(user: CurrentUser): Promise<Workspace[]> {
    // Super admins see all workspaces
    if (user.isSuperAdmin) {
      const rows = await this.clickhouse.querySystem<WorkspaceRow>(
        `SELECT * FROM workspaces
         WHERE (id, updated_at) IN (
           SELECT id, max(updated_at) FROM workspaces GROUP BY id
         )
         ORDER BY created_at DESC`,
      );
      return rows.map(parseWorkspace);
    }

    // Regular users only see workspaces they are members of
    const rows = await this.clickhouse.querySystem<WorkspaceRow>(
      `SELECT * FROM workspaces
       WHERE id IN (
         SELECT workspace_id FROM workspace_memberships FINAL
         WHERE user_id = {userId:String}
       )
       AND (id, updated_at) IN (
         SELECT id, max(updated_at) FROM workspaces GROUP BY id
       )
       ORDER BY created_at DESC`,
      { userId: user.id },
    );
    return rows.map(parseWorkspace);
  }

  async get(id: string): Promise<Workspace> {
    // Use ORDER BY updated_at DESC LIMIT 1 to handle ClickHouse async DELETE race condition
    // During mutations, there may be duplicate rows temporarily
    const rows = await this.clickhouse.querySystem<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE id = {id:String} ORDER BY updated_at DESC LIMIT 1',
      { id },
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Workspace ${id} not found`);
    }
    return parseWorkspace(rows[0]);
  }

  async create(dto: CreateWorkspaceDto, user: CurrentUser): Promise<Workspace> {
    // Only super admins can create workspaces
    if (!user.isSuperAdmin) {
      throw new ForbiddenException(
        'Only super admins can create new workspaces',
      );
    }

    const now = toClickHouseDateTime();

    // Build settings from dto.settings with defaults
    const settings: WorkspaceSettings = {
      ...DEFAULT_WORKSPACE_SETTINGS,
      ...(dto.settings || {}),
    };

    const workspace: Workspace = {
      id: dto.id,
      name: dto.name,
      website: dto.website,
      timezone: dto.timezone,
      currency: dto.currency,
      logo_url: dto.logo_url,
      status: 'initializing',
      created_at: now,
      updated_at: now,
      settings,
    };

    // 1. Create workspace database first
    // If this fails, we don't insert the workspace row (returns 500)
    await this.clickhouse.createWorkspaceDatabase(dto.id);

    // 2. Insert workspace row into system database
    await this.clickhouse.insertSystem('workspaces', [
      serializeWorkspace(workspace),
    ]);

    // 3. Add creator as owner to workspace_memberships
    await this.clickhouse.insertSystem('workspace_memberships', [
      {
        id: generateId(),
        workspace_id: dto.id,
        user_id: user.id,
        role: 'owner',
        invited_by: null,
        joined_at: now,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Status remains 'initializing' until first event is received
    return workspace;
  }

  async update(dto: UpdateWorkspaceDto): Promise<Workspace> {
    const workspace = await this.get(dto.id);

    // Merge settings if provided
    let updatedSettings = workspace.settings;
    if (dto.settings) {
      // Encrypt API keys in integrations if provided
      if (dto.settings.integrations) {
        dto.settings.integrations = this.encryptIntegrationKeys(
          dto.settings.integrations,
          dto.id,
        );
      }

      updatedSettings = {
        ...workspace.settings,
        ...dto.settings,
      };
    }

    const updated: Workspace = {
      id: workspace.id,
      name: dto.name ?? workspace.name,
      website: dto.website ?? workspace.website,
      timezone: dto.timezone ?? workspace.timezone,
      currency: dto.currency ?? workspace.currency,
      logo_url: dto.logo_url ?? workspace.logo_url,
      status: dto.status ?? workspace.status,
      created_at: workspace.created_at,
      updated_at: toClickHouseDateTime(),
      settings: updatedSettings,
    };

    // ClickHouse uses ALTER TABLE for updates, but for simplicity we delete and re-insert
    await this.clickhouse.commandSystem(
      `ALTER TABLE workspaces DELETE WHERE id = '${dto.id}'`,
    );
    await this.clickhouse.insertSystem('workspaces', [
      serializeWorkspace(updated),
    ]);
    return updated;
  }

  /**
   * Encrypt API keys in integrations that are not already encrypted.
   * Encrypted keys contain ':' separators (format: iv:authTag:data).
   */
  private encryptIntegrationKeys(
    integrations: Integration[],
    workspaceId: string,
  ): Integration[] {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')!;

    return integrations.map((integration) => {
      if (integration.type === 'anthropic') {
        const anthropic = integration;
        const apiKey = anthropic.settings.api_key_encrypted;
        // Only encrypt if it's a new key (not already encrypted)
        // Encrypted format is iv:authTag:data, so it contains ':'
        if (apiKey && !apiKey.includes(':')) {
          anthropic.settings.api_key_encrypted = encryptApiKey(
            apiKey,
            encryptionKey,
            workspaceId,
          );
        }
      }
      return integration;
    });
  }

  async delete(id: string): Promise<void> {
    // Verify workspace exists
    const rows = await this.clickhouse.querySystem<Workspace>(
      'SELECT id FROM workspaces WHERE id = {id:String}',
      { id },
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Workspace ${id} not found`);
    }

    // 1. Drop workspace database (cascades to all tables)
    await this.clickhouse.dropWorkspaceDatabase(id);

    // 2. Delete workspace row from system database
    await this.clickhouse.commandSystem(
      `ALTER TABLE workspaces DELETE WHERE id = '${id}'`,
    );
  }
}

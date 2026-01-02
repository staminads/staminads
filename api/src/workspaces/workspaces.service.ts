import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickHouseService } from '../database/clickhouse.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { Workspace, CustomDimensionLabels } from './entities/workspace.entity';
import { FilterDefinition } from '../filters/entities/filter.entity';
import { Integration, AnthropicIntegration } from './entities/integration.entity';
import { encryptApiKey } from '../common/crypto';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Default custom dimension labels for new workspaces.
 */
const DEFAULT_CUSTOM_DIMENSION_LABELS: CustomDimensionLabels = {
  '1': 'Channel Group',
  '2': 'Channel',
};

/**
 * Default geo settings for new workspaces.
 */
const DEFAULT_GEO_SETTINGS = {
  geo_enabled: true,
  geo_store_city: true,
  geo_store_region: true,
  geo_coordinates_precision: 2,
};

interface WorkspaceRow
  extends Omit<Workspace, 'custom_dimensions' | 'filters' | 'integrations'> {
  custom_dimensions: string; // JSON string from ClickHouse
  filters: string; // JSON string from ClickHouse
  integrations: string; // JSON string from ClickHouse
}

function parseWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...row,
    custom_dimensions: row.custom_dimensions
      ? (JSON.parse(row.custom_dimensions) as CustomDimensionLabels)
      : null,
    filters: row.filters ? (JSON.parse(row.filters) as FilterDefinition[]) : [],
    integrations: row.integrations
      ? (JSON.parse(row.integrations) as Integration[])
      : [],
  };
}

function serializeWorkspace(
  workspace: Workspace,
): Omit<Workspace, 'custom_dimensions' | 'filters' | 'integrations'> & {
  custom_dimensions: string;
  filters: string;
  integrations: string;
} {
  return {
    ...workspace,
    custom_dimensions: JSON.stringify(workspace.custom_dimensions ?? {}),
    filters: JSON.stringify(workspace.filters ?? []),
    integrations: JSON.stringify(workspace.integrations ?? []),
  };
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly configService: ConfigService,
  ) {}

  async list(): Promise<Workspace[]> {
    // Use subquery with argMax to get latest version of each workspace
    // This handles ClickHouse async DELETE race condition
    const rows = await this.clickhouse.querySystem<WorkspaceRow>(
      `SELECT * FROM workspaces
       WHERE (id, updated_at) IN (
         SELECT id, max(updated_at) FROM workspaces GROUP BY id
       )
       ORDER BY created_at DESC`,
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

  async create(dto: CreateWorkspaceDto): Promise<Workspace> {
    const now = toClickHouseDateTime();
    const workspace: Workspace = {
      ...dto,
      created_at: now,
      updated_at: now,
      timescore_reference: 60,
      bounce_threshold: dto.bounce_threshold ?? 10,
      status: 'initializing',
      custom_dimensions: DEFAULT_CUSTOM_DIMENSION_LABELS,
      filters: [],
      integrations: [],
      // Geo settings with defaults
      geo_enabled: dto.geo_enabled ?? DEFAULT_GEO_SETTINGS.geo_enabled,
      geo_store_city: dto.geo_store_city ?? DEFAULT_GEO_SETTINGS.geo_store_city,
      geo_store_region:
        dto.geo_store_region ?? DEFAULT_GEO_SETTINGS.geo_store_region,
      geo_coordinates_precision:
        dto.geo_coordinates_precision ??
        DEFAULT_GEO_SETTINGS.geo_coordinates_precision,
    };

    // 1. Create workspace database first
    // If this fails, we don't insert the workspace row (returns 500)
    await this.clickhouse.createWorkspaceDatabase(dto.id);

    // 2. Insert workspace row into system database
    await this.clickhouse.insertSystem('workspaces', [
      serializeWorkspace(workspace),
    ]);

    // Status remains 'initializing' until first event is received
    return workspace;
  }

  async update(dto: UpdateWorkspaceDto): Promise<Workspace> {
    const workspace = await this.get(dto.id);

    // Encrypt API keys in integrations if provided
    if (dto.integrations) {
      dto.integrations = this.encryptIntegrationKeys(dto.integrations, dto.id);
    }

    // Filter out undefined and empty string values from dto
    // This prevents accidental overwrites when frontend sends empty strings
    const cleanDto = Object.fromEntries(
      Object.entries(dto).filter(
        ([_, v]) => v !== undefined && v !== '',
      ),
    ) as Partial<UpdateWorkspaceDto>;

    const updated: Workspace = {
      ...workspace,
      ...cleanDto,
      updated_at: toClickHouseDateTime(),
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
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    return integrations.map((integration) => {
      if (integration.type === 'anthropic') {
        const anthropic = integration as AnthropicIntegration;
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { Workspace, CustomDimensionLabels } from './entities/workspace.entity';
import { FilterDefinition } from '../filters/entities/filter.entity';

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

interface WorkspaceRow extends Omit<Workspace, 'custom_dimensions' | 'filters'> {
  custom_dimensions: string; // JSON string from ClickHouse
  filters: string; // JSON string from ClickHouse
}

function parseWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...row,
    custom_dimensions: row.custom_dimensions
      ? (JSON.parse(row.custom_dimensions) as CustomDimensionLabels)
      : null,
    filters: row.filters
      ? (JSON.parse(row.filters) as FilterDefinition[])
      : [],
  };
}

function serializeWorkspace(
  workspace: Workspace,
): Omit<Workspace, 'custom_dimensions' | 'filters'> & { custom_dimensions: string; filters: string } {
  return {
    ...workspace,
    custom_dimensions: JSON.stringify(workspace.custom_dimensions ?? {}),
    filters: JSON.stringify(workspace.filters ?? []),
  };
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async list(): Promise<Workspace[]> {
    const rows = await this.clickhouse.querySystem<WorkspaceRow>(
      'SELECT * FROM workspaces ORDER BY created_at DESC',
    );
    return rows.map(parseWorkspace);
  }

  async get(id: string): Promise<Workspace> {
    const rows = await this.clickhouse.querySystem<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE id = {id:String}',
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
      status: 'initializing',
      custom_dimensions: DEFAULT_CUSTOM_DIMENSION_LABELS,
      filters: [],
    };

    // 1. Create workspace database first
    // If this fails, we don't insert the workspace row (returns 500)
    await this.clickhouse.createWorkspaceDatabase(dto.id);

    // 2. Insert workspace row into system database
    await this.clickhouse.insertSystem('workspaces', [
      serializeWorkspace(workspace),
    ]);

    // 3. Update status to active
    await this.clickhouse.commandSystem(
      `ALTER TABLE workspaces UPDATE status = 'active', updated_at = now64(3) WHERE id = '${dto.id}'`,
    );

    return { ...workspace, status: 'active' };
  }

  async update(dto: UpdateWorkspaceDto): Promise<Workspace> {
    const workspace = await this.get(dto.id);
    const updated: Workspace = {
      ...workspace,
      ...dto,
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

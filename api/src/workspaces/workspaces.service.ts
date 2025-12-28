import { Injectable, NotFoundException } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { Workspace } from './entities/workspace.entity';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async list(): Promise<Workspace[]> {
    return this.clickhouse.query<Workspace>(
      'SELECT * FROM workspaces ORDER BY created_at DESC',
    );
  }

  async get(id: string): Promise<Workspace> {
    const rows = await this.clickhouse.query<Workspace>(
      'SELECT * FROM workspaces WHERE id = {id:String}',
      { id },
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Workspace ${id} not found`);
    }
    return rows[0];
  }

  async create(dto: CreateWorkspaceDto): Promise<Workspace> {
    const now = toClickHouseDateTime();
    const workspace: Workspace = {
      ...dto,
      created_at: now,
      updated_at: now,
      timescore_reference: 60,
      status: 'initializing',
    };
    await this.clickhouse.insert('workspaces', [workspace]);
    return workspace;
  }

  async update(dto: UpdateWorkspaceDto): Promise<Workspace> {
    const workspace = await this.get(dto.id);
    const updated: Workspace = {
      ...workspace,
      ...dto,
      updated_at: toClickHouseDateTime(),
    };

    // ClickHouse uses ALTER TABLE for updates, but for simplicity we delete and re-insert
    await this.clickhouse.command(
      `ALTER TABLE workspaces DELETE WHERE id = '${dto.id}'`,
    );
    await this.clickhouse.insert('workspaces', [updated]);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const rows = await this.clickhouse.query<Workspace>(
      'SELECT id FROM workspaces WHERE id = {id:String}',
      { id },
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Workspace ${id} not found`);
    }
    await this.clickhouse.command(
      `ALTER TABLE workspaces DELETE WHERE id = '${id}'`,
    );
  }
}

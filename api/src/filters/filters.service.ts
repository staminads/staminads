import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import {
  FilterDefinition,
  FilterWithStaleness,
  FilterCondition,
  FilterOperation,
  VALID_SOURCE_FIELDS,
  VALID_WRITABLE_DIMENSIONS,
} from './entities/filter.entity';
import { CreateFilterDto } from './dto/create-filter.dto';
import { UpdateFilterDto } from './dto/update-filter.dto';
import { ReorderFiltersDto } from './dto/reorder-filters.dto';
import { TestFilterDto, TestFilterResult } from './dto/test-filter.dto';
import { computeFilterVersion, evaluateConditions } from './lib/filter-evaluator';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class FiltersService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * List all filters for a workspace with staleness info.
   * Optionally filter by tags.
   */
  async list(
    workspaceId: string,
    tags?: string[],
  ): Promise<FilterWithStaleness[]> {
    const workspace = await this.workspacesService.get(workspaceId);
    let filters = workspace.filters ?? [];

    // Filter by tags if provided
    if (tags && tags.length > 0) {
      filters = filters.filter((f) =>
        tags.some((tag) => f.tags.includes(tag)),
      );
    }

    // Sort by order
    filters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Get staleness info
    const staleness = await this.getStalenessInfo(workspaceId, workspace.filters ?? []);

    return filters.map((filter) => ({
      ...filter,
      staleSessionCount: staleness.staleSessionCount,
      totalSessionCount: staleness.totalSessionCount,
    }));
  }

  /**
   * Get a single filter by ID with staleness info.
   */
  async get(workspaceId: string, filterId: string): Promise<FilterWithStaleness> {
    const workspace = await this.workspacesService.get(workspaceId);
    const filter = (workspace.filters ?? []).find((f) => f.id === filterId);

    if (!filter) {
      throw new NotFoundException(
        `Filter ${filterId} not found in workspace ${workspaceId}`,
      );
    }

    const staleness = await this.getStalenessInfo(workspaceId, workspace.filters ?? []);
    return {
      ...filter,
      staleSessionCount: staleness.staleSessionCount,
      totalSessionCount: staleness.totalSessionCount,
    };
  }

  /**
   * Create a new filter.
   */
  async create(dto: CreateFilterDto): Promise<FilterDefinition> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const filters = workspace.filters ?? [];

    // Validate conditions and operations
    this.validateConditions(dto.conditions);
    this.validateOperations(dto.operations);

    const now = toClickHouseDateTime();
    const maxOrder = filters.reduce((max, f) => Math.max(max, f.order ?? 0), -1);

    const filter: FilterDefinition = {
      id: randomUUID(),
      name: dto.name,
      priority: dto.priority ?? 500,
      order: maxOrder + 1,
      tags: dto.tags ?? [],
      conditions: dto.conditions as unknown as FilterCondition[],
      operations: dto.operations as unknown as FilterOperation[],
      enabled: dto.enabled ?? true,
      version: '', // Will be computed below
      createdAt: now,
      updatedAt: now,
    };

    // Compute version after adding to list
    const updatedFilters = [...filters, filter];
    filter.version = computeFilterVersion(updatedFilters);

    await this.updateWorkspaceFilters(workspace, updatedFilters);

    // Invalidate cache
    this.eventEmitter.emit('filters.changed', {
      workspaceId: dto.workspace_id,
    });

    return filter;
  }

  /**
   * Update an existing filter.
   */
  async update(dto: UpdateFilterDto): Promise<FilterDefinition> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const filters = workspace.filters ?? [];

    const index = filters.findIndex((f) => f.id === dto.id);
    if (index === -1) {
      throw new NotFoundException(
        `Filter ${dto.id} not found in workspace ${dto.workspace_id}`,
      );
    }

    const existing = filters[index];

    // Validate conditions and operations if provided
    if (dto.conditions) {
      this.validateConditions(dto.conditions);
    }
    if (dto.operations) {
      this.validateOperations(dto.operations);
    }

    const updated: FilterDefinition = {
      ...existing,
      name: dto.name ?? existing.name,
      priority: dto.priority ?? existing.priority,
      order: dto.order ?? existing.order,
      tags: dto.tags ?? existing.tags,
      conditions: dto.conditions ? (dto.conditions as unknown as FilterCondition[]) : existing.conditions,
      operations: dto.operations ? (dto.operations as unknown as FilterOperation[]) : existing.operations,
      enabled: dto.enabled ?? existing.enabled,
      updatedAt: toClickHouseDateTime(),
    };

    // Compute version with updated filter
    const updatedFilters = [...filters];
    updatedFilters[index] = updated;
    updated.version = computeFilterVersion(updatedFilters);

    await this.updateWorkspaceFilters(workspace, updatedFilters);

    // Invalidate cache
    this.eventEmitter.emit('filters.changed', {
      workspaceId: dto.workspace_id,
    });

    return updated;
  }

  /**
   * Delete a filter.
   */
  async delete(workspaceId: string, filterId: string): Promise<void> {
    const workspace = await this.workspacesService.get(workspaceId);
    const filters = workspace.filters ?? [];

    const index = filters.findIndex((f) => f.id === filterId);
    if (index === -1) {
      throw new NotFoundException(
        `Filter ${filterId} not found in workspace ${workspaceId}`,
      );
    }

    const updatedFilters = filters.filter((f) => f.id !== filterId);
    await this.updateWorkspaceFilters(workspace, updatedFilters);

    // Invalidate cache
    this.eventEmitter.emit('filters.changed', { workspaceId });
  }

  /**
   * Reorder filters.
   */
  async reorder(dto: ReorderFiltersDto): Promise<void> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const filters = workspace.filters ?? [];

    // Update order based on the provided order
    const updatedFilters = filters.map((f) => {
      const orderIndex = dto.filter_ids.indexOf(f.id);
      if (orderIndex !== -1) {
        return { ...f, order: orderIndex };
      }
      return f;
    });

    await this.updateWorkspaceFilters(workspace, updatedFilters);

    // Invalidate cache
    this.eventEmitter.emit('filters.changed', {
      workspaceId: dto.workspace_id,
    });
  }

  /**
   * List unique tags across all filters in a workspace.
   */
  async listTags(workspaceId: string): Promise<string[]> {
    const workspace = await this.workspacesService.get(workspaceId);
    const filters = workspace.filters ?? [];

    const tagSet = new Set<string>();
    for (const filter of filters) {
      for (const tag of filter.tags) {
        tagSet.add(tag);
      }
    }

    return Array.from(tagSet).sort();
  }

  /**
   * Test filter conditions against sample values.
   */
  async test(dto: TestFilterDto): Promise<TestFilterResult> {
    let conditions = dto.conditions;
    let operations = dto.operations;

    // If testing an existing filter, get its conditions and operations
    if (dto.filter_id) {
      const filter = await this.get(dto.workspace_id, dto.filter_id);
      conditions = filter.conditions as any;
      operations = filter.operations as any;
    }

    if (!conditions || conditions.length === 0) {
      throw new BadRequestException('No conditions provided to test');
    }

    if (!operations || operations.length === 0) {
      throw new BadRequestException('No operations provided to test');
    }

    // Evaluate conditions against test values (AND logic)
    const matches = evaluateConditions(conditions as any, dto.testValues);

    // Compute operation results
    const operationResults = operations.map((op) => {
      let resultValue: string | null = null;

      if (matches) {
        switch (op.action) {
          case 'set_value':
            resultValue = op.value ?? null;
            break;
          case 'unset_value':
            resultValue = null;
            break;
          case 'set_default_value':
            // For testing, assume dimension is currently null
            resultValue = op.value ?? null;
            break;
        }
      }

      return {
        dimension: op.dimension,
        action: op.action,
        resultValue,
      };
    });

    return {
      inputValues: dto.testValues,
      matches,
      operationResults,
    };
  }

  /**
   * Get staleness info for filters.
   */
  private async getStalenessInfo(
    workspaceId: string,
    filters: FilterDefinition[],
  ): Promise<{ staleSessionCount: number; totalSessionCount: number }> {
    const currentVersion = computeFilterVersion(filters);

    try {
      const result = await this.clickhouse.queryWorkspace<{
        total: string;
        stale: string;
      }>(
        workspaceId,
        `SELECT
           count() as total,
           countIf(filter_version != {version:String} OR filter_version IS NULL) as stale
         FROM sessions`,
        { version: currentVersion },
      );

      if (result.length === 0) {
        return { staleSessionCount: 0, totalSessionCount: 0 };
      }

      return {
        staleSessionCount: parseInt(result[0].stale, 10),
        totalSessionCount: parseInt(result[0].total, 10),
      };
    } catch {
      // Workspace database may not exist yet
      return { staleSessionCount: 0, totalSessionCount: 0 };
    }
  }

  /**
   * Validate conditions have valid source fields and regex patterns.
   */
  private validateConditions(conditions: CreateFilterDto['conditions']): void {
    for (const condition of conditions) {
      if (!VALID_SOURCE_FIELDS.has(condition.field)) {
        throw new BadRequestException(
          `Invalid source field: ${condition.field}`,
        );
      }

      // Validate regex patterns
      if (condition.operator === 'regex') {
        try {
          new RegExp(condition.value);
        } catch {
          throw new BadRequestException(
            `Invalid regex pattern: ${condition.value}`,
          );
        }
      }
    }
  }

  /**
   * Validate operations have valid dimensions and required values.
   */
  private validateOperations(operations: CreateFilterDto['operations']): void {
    for (const operation of operations) {
      if (!VALID_WRITABLE_DIMENSIONS.has(operation.dimension)) {
        throw new BadRequestException(
          `Invalid dimension: ${operation.dimension}`,
        );
      }

      // Value is required for set_value and set_default_value
      if (
        (operation.action === 'set_value' ||
          operation.action === 'set_default_value') &&
        !operation.value
      ) {
        throw new BadRequestException(
          `Value is required for ${operation.action} action`,
        );
      }
    }
  }

  /**
   * Update workspace with new filter definitions.
   */
  private async updateWorkspaceFilters(
    workspace: Workspace,
    filters: FilterDefinition[],
  ): Promise<void> {
    await this.workspacesService.update({
      id: workspace.id,
      filters,
    } as any);
  }
}

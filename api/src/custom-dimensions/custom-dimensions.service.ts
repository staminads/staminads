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
  CustomDimensionDefinition,
  CustomDimensionWithStaleness,
} from './entities/custom-dimension.entity';
import { CreateCustomDimensionDto } from './dto/create-custom-dimension.dto';
import { UpdateCustomDimensionDto } from './dto/update-custom-dimension.dto';
import { TestCustomDimensionDto, TestResult } from './dto/test-custom-dimension.dto';
import { ReorderCustomDimensionsDto } from './dto/reorder-custom-dimensions.dto';
import { computeVersion, evaluateRule } from './lib/rule-evaluator';

// Valid source fields that can be used in custom dimension conditions
const VALID_SOURCE_FIELDS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_id_from',
  'referrer',
  'referrer_domain',
  'referrer_path',
  'is_direct',
  'landing_page',
  'landing_domain',
  'landing_path',
  'path',
  'device',
  'browser',
  'browser_type',
  'os',
  'user_agent',
  'connection_type',
  'language',
  'timezone',
]);

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class CustomDimensionsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * List all custom dimensions for a workspace with staleness info.
   */
  async list(workspaceId: string): Promise<CustomDimensionWithStaleness[]> {
    const workspace = await this.workspacesService.get(workspaceId);
    const definitions = workspace.custom_dimensions ?? [];

    // Get staleness info for each dimension
    const results: CustomDimensionWithStaleness[] = [];
    for (const definition of definitions) {
      const staleness = await this.getStalenessInfo(workspaceId, definition);
      results.push({
        ...definition,
        ...staleness,
      });
    }

    return results;
  }

  /**
   * Get a single custom dimension by ID with staleness info.
   */
  async get(
    workspaceId: string,
    dimensionId: string,
  ): Promise<CustomDimensionWithStaleness> {
    const workspace = await this.workspacesService.get(workspaceId);
    const definition = (workspace.custom_dimensions ?? []).find(
      (d) => d.id === dimensionId,
    );

    if (!definition) {
      throw new NotFoundException(
        `Custom dimension ${dimensionId} not found in workspace ${workspaceId}`,
      );
    }

    const staleness = await this.getStalenessInfo(workspaceId, definition);
    return {
      ...definition,
      ...staleness,
    };
  }

  /**
   * Create a new custom dimension.
   */
  async create(dto: CreateCustomDimensionDto): Promise<CustomDimensionDefinition> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const definitions = workspace.custom_dimensions ?? [];

    // Validate rules
    this.validateRules(dto.rules);

    // Determine slot
    let slot = dto.slot;
    if (slot === undefined) {
      slot = this.findAvailableSlot(definitions);
    } else {
      // Check if slot is already in use
      if (definitions.some((d) => d.slot === slot)) {
        throw new BadRequestException(`Slot ${slot} is already in use`);
      }
    }

    const now = toClickHouseDateTime();
    const definition: CustomDimensionDefinition = {
      id: randomUUID(),
      slot,
      name: dto.name,
      category: dto.category ?? 'Custom',
      rules: dto.rules,
      defaultValue: dto.defaultValue,
      version: computeVersion(dto.rules, dto.defaultValue),
      createdAt: now,
      updatedAt: now,
    };

    // Update workspace with new definition
    const updatedDefinitions = [...definitions, definition];
    await this.updateWorkspaceDefinitions(workspace, updatedDefinitions);

    // Invalidate cache
    this.eventEmitter.emit('customDimensions.changed', {
      workspaceId: dto.workspace_id,
    });

    return definition;
  }

  /**
   * Update an existing custom dimension.
   */
  async update(dto: UpdateCustomDimensionDto): Promise<CustomDimensionDefinition> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const definitions = workspace.custom_dimensions ?? [];

    const index = definitions.findIndex((d) => d.id === dto.id);
    if (index === -1) {
      throw new NotFoundException(
        `Custom dimension ${dto.id} not found in workspace ${dto.workspace_id}`,
      );
    }

    const existing = definitions[index];

    // Validate rules if provided
    if (dto.rules) {
      this.validateRules(dto.rules);
    }

    const rules = dto.rules ?? existing.rules;
    const defaultValue = dto.defaultValue !== undefined ? dto.defaultValue : existing.defaultValue;

    const updated: CustomDimensionDefinition = {
      ...existing,
      name: dto.name ?? existing.name,
      category: dto.category ?? existing.category,
      rules,
      defaultValue,
      version: computeVersion(rules, defaultValue),
      updatedAt: toClickHouseDateTime(),
    };

    // Update workspace with updated definition
    const updatedDefinitions = [...definitions];
    updatedDefinitions[index] = updated;
    await this.updateWorkspaceDefinitions(workspace, updatedDefinitions);

    // Invalidate cache
    this.eventEmitter.emit('customDimensions.changed', {
      workspaceId: dto.workspace_id,
    });

    return updated;
  }

  /**
   * Delete a custom dimension.
   */
  async delete(workspaceId: string, dimensionId: string): Promise<void> {
    const workspace = await this.workspacesService.get(workspaceId);
    const definitions = workspace.custom_dimensions ?? [];

    const index = definitions.findIndex((d) => d.id === dimensionId);
    if (index === -1) {
      throw new NotFoundException(
        `Custom dimension ${dimensionId} not found in workspace ${workspaceId}`,
      );
    }

    // Update workspace without the deleted definition
    const updatedDefinitions = definitions.filter((d) => d.id !== dimensionId);
    await this.updateWorkspaceDefinitions(workspace, updatedDefinitions);

    // Invalidate cache
    this.eventEmitter.emit('customDimensions.changed', { workspaceId });
  }

  /**
   * Reorder custom dimensions.
   */
  async reorder(dto: ReorderCustomDimensionsDto): Promise<void> {
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const definitions = workspace.custom_dimensions ?? [];

    // Update order based on the provided order
    const updatedDefinitions = definitions.map((d) => {
      const orderIndex = dto.dimension_ids.indexOf(d.id);
      if (orderIndex !== -1) {
        return { ...d, order: orderIndex };
      }
      return d;
    });

    await this.updateWorkspaceDefinitions(workspace, updatedDefinitions);

    // Invalidate cache
    this.eventEmitter.emit('customDimensions.changed', {
      workspaceId: dto.workspace_id,
    });
  }

  /**
   * Test rules against sample values.
   */
  async test(dto: TestCustomDimensionDto): Promise<TestResult> {
    let rules = dto.rules;
    let defaultValue = dto.defaultValue;

    // If testing an existing dimension, get its rules
    if (dto.dimension_id) {
      const dimension = await this.get(dto.workspace_id, dto.dimension_id);
      rules = dimension.rules;
      defaultValue = dimension.defaultValue;
    }

    if (!rules || rules.length === 0) {
      throw new BadRequestException('No rules provided to test');
    }

    // Evaluate rules against test values
    let matchedRuleIndex: number | null = null;
    let outputValue: string | null = defaultValue ?? null;

    for (let i = 0; i < rules.length; i++) {
      if (evaluateRule(rules[i], dto.testValues)) {
        matchedRuleIndex = i;
        outputValue = rules[i].outputValue;
        break;
      }
    }

    return {
      inputValues: dto.testValues,
      matchedRuleIndex,
      outputValue,
    };
  }

  /**
   * Get staleness info for a custom dimension.
   */
  private async getStalenessInfo(
    workspaceId: string,
    definition: CustomDimensionDefinition,
  ): Promise<{ staleSessionCount: number; totalSessionCount: number }> {
    const versionColumn = `cd_${definition.slot}_version`;

    const result = await this.clickhouse.query<{
      total: string;
      stale: string;
    }>(
      `SELECT
         count() as total,
         countIf(${versionColumn} != {version:String} OR ${versionColumn} IS NULL) as stale
       FROM sessions
       WHERE workspace_id = {workspace_id:String}`,
      { workspace_id: workspaceId, version: definition.version },
    );

    if (result.length === 0) {
      return { staleSessionCount: 0, totalSessionCount: 0 };
    }

    return {
      staleSessionCount: parseInt(result[0].stale, 10),
      totalSessionCount: parseInt(result[0].total, 10),
    };
  }

  /**
   * Find the first available slot (1-10).
   */
  private findAvailableSlot(definitions: CustomDimensionDefinition[]): number {
    const usedSlots = new Set(definitions.map((d) => d.slot));
    for (let i = 1; i <= 10; i++) {
      if (!usedSlots.has(i)) {
        return i;
      }
    }
    throw new BadRequestException('All 10 custom dimension slots are in use');
  }

  /**
   * Validate rules have valid source fields and regex patterns.
   */
  private validateRules(rules: CreateCustomDimensionDto['rules']): void {
    for (const rule of rules) {
      for (const condition of rule.conditions) {
        if (!VALID_SOURCE_FIELDS.has(condition.field)) {
          throw new BadRequestException(
            `Invalid source field: ${condition.field}. Valid fields: ${[...VALID_SOURCE_FIELDS].join(', ')}`,
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
  }

  /**
   * Update workspace with new custom dimension definitions.
   */
  private async updateWorkspaceDefinitions(
    workspace: Workspace,
    definitions: CustomDimensionDefinition[],
  ): Promise<void> {
    await this.workspacesService.update({
      id: workspace.id,
      custom_dimensions: definitions,
    } as any); // TypeScript doesn't know about custom_dimensions in UpdateWorkspaceDto
  }
}

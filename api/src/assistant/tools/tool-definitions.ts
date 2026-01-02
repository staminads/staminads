import Anthropic from '@anthropic-ai/sdk';
import {
  DATE_PRESETS,
  FILTER_OPERATORS,
} from '../../analytics/dto/analytics-query.dto';

/**
 * Tool definitions for the AI assistant.
 * Using Anthropic's tool format.
 */
export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'configure_explore',
    description:
      'Configure the Explore page with dimensions, filters, date range, and comparison settings. Call this when you have determined the optimal configuration. This is the final action.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
          description:
            'Ordered list of dimension names for drill-down hierarchy (max 5). First dimension is the primary grouping.',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dimension: { type: 'string' },
              operator: {
                type: 'string',
                enum: [...FILTER_OPERATORS],
              },
              values: {
                type: 'array',
                items: { type: ['string', 'number', 'null'] },
              },
            },
            required: ['dimension', 'operator'],
          },
          description: 'Filters to apply to the data',
        },
        period: {
          type: 'string',
          enum: [...DATE_PRESETS],
          description: 'Date range preset (e.g., last_7_days, this_month)',
        },
        comparison: {
          type: 'string',
          enum: ['previous_period', 'previous_year', 'none'],
          description: 'Comparison mode for trend analysis',
        },
        minSessions: {
          type: 'number',
          minimum: 1,
          description:
            'Minimum sessions threshold for filtering low-volume segments',
        },
        customStart: {
          type: 'string',
          description: 'Custom date range start (ISO format, e.g., 2024-01-01)',
        },
        customEnd: {
          type: 'string',
          description: 'Custom date range end (ISO format, e.g., 2024-01-31)',
        },
      },
    },
  },
  {
    name: 'get_dimensions',
    description:
      'Get all available dimensions with their descriptions and categories. Use this to understand what data can be analyzed and to find the correct dimension names.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_metrics',
    description:
      'Get all available metrics with their descriptions. Use this to understand what measurements are available.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_dimension_values',
    description:
      'Get the actual values that exist for a dimension in the data. IMPORTANT: Always call this before filtering on a dimension to ensure you use correct values. Returns top values by session count.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dimension: {
          type: 'string',
          description: 'The dimension name to get values for (e.g., "channel", "utm_source")',
        },
        period: {
          type: 'string',
          enum: [...DATE_PRESETS],
          description: 'Date range to search within (default: last_30_days)',
        },
        search: {
          type: 'string',
          description: 'Optional search string to filter values (case-insensitive contains match)',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum values to return (default: 20)',
        },
      },
      required: ['dimension'],
    },
  },
  {
    name: 'preview_query',
    description:
      'Execute a preview query to validate configuration and see sample results. Use this to verify data exists before finalizing configuration. Limited to 3 dimensions and 100 rows.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
          description: 'Dimensions to query (max 3 for preview)',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dimension: { type: 'string' },
              operator: { type: 'string' },
              values: { type: 'array' },
            },
          },
          description: 'Optional filters to apply',
        },
        period: {
          type: 'string',
          enum: [...DATE_PRESETS],
          description: 'Date range preset (required)',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          default: 10,
          description: 'Number of rows to return (max 100)',
        },
      },
      required: ['dimensions', 'period'],
    },
  },
];

/**
 * JSON Schema type for recursive processing.
 */
type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [key: string]: unknown;
};

/**
 * Properties not supported by Anthropic structured outputs strict mode.
 * These are removed during schema transformation.
 */
const UNSUPPORTED_SCHEMA_PROPERTIES = [
  'maxItems',
  'minItems',
  'maximum',
  'minimum',
  'default',
  'pattern',
  'format',
  'maxLength',
  'minLength',
  'uniqueItems',
];

/**
 * Remove unsupported properties from schema object.
 */
function removeUnsupportedProperties(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!UNSUPPORTED_SCHEMA_PROPERTIES.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Recursively add additionalProperties: false to object schemas
 * and remove unsupported properties for strict mode.
 * Required for strict mode in structured outputs.
 */
function addAdditionalPropertiesFalse(schema: JsonSchema): JsonSchema {
  const cleaned = removeUnsupportedProperties(schema);

  if (cleaned.type === 'object') {
    const result: JsonSchema = {
      ...cleaned,
      additionalProperties: false,
    };

    if (cleaned.properties) {
      const newProperties: Record<string, JsonSchema> = {};
      for (const [key, value] of Object.entries(cleaned.properties)) {
        newProperties[key] = addAdditionalPropertiesFalse(value);
      }
      result.properties = newProperties;
    }

    return result;
  }

  if (cleaned.type === 'array' && cleaned.items) {
    return {
      ...cleaned,
      items: addAdditionalPropertiesFalse(cleaned.items),
    };
  }

  return cleaned;
}

/**
 * Strict tool definitions for structured outputs beta.
 * Adds strict: true and additionalProperties: false for schema enforcement.
 * See: https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs
 */
export const STRICT_ASSISTANT_TOOLS: Anthropic.Tool[] = ASSISTANT_TOOLS.map(
  (tool) => {
    const strictSchema = addAdditionalPropertiesFalse(
      tool.input_schema as JsonSchema,
    );
    return {
      ...tool,
      strict: true,
      input_schema: strictSchema as Anthropic.Tool.InputSchema,
    };
  },
);

/**
 * Tool names for type safety.
 */
export type ToolName =
  | 'configure_explore'
  | 'get_dimensions'
  | 'get_metrics'
  | 'get_dimension_values'
  | 'preview_query';

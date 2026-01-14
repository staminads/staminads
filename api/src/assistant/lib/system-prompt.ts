import { Workspace } from '../../workspaces/entities/workspace.entity';
import { ExploreStateDto } from '../dto/chat.dto';

/**
 * Get page-specific context description.
 */
function getPageContext(page?: string): string {
  if (!page) return '';

  const contexts: Record<string, string> = {
    dashboard:
      'The user is on the main Dashboard. You can help them understand their metrics or suggest explore reports for deeper analysis.',
    explore:
      'The user is on the Explore page for custom report building. Use configure_explore to set up their report.',
    goals:
      'The user is viewing Goals/Conversions. Focus on goal-related analysis and conversion metrics.',
    live: 'The user is viewing Live/Real-time data. Consider recent time periods in your suggestions.',
    filters:
      'The user is managing global Filters. Help them understand filtering options.',
    annotations:
      'The user is managing Annotations. Help them track important events.',
    settings:
      'The user is in Settings. Help them with configuration questions.',
  };

  return contexts[page] || '';
}

/**
 * Build the system prompt for the AI assistant.
 */
export function buildSystemPrompt(
  workspace: Workspace,
  currentState?: ExploreStateDto,
  currentPage?: string,
): string {
  const customDimensionLabels = workspace.settings.custom_dimensions
    ? Object.entries(workspace.settings.custom_dimensions)
        .map(([slot, label]) => `stm_${slot}: ${label}`)
        .join(', ')
    : 'None configured';

  const currentStateText = currentState
    ? `
## Current Explore Configuration
- Dimensions: ${currentState.dimensions?.join(', ') || 'None'}
- Period: ${currentState.period || 'previous_7_days'}
- Comparison: ${currentState.comparison || 'previous_period'}
- Filters: ${currentState.filters?.length ? JSON.stringify(currentState.filters) : 'None'}
- Min Sessions: ${currentState.minSessions || 1}`
    : '';

  const pageContext = getPageContext(currentPage);
  const pageContextText = pageContext
    ? `
## Current Page
${pageContext}`
    : '';

  return `You are an AI analytics assistant for the Staminads web analytics platform. Your role is to help users configure the Explore page to analyze their website traffic data.

## Workspace Context
- Name: ${workspace.name}
- Website: ${workspace.website}
- Timezone: ${workspace.timezone}
- Custom Dimensions: ${customDimensionLabels}
${currentStateText}
${pageContextText}

## Your Capabilities
You can use tools to:
1. **get_dimensions** - List all available dimensions for analysis
2. **get_metrics** - List available metrics (sessions, duration, bounce rate, etc.)
3. **get_dimension_values** - Get actual values that exist for a dimension (REQUIRED before filtering)
4. **preview_query** - Test a configuration to verify data exists
5. **configure_explore** - Apply the final configuration (call this last)

## Guidelines
1. Always start by understanding what the user wants to analyze
2. Use get_dimensions if you need to confirm dimension names
3. **CRITICAL: Before creating any filter, ALWAYS call get_dimension_values first** to see what values actually exist. Never guess filter values - the user's data may have different values than you expect (e.g., "instagram-ads" not "instagram").
4. Use preview_query to validate your configuration has data
5. End by calling configure_explore with the final settings

## Dimension Hierarchy Best Practices
- Start broad, drill into specifics
- Traffic analysis: channel_group → channel → utm_source → utm_campaign
- Content analysis: landing_domain → landing_path → entry_page
- Device analysis: device → browser → os
- Time analysis: day_of_week → hour

## Common Patterns
- "Show me campaigns" → dimensions: ['utm_campaign'], period: 'previous_7_days'
- "Traffic by device" → dimensions: ['device'], period: 'previous_7_days'
- "Compare sources" → dimensions: ['utm_source'], comparison: 'previous_period'
- "Previous week" → period: 'previous_week'
- "This month" → period: 'this_month'

Think step by step, then configure the Explore page.`;
}

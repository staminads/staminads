import { buildSystemPrompt } from './system-prompt';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { ExploreStateDto } from '../dto/chat.dto';

describe('buildSystemPrompt', () => {
  const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
    id: 'ws-123',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'America/New_York',
    currency: 'USD',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    status: 'active',
    settings: {
      timescore_reference: 120,
      bounce_threshold: 5,
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
      ...overrides.settings,
    },
    ...overrides,
  });

  it('includes workspace context', () => {
    const workspace = createWorkspace({
      name: 'My Analytics',
      website: 'https://mysite.com',
      timezone: 'Europe/London',
    });

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('Name: My Analytics');
    expect(prompt).toContain('Website: https://mysite.com');
    expect(prompt).toContain('Timezone: Europe/London');
  });

  it('shows "None configured" when no custom dimensions', () => {
    const workspace = createWorkspace({
      settings: { custom_dimensions: null } as any,
    });

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('Custom Dimensions: None configured');
  });

  it('lists custom dimension labels when configured', () => {
    const workspace = createWorkspace({
      settings: {
        custom_dimensions: {
          '1': 'Campaign Type',
          '2': 'Content Theme',
        },
      } as any,
    });

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('cd_1: Campaign Type');
    expect(prompt).toContain('cd_2: Content Theme');
  });

  it('includes current state when provided', () => {
    const workspace = createWorkspace();
    const currentState: ExploreStateDto = {
      dimensions: ['country', 'device'],
      period: 'last_7_days',
      comparison: 'previous_period',
      minSessions: 10,
      filters: [{ dimension: 'country', operator: 'equals', values: ['US'] }],
    };

    const prompt = buildSystemPrompt(workspace, currentState);

    expect(prompt).toContain('Current Explore Configuration');
    expect(prompt).toContain('Dimensions: country, device');
    expect(prompt).toContain('Period: last_7_days');
    expect(prompt).toContain('Comparison: previous_period');
    expect(prompt).toContain('Min Sessions: 10');
    expect(prompt).toContain('country');
  });

  it('shows defaults for missing current state values', () => {
    const workspace = createWorkspace();
    const currentState: ExploreStateDto = {};

    const prompt = buildSystemPrompt(workspace, currentState);

    expect(prompt).toContain('Dimensions: None');
    expect(prompt).toContain('Period: last_7_days');
    expect(prompt).toContain('Comparison: previous_period');
    expect(prompt).toContain('Filters: None');
    expect(prompt).toContain('Min Sessions: 1');
  });

  it('does not include current state section when not provided', () => {
    const workspace = createWorkspace();

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).not.toContain('Current Explore Configuration');
  });

  it('includes tool capabilities documentation', () => {
    const workspace = createWorkspace();

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('get_dimensions');
    expect(prompt).toContain('get_metrics');
    expect(prompt).toContain('get_dimension_values');
    expect(prompt).toContain('preview_query');
    expect(prompt).toContain('configure_explore');
  });

  it('includes guidelines section', () => {
    const workspace = createWorkspace();

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('Guidelines');
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('get_dimension_values');
  });

  it('includes dimension hierarchy best practices', () => {
    const workspace = createWorkspace();

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('Dimension Hierarchy Best Practices');
    expect(prompt).toContain('channel_group');
    expect(prompt).toContain('landing_domain');
  });

  it('includes common patterns examples', () => {
    const workspace = createWorkspace();

    const prompt = buildSystemPrompt(workspace);

    expect(prompt).toContain('Common Patterns');
    expect(prompt).toContain('Show me campaigns');
    expect(prompt).toContain('Traffic by device');
  });
});

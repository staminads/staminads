import { AnalyticsTable } from './tables';

export interface DimensionDefinition {
  name: string;
  column: string;
  type: 'string' | 'number' | 'boolean';
  category: string;
  tables: AnalyticsTable[];
}

export const DIMENSIONS: Record<string, DimensionDefinition> = {
  // Traffic (sessions and goals)
  referrer: {
    name: 'referrer',
    column: 'referrer',
    type: 'string',
    category: 'Traffic',
    tables: ['sessions', 'goals'],
  },
  referrer_domain: {
    name: 'referrer_domain',
    column: 'referrer_domain',
    type: 'string',
    category: 'Traffic',
    tables: ['sessions', 'goals'],
  },
  referrer_path: {
    name: 'referrer_path',
    column: 'referrer_path',
    type: 'string',
    category: 'Traffic',
    tables: ['sessions', 'goals'],
  },
  is_direct: {
    name: 'is_direct',
    column: 'is_direct',
    type: 'boolean',
    category: 'Traffic',
    tables: ['sessions', 'goals'],
  },

  // UTM (sessions and goals)
  utm_source: {
    name: 'utm_source',
    column: 'utm_source',
    type: 'string',
    category: 'UTM',
    tables: ['sessions', 'goals'],
  },
  utm_medium: {
    name: 'utm_medium',
    column: 'utm_medium',
    type: 'string',
    category: 'UTM',
    tables: ['sessions', 'goals'],
  },
  utm_campaign: {
    name: 'utm_campaign',
    column: 'utm_campaign',
    type: 'string',
    category: 'UTM',
    tables: ['sessions', 'goals'],
  },
  utm_term: {
    name: 'utm_term',
    column: 'utm_term',
    type: 'string',
    category: 'UTM',
    tables: ['sessions', 'goals'],
  },
  utm_content: {
    name: 'utm_content',
    column: 'utm_content',
    type: 'string',
    category: 'UTM',
    tables: ['sessions', 'goals'],
  },

  // Channel (sessions and goals)
  channel: {
    name: 'channel',
    column: 'channel',
    type: 'string',
    category: 'Channel',
    tables: ['sessions', 'goals'],
  },
  channel_group: {
    name: 'channel_group',
    column: 'channel_group',
    type: 'string',
    category: 'Channel',
    tables: ['sessions', 'goals'],
  },

  // Session Pages (sessions and some on goals)
  landing_page: {
    name: 'landing_page',
    column: 'landing_page',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions', 'goals'],
  },
  landing_domain: {
    name: 'landing_domain',
    column: 'landing_domain',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions', 'goals'],
  },
  landing_path: {
    name: 'landing_path',
    column: 'landing_path',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions', 'goals'],
  },
  exit_path: {
    name: 'exit_path',
    column: 'exit_path',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions'],
  },

  // Page (pages table only)
  page_path: {
    name: 'page_path',
    column: 'path',
    type: 'string',
    category: 'Page',
    tables: ['pages'],
  },
  page_number: {
    name: 'page_number',
    column: 'page_number',
    type: 'number',
    category: 'Page',
    tables: ['pages'],
  },
  is_landing_page: {
    name: 'is_landing_page',
    column: 'is_landing',
    type: 'boolean',
    category: 'Page',
    tables: ['pages'],
  },
  is_exit_page: {
    name: 'is_exit_page',
    column: 'is_exit',
    type: 'boolean',
    category: 'Page',
    tables: ['pages'],
  },
  page_entry_type: {
    name: 'page_entry_type',
    column: 'entry_type',
    type: 'string',
    category: 'Page',
    tables: ['pages'],
  },

  // Device (sessions and some on goals)
  device: {
    name: 'device',
    column: 'device',
    type: 'string',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  browser: {
    name: 'browser',
    column: 'browser',
    type: 'string',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  browser_type: {
    name: 'browser_type',
    column: 'browser_type',
    type: 'string',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  os: {
    name: 'os',
    column: 'os',
    type: 'string',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  screen_width: {
    name: 'screen_width',
    column: 'screen_width',
    type: 'number',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  screen_height: {
    name: 'screen_height',
    column: 'screen_height',
    type: 'number',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  viewport_width: {
    name: 'viewport_width',
    column: 'viewport_width',
    type: 'number',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  viewport_height: {
    name: 'viewport_height',
    column: 'viewport_height',
    type: 'number',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },
  connection_type: {
    name: 'connection_type',
    column: 'connection_type',
    type: 'string',
    category: 'Device',
    tables: ['sessions', 'goals'],
  },

  // Session (sessions only)
  duration: {
    name: 'duration',
    column: 'duration',
    type: 'number',
    category: 'Session',
    tables: ['sessions'],
  },
  pageview_count: {
    name: 'pageview_count',
    column: 'pageview_count',
    type: 'number',
    category: 'Session',
    tables: ['sessions'],
  },
  sdk_version: {
    name: 'sdk_version',
    column: 'sdk_version',
    type: 'string',
    category: 'Session',
    tables: ['sessions'],
  },

  // Time (sessions and goals)
  year: {
    name: 'year',
    column: 'year',
    type: 'number',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },
  month: {
    name: 'month',
    column: 'month',
    type: 'number',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },
  day: {
    name: 'day',
    column: 'day',
    type: 'number',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },
  day_of_week: {
    name: 'day_of_week',
    column: 'day_of_week',
    type: 'number',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },
  week_number: {
    name: 'week_number',
    column: 'week_number',
    type: 'number',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },
  hour: {
    name: 'hour',
    column: 'hour',
    type: 'number',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },
  is_weekend: {
    name: 'is_weekend',
    column: 'is_weekend',
    type: 'boolean',
    category: 'Time',
    tables: ['sessions', 'goals'],
  },

  // Geo (sessions and goals)
  country: {
    name: 'country',
    column: 'country',
    type: 'string',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },
  region: {
    name: 'region',
    column: 'region',
    type: 'string',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },
  city: {
    name: 'city',
    column: 'city',
    type: 'string',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },
  latitude: {
    name: 'latitude',
    column: 'latitude',
    type: 'number',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },
  longitude: {
    name: 'longitude',
    column: 'longitude',
    type: 'number',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },
  language: {
    name: 'language',
    column: 'language',
    type: 'string',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },
  timezone: {
    name: 'timezone',
    column: 'timezone',
    type: 'string',
    category: 'Geo',
    tables: ['sessions', 'goals'],
  },

  // Custom Dimensions (sessions and goals)
  stm_1: {
    name: 'stm_1',
    column: 'stm_1',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_2: {
    name: 'stm_2',
    column: 'stm_2',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_3: {
    name: 'stm_3',
    column: 'stm_3',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_4: {
    name: 'stm_4',
    column: 'stm_4',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_5: {
    name: 'stm_5',
    column: 'stm_5',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_6: {
    name: 'stm_6',
    column: 'stm_6',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_7: {
    name: 'stm_7',
    column: 'stm_7',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_8: {
    name: 'stm_8',
    column: 'stm_8',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_9: {
    name: 'stm_9',
    column: 'stm_9',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },
  stm_10: {
    name: 'stm_10',
    column: 'stm_10',
    type: 'string',
    category: 'Custom',
    tables: ['sessions', 'goals'],
  },

  // Goal (goals table only)
  goal_name: {
    name: 'goal_name',
    column: 'goal_name',
    type: 'string',
    category: 'Goal',
    tables: ['goals'],
  },
  goal_path: {
    name: 'goal_path',
    column: 'path',
    type: 'string',
    category: 'Goal',
    tables: ['goals'],
  },
};

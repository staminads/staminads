import { AnalyticsTable } from './tables';

export interface DimensionDefinition {
  name: string;
  column: string;
  type: 'string' | 'number' | 'boolean';
  category: string;
  tables: AnalyticsTable[];
}

export const DIMENSIONS: Record<string, DimensionDefinition> = {
  // Traffic (sessions only)
  referrer: {
    name: 'referrer',
    column: 'referrer',
    type: 'string',
    category: 'Traffic',
    tables: ['sessions'],
  },
  referrer_domain: {
    name: 'referrer_domain',
    column: 'referrer_domain',
    type: 'string',
    category: 'Traffic',
    tables: ['sessions'],
  },
  referrer_path: {
    name: 'referrer_path',
    column: 'referrer_path',
    type: 'string',
    category: 'Traffic',
    tables: ['sessions'],
  },
  is_direct: {
    name: 'is_direct',
    column: 'is_direct',
    type: 'boolean',
    category: 'Traffic',
    tables: ['sessions'],
  },

  // UTM (sessions only)
  utm_source: {
    name: 'utm_source',
    column: 'utm_source',
    type: 'string',
    category: 'UTM',
    tables: ['sessions'],
  },
  utm_medium: {
    name: 'utm_medium',
    column: 'utm_medium',
    type: 'string',
    category: 'UTM',
    tables: ['sessions'],
  },
  utm_campaign: {
    name: 'utm_campaign',
    column: 'utm_campaign',
    type: 'string',
    category: 'UTM',
    tables: ['sessions'],
  },
  utm_term: {
    name: 'utm_term',
    column: 'utm_term',
    type: 'string',
    category: 'UTM',
    tables: ['sessions'],
  },
  utm_content: {
    name: 'utm_content',
    column: 'utm_content',
    type: 'string',
    category: 'UTM',
    tables: ['sessions'],
  },

  // Channel (sessions only)
  channel: {
    name: 'channel',
    column: 'channel',
    type: 'string',
    category: 'Channel',
    tables: ['sessions'],
  },
  channel_group: {
    name: 'channel_group',
    column: 'channel_group',
    type: 'string',
    category: 'Channel',
    tables: ['sessions'],
  },

  // Session Pages (sessions only)
  landing_page: {
    name: 'landing_page',
    column: 'landing_page',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions'],
  },
  landing_domain: {
    name: 'landing_domain',
    column: 'landing_domain',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions'],
  },
  landing_path: {
    name: 'landing_path',
    column: 'landing_path',
    type: 'string',
    category: 'Session Pages',
    tables: ['sessions'],
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

  // Device (sessions only)
  device: {
    name: 'device',
    column: 'device',
    type: 'string',
    category: 'Device',
    tables: ['sessions'],
  },
  browser: {
    name: 'browser',
    column: 'browser',
    type: 'string',
    category: 'Device',
    tables: ['sessions'],
  },
  browser_type: {
    name: 'browser_type',
    column: 'browser_type',
    type: 'string',
    category: 'Device',
    tables: ['sessions'],
  },
  os: {
    name: 'os',
    column: 'os',
    type: 'string',
    category: 'Device',
    tables: ['sessions'],
  },
  screen_width: {
    name: 'screen_width',
    column: 'screen_width',
    type: 'number',
    category: 'Device',
    tables: ['sessions'],
  },
  screen_height: {
    name: 'screen_height',
    column: 'screen_height',
    type: 'number',
    category: 'Device',
    tables: ['sessions'],
  },
  viewport_width: {
    name: 'viewport_width',
    column: 'viewport_width',
    type: 'number',
    category: 'Device',
    tables: ['sessions'],
  },
  viewport_height: {
    name: 'viewport_height',
    column: 'viewport_height',
    type: 'number',
    category: 'Device',
    tables: ['sessions'],
  },
  connection_type: {
    name: 'connection_type',
    column: 'connection_type',
    type: 'string',
    category: 'Device',
    tables: ['sessions'],
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

  // Time (sessions only)
  year: {
    name: 'year',
    column: 'year',
    type: 'number',
    category: 'Time',
    tables: ['sessions'],
  },
  month: {
    name: 'month',
    column: 'month',
    type: 'number',
    category: 'Time',
    tables: ['sessions'],
  },
  day: {
    name: 'day',
    column: 'day',
    type: 'number',
    category: 'Time',
    tables: ['sessions'],
  },
  day_of_week: {
    name: 'day_of_week',
    column: 'day_of_week',
    type: 'number',
    category: 'Time',
    tables: ['sessions'],
  },
  week_number: {
    name: 'week_number',
    column: 'week_number',
    type: 'number',
    category: 'Time',
    tables: ['sessions'],
  },
  hour: {
    name: 'hour',
    column: 'hour',
    type: 'number',
    category: 'Time',
    tables: ['sessions'],
  },
  is_weekend: {
    name: 'is_weekend',
    column: 'is_weekend',
    type: 'boolean',
    category: 'Time',
    tables: ['sessions'],
  },

  // Geo (sessions only)
  country: {
    name: 'country',
    column: 'country',
    type: 'string',
    category: 'Geo',
    tables: ['sessions'],
  },
  region: {
    name: 'region',
    column: 'region',
    type: 'string',
    category: 'Geo',
    tables: ['sessions'],
  },
  city: {
    name: 'city',
    column: 'city',
    type: 'string',
    category: 'Geo',
    tables: ['sessions'],
  },
  latitude: {
    name: 'latitude',
    column: 'latitude',
    type: 'number',
    category: 'Geo',
    tables: ['sessions'],
  },
  longitude: {
    name: 'longitude',
    column: 'longitude',
    type: 'number',
    category: 'Geo',
    tables: ['sessions'],
  },
  language: {
    name: 'language',
    column: 'language',
    type: 'string',
    category: 'Geo',
    tables: ['sessions'],
  },
  timezone: {
    name: 'timezone',
    column: 'timezone',
    type: 'string',
    category: 'Geo',
    tables: ['sessions'],
  },

  // Custom Dimensions (sessions only)
  stm_1: {
    name: 'stm_1',
    column: 'stm_1',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_2: {
    name: 'stm_2',
    column: 'stm_2',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_3: {
    name: 'stm_3',
    column: 'stm_3',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_4: {
    name: 'stm_4',
    column: 'stm_4',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_5: {
    name: 'stm_5',
    column: 'stm_5',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_6: {
    name: 'stm_6',
    column: 'stm_6',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_7: {
    name: 'stm_7',
    column: 'stm_7',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_8: {
    name: 'stm_8',
    column: 'stm_8',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_9: {
    name: 'stm_9',
    column: 'stm_9',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
  stm_10: {
    name: 'stm_10',
    column: 'stm_10',
    type: 'string',
    category: 'Custom',
    tables: ['sessions'],
  },
};

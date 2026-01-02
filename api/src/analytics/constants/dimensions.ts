export interface DimensionDefinition {
  name: string;
  column: string;
  type: 'string' | 'number' | 'boolean';
  category: string;
}

export const DIMENSIONS: Record<string, DimensionDefinition> = {
  // Traffic
  referrer: { name: 'referrer', column: 'referrer', type: 'string', category: 'Traffic' },
  referrer_domain: { name: 'referrer_domain', column: 'referrer_domain', type: 'string', category: 'Traffic' },
  referrer_path: { name: 'referrer_path', column: 'referrer_path', type: 'string', category: 'Traffic' },
  is_direct: { name: 'is_direct', column: 'is_direct', type: 'boolean', category: 'Traffic' },

  // UTM
  utm_source: { name: 'utm_source', column: 'utm_source', type: 'string', category: 'UTM' },
  utm_medium: { name: 'utm_medium', column: 'utm_medium', type: 'string', category: 'UTM' },
  utm_campaign: { name: 'utm_campaign', column: 'utm_campaign', type: 'string', category: 'UTM' },
  utm_term: { name: 'utm_term', column: 'utm_term', type: 'string', category: 'UTM' },
  utm_content: { name: 'utm_content', column: 'utm_content', type: 'string', category: 'UTM' },

  // Channel
  channel: { name: 'channel', column: 'channel', type: 'string', category: 'Channel' },
  channel_group: { name: 'channel_group', column: 'channel_group', type: 'string', category: 'Channel' },

  // Pages
  landing_page: { name: 'landing_page', column: 'landing_page', type: 'string', category: 'Pages' },
  landing_domain: { name: 'landing_domain', column: 'landing_domain', type: 'string', category: 'Pages' },
  landing_path: { name: 'landing_path', column: 'landing_path', type: 'string', category: 'Pages' },
  entry_page: { name: 'entry_page', column: 'entry_page', type: 'string', category: 'Pages' },
  exit_page: { name: 'exit_page', column: 'exit_page', type: 'string', category: 'Pages' },

  // Device
  device: { name: 'device', column: 'device', type: 'string', category: 'Device' },
  browser: { name: 'browser', column: 'browser', type: 'string', category: 'Device' },
  browser_type: { name: 'browser_type', column: 'browser_type', type: 'string', category: 'Device' },
  os: { name: 'os', column: 'os', type: 'string', category: 'Device' },
  screen_width: { name: 'screen_width', column: 'screen_width', type: 'number', category: 'Device' },
  screen_height: { name: 'screen_height', column: 'screen_height', type: 'number', category: 'Device' },
  viewport_width: { name: 'viewport_width', column: 'viewport_width', type: 'number', category: 'Device' },
  viewport_height: { name: 'viewport_height', column: 'viewport_height', type: 'number', category: 'Device' },
  connection_type: { name: 'connection_type', column: 'connection_type', type: 'string', category: 'Device' },

  // Session
  duration: { name: 'duration', column: 'duration', type: 'number', category: 'Session' },

  // Time
  year: { name: 'year', column: 'year', type: 'number', category: 'Time' },
  month: { name: 'month', column: 'month', type: 'number', category: 'Time' },
  day: { name: 'day', column: 'day', type: 'number', category: 'Time' },
  day_of_week: { name: 'day_of_week', column: 'day_of_week', type: 'number', category: 'Time' },
  week_number: { name: 'week_number', column: 'week_number', type: 'number', category: 'Time' },
  hour: { name: 'hour', column: 'hour', type: 'number', category: 'Time' },
  is_weekend: { name: 'is_weekend', column: 'is_weekend', type: 'boolean', category: 'Time' },

  // Geo
  language: { name: 'language', column: 'language', type: 'string', category: 'Geo' },
  timezone: { name: 'timezone', column: 'timezone', type: 'string', category: 'Geo' },

  // Custom Dimensions (slots 1-10)
  cd_1: { name: 'cd_1', column: 'cd_1', type: 'string', category: 'Custom' },
  cd_2: { name: 'cd_2', column: 'cd_2', type: 'string', category: 'Custom' },
  cd_3: { name: 'cd_3', column: 'cd_3', type: 'string', category: 'Custom' },
  cd_4: { name: 'cd_4', column: 'cd_4', type: 'string', category: 'Custom' },
  cd_5: { name: 'cd_5', column: 'cd_5', type: 'string', category: 'Custom' },
  cd_6: { name: 'cd_6', column: 'cd_6', type: 'string', category: 'Custom' },
  cd_7: { name: 'cd_7', column: 'cd_7', type: 'string', category: 'Custom' },
  cd_8: { name: 'cd_8', column: 'cd_8', type: 'string', category: 'Custom' },
  cd_9: { name: 'cd_9', column: 'cd_9', type: 'string', category: 'Custom' },
  cd_10: { name: 'cd_10', column: 'cd_10', type: 'string', category: 'Custom' },
};

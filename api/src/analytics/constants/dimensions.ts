export interface DimensionDefinition {
  name: string;
  column: string;
  type: 'string' | 'number' | 'boolean';
  category: string;
}

export const DIMENSIONS: Record<string, DimensionDefinition> = {
  // Traffic
  channel: { name: 'channel', column: 'channel', type: 'string', category: 'Traffic' },
  referrer_domain: { name: 'referrer_domain', column: 'referrer_domain', type: 'string', category: 'Traffic' },
  is_direct: { name: 'is_direct', column: 'is_direct', type: 'boolean', category: 'Traffic' },

  // UTM
  utm_source: { name: 'utm_source', column: 'utm_source', type: 'string', category: 'UTM' },
  utm_medium: { name: 'utm_medium', column: 'utm_medium', type: 'string', category: 'UTM' },
  utm_campaign: { name: 'utm_campaign', column: 'utm_campaign', type: 'string', category: 'UTM' },
  utm_term: { name: 'utm_term', column: 'utm_term', type: 'string', category: 'UTM' },
  utm_content: { name: 'utm_content', column: 'utm_content', type: 'string', category: 'UTM' },

  // Pages
  landing_path: { name: 'landing_path', column: 'landing_path', type: 'string', category: 'Pages' },
  entry_page: { name: 'entry_page', column: 'entry_page', type: 'string', category: 'Pages' },
  exit_page: { name: 'exit_page', column: 'exit_page', type: 'string', category: 'Pages' },

  // Device
  device: { name: 'device', column: 'device', type: 'string', category: 'Device' },
  browser: { name: 'browser', column: 'browser', type: 'string', category: 'Device' },
  browser_type: { name: 'browser_type', column: 'browser_type', type: 'string', category: 'Device' },
  os: { name: 'os', column: 'os', type: 'string', category: 'Device' },

  // Time
  year: { name: 'year', column: 'year', type: 'number', category: 'Time' },
  month: { name: 'month', column: 'month', type: 'number', category: 'Time' },
  day: { name: 'day', column: 'day', type: 'number', category: 'Time' },
  day_of_week: { name: 'day_of_week', column: 'day_of_week', type: 'number', category: 'Time' },
  hour: { name: 'hour', column: 'hour', type: 'number', category: 'Time' },
  is_weekend: { name: 'is_weekend', column: 'is_weekend', type: 'boolean', category: 'Time' },

  // Geo
  language: { name: 'language', column: 'language', type: 'string', category: 'Geo' },
  timezone: { name: 'timezone', column: 'timezone', type: 'string', category: 'Geo' },
};

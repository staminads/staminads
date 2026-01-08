export const ANALYTICS_TABLES = ['sessions', 'pages'] as const;
export type AnalyticsTable = (typeof ANALYTICS_TABLES)[number];

export interface TableConfig {
  name: AnalyticsTable;
  dateColumn: string;
  finalModifier: boolean;
}

export const TABLE_CONFIGS: Record<AnalyticsTable, TableConfig> = {
  sessions: {
    name: 'sessions',
    dateColumn: 'created_at',
    finalModifier: true, // ReplacingMergeTree needs FINAL
  },
  pages: {
    name: 'pages',
    dateColumn: 'entered_at',
    finalModifier: false, // MergeTree doesn't need FINAL
  },
};

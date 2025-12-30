export type CustomDimensionOperator = 'equals' | 'regex' | 'contains';

export interface CustomDimensionCondition {
  field: string;
  operator: CustomDimensionOperator;
  value: string;
}

export interface CustomDimensionRule {
  conditions: CustomDimensionCondition[];
  outputValue: string;
}

export interface CustomDimensionDefinition {
  id: string;
  slot: number; // 1-10 (maps to cd_1...cd_10)
  name: string;
  category: string;
  order?: number; // Display order within category (for UI sorting)
  rules: CustomDimensionRule[];
  defaultValue?: string;
  version: string; // Hash of rules config for staleness detection
  createdAt: string;
  updatedAt: string;
}

export interface CustomDimensionWithStaleness extends CustomDimensionDefinition {
  staleSessionCount: number;
  totalSessionCount: number;
}

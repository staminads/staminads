import { CustomDimensionDefinition } from '../../custom-dimensions/entities/custom-dimension.entity';
import { FilterDefinition } from '../../filters/entities/filter.entity';

export type WorkspaceStatus = 'initializing' | 'active' | 'inactive' | 'error';

export interface Workspace {
  id: string;
  name: string;
  website: string;
  timezone: string;
  currency: string;
  logo_url?: string;
  created_at: string;
  updated_at: string;
  timescore_reference: number;
  status: WorkspaceStatus;
  custom_dimensions?: CustomDimensionDefinition[];
  filters?: FilterDefinition[];
}

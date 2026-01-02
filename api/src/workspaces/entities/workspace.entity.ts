import { FilterDefinition } from '../../filters/entities/filter.entity';
import { Integration } from './integration.entity';

export type WorkspaceStatus = 'initializing' | 'active' | 'inactive' | 'error';

/**
 * Custom dimension labels map.
 * Maps slot number (as string) to label.
 * Example: { "1": "Channel Group", "2": "Channel" }
 */
export type CustomDimensionLabels = Record<string, string>;

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
  bounce_threshold: number;
  status: WorkspaceStatus;
  custom_dimensions?: CustomDimensionLabels | null;
  filters?: FilterDefinition[];
  integrations?: Integration[];

  // Geo settings
  geo_enabled: boolean;
  geo_store_city: boolean;
  geo_store_region: boolean;
  geo_coordinates_precision: number;
}

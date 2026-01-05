import { FilterDefinition } from '../../filters/entities/filter.entity';
import { Integration } from './integration.entity';

export type WorkspaceStatus = 'initializing' | 'active' | 'inactive' | 'error';

/**
 * Custom dimension labels map.
 * Maps slot number (as string) to label.
 * Example: { "1": "Channel Group", "2": "Channel" }
 */
export type CustomDimensionLabels = Record<string, string>;

/**
 * Annotation for marking significant dates on charts.
 */
export interface Annotation {
  id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  time: string; // HH:mm format (e.g., '14:30')
  timezone: string; // IANA timezone (e.g., 'America/New_York')
  title: string;
  description?: string;
  color?: string; // Hex color, defaults to '#7763f1'
}

/**
 * SMTP settings for workspace email configuration.
 * TLS mode is auto-detected based on port: 465 = implicit TLS, others = STARTTLS
 */
export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password_encrypted?: string;
  from_name: string;
  from_email: string;
}

/**
 * Workspace settings stored as JSON in the settings column.
 */
export interface WorkspaceSettings {
  // TimeScore configuration
  timescore_reference: number;
  bounce_threshold: number;

  // Custom dimensions
  custom_dimensions?: CustomDimensionLabels | null;

  // Filters
  filters?: FilterDefinition[];

  // Integrations
  integrations?: Integration[];

  // Geo settings
  geo_enabled: boolean;
  geo_store_city: boolean;
  geo_store_region: boolean;
  geo_coordinates_precision: number;

  // Annotations
  annotations?: Annotation[];

  // SMTP settings
  smtp?: SmtpSettings;
}

/**
 * Default settings for new workspaces.
 */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  timescore_reference: 60,
  bounce_threshold: 10,
  custom_dimensions: { '1': 'Channel Group', '2': 'Channel' },
  filters: [],
  integrations: [],
  geo_enabled: true,
  geo_store_city: true,
  geo_store_region: true,
  geo_coordinates_precision: 2,
  annotations: [],
};

/**
 * Workspace entity - represents the full workspace.
 * Top-level columns remain for quick access/querying.
 * Configurable settings are stored in the `settings` JSON field.
 */
export interface Workspace {
  id: string;
  name: string;
  website: string;
  timezone: string;
  currency: string;
  logo_url?: string;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
  settings: WorkspaceSettings;
}

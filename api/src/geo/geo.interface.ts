/**
 * Geographic location data derived from IP address lookup.
 */
export interface GeoLocation {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "FR", "DE") */
  country: string | null;
  /** State/province/subdivision name */
  region: string | null;
  /** City name */
  city: string | null;
  /** Decimal degrees latitude */
  latitude: number | null;
  /** Decimal degrees longitude */
  longitude: number | null;
}

/**
 * Empty geo location object for when lookup fails or is disabled.
 */
export const EMPTY_GEO: GeoLocation = {
  country: null,
  region: null,
  city: null,
  latitude: null,
  longitude: null,
};

/**
 * Workspace-level geo location settings.
 */
export interface GeoSettings {
  /** Whether geo-location tracking is enabled */
  geo_enabled: boolean;
  /** Whether to store city name */
  geo_store_city: boolean;
  /** Whether to store region/state name */
  geo_store_region: boolean;
  /** Decimal places for lat/long (0, 1, or 2) */
  geo_coordinates_precision: number;
}

/**
 * Default geo settings for new workspaces.
 */
export const DEFAULT_GEO_SETTINGS: GeoSettings = {
  geo_enabled: true,
  geo_store_city: true,
  geo_store_region: true,
  geo_coordinates_precision: 2,
};

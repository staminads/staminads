import {
  DatePreset,
  FilterDto,
  MetricFilterDto,
} from '../../analytics/dto/analytics-query.dto';

/**
 * Explore page configuration output from AI assistant.
 * Matches the URL params structure used by the frontend.
 */
export interface ExploreConfigOutput {
  dimensions?: string[];
  filters?: FilterDto[];
  metricFilters?: MetricFilterDto[];
  period?: DatePreset;
  comparison?: 'previous_period' | 'previous_year' | 'none';
  minSessions?: number;
  customStart?: string;
  customEnd?: string;
}

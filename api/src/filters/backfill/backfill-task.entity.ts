export type BackfillTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BackfillTask {
  id: string;
  workspace_id: string;
  status: BackfillTaskStatus;
  lookback_days: number;
  chunk_size_days: number;
  batch_size: number;
  total_sessions: number;
  processed_sessions: number;
  total_events: number;
  processed_events: number;
  current_date_chunk: string | null;
  created_at: string;
  updated_at: string; // Used by ReplacingMergeTree for row versioning
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  filters_snapshot: string; // JSON string of FilterDefinition[]
}

export interface BackfillTaskProgress {
  id: string;
  status: BackfillTaskStatus;
  progress_percent: number;
  sessions: {
    processed: number;
    total: number;
  };
  events: {
    processed: number;
    total: number;
  };
  current_chunk: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  estimated_remaining_seconds: number | null;
  filter_version: string;
}

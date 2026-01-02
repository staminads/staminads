import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from '../types/workspace'
import type {
  AnalyticsQuery,
  AnalyticsResponse,
  MetricDefinition,
  DimensionDefinition,
  ExtremesQuery,
  ExtremesResponse,
} from '../types/analytics'
import type {
  FilterDefinition,
  FilterWithStaleness,
  CreateFilterInput,
  UpdateFilterInput,
  ReorderFiltersInput,
  BackfillSummary,
  BackfillTaskProgress,
  StartBackfillInput,
} from '../types/filters'
import type { AssistantChatRequest } from '../types/assistant'

export interface WebsiteMetaResponse {
  title?: string
  logo_url?: string
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token')
  const res = await fetch(`/api/${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.message || 'Request failed')
  }
  return res.json()
}

export const api = {
  workspaces: {
    list: () => request<Workspace[]>('workspaces.list'),
    get: (id: string) => request<Workspace>(`workspaces.get?id=${id}`),
    create: (data: CreateWorkspaceInput) =>
      request<Workspace>('workspaces.create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (data: UpdateWorkspaceInput) =>
      request<Workspace>('workspaces.update', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>('workspaces.delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
  },
  analytics: {
    query: (data: AnalyticsQuery) =>
      request<AnalyticsResponse>('analytics.query', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    extremes: (data: ExtremesQuery) =>
      request<ExtremesResponse>('analytics.extremes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    metrics: () => request<Record<string, MetricDefinition>>('analytics.metrics'),
    dimensions: () => request<Record<string, DimensionDefinition>>('analytics.dimensions'),
  },
  tools: {
    websiteMeta: (url: string) =>
      request<WebsiteMetaResponse>('tools.websiteMeta', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
  },
  filters: {
    list: (workspaceId: string, tags?: string[]) => {
      const params = new URLSearchParams({ workspace_id: workspaceId })
      if (tags?.length) {
        tags.forEach(tag => params.append('tags', tag))
      }
      return request<FilterWithStaleness[]>(`filters.list?${params}`)
    },
    get: (workspaceId: string, id: string) =>
      request<FilterWithStaleness>(`filters.get?workspace_id=${workspaceId}&id=${id}`),
    create: (data: CreateFilterInput) =>
      request<FilterDefinition>('filters.create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (data: UpdateFilterInput) =>
      request<FilterDefinition>('filters.update', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (workspaceId: string, id: string) =>
      request<{ success: boolean }>(`filters.delete?workspace_id=${workspaceId}&id=${id}`, {
        method: 'POST',
      }),
    reorder: (data: ReorderFiltersInput) =>
      request<{ success: boolean }>('filters.reorder', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listTags: (workspaceId: string) =>
      request<string[]>(`filters.listTags?workspace_id=${workspaceId}`),
    backfillSummary: (workspaceId: string) =>
      request<BackfillSummary>(`filters.backfillSummary?workspace_id=${workspaceId}`),
    backfillStart: (data: StartBackfillInput) =>
      request<{ task_id: string }>('filters.backfillStart', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    backfillStatus: (taskId: string) =>
      request<BackfillTaskProgress>(`filters.backfillStatus?task_id=${taskId}`),
    backfillCancel: (taskId: string) =>
      request<{ success: boolean }>(`filters.backfillCancel?task_id=${taskId}`, {
        method: 'POST',
      }),
  },
  assistant: {
    chat: (data: AssistantChatRequest) =>
      request<{ job_id: string }>('assistant.chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
}

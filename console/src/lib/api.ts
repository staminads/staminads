import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from '../types/workspace'
import type { AnalyticsQuery, AnalyticsResponse, MetricDefinition, DimensionDefinition } from '../types/analytics'
import type {
  CustomDimensionDefinition,
  CustomDimensionWithStaleness,
  CreateCustomDimensionInput,
  UpdateCustomDimensionInput,
  ReorderCustomDimensionsInput,
  TestCustomDimensionInput,
  TestResult,
} from '../types/custom-dimensions'
import type {
  FilterDefinition,
  FilterWithStaleness,
  CreateFilterInput,
  UpdateFilterInput,
  ReorderFiltersInput,
  TestFilterInput,
  TestFilterResult,
} from '../types/filters'

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
  if (!res.ok) throw new Error('Request failed')
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
  customDimensions: {
    list: (workspaceId: string) =>
      request<CustomDimensionWithStaleness[]>(`customDimensions.list?workspace_id=${workspaceId}`),
    get: (workspaceId: string, id: string) =>
      request<CustomDimensionWithStaleness>(`customDimensions.get?workspace_id=${workspaceId}&id=${id}`),
    create: (data: CreateCustomDimensionInput) =>
      request<CustomDimensionDefinition>('customDimensions.create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (data: UpdateCustomDimensionInput) =>
      request<CustomDimensionDefinition>('customDimensions.update', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (workspaceId: string, id: string) =>
      request<{ success: boolean }>(`customDimensions.delete?workspace_id=${workspaceId}&id=${id}`, {
        method: 'POST',
      }),
    reorder: (data: ReorderCustomDimensionsInput) =>
      request<{ success: boolean }>('customDimensions.reorder', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    test: (data: TestCustomDimensionInput) =>
      request<TestResult>('customDimensions.test', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    backfill: (workspaceId: string, id: string) =>
      request<{ updated: number }>(`customDimensions.backfill?workspace_id=${workspaceId}&id=${id}`, {
        method: 'POST',
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
    test: (data: TestFilterInput) =>
      request<TestFilterResult>('filters.test', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listTags: (workspaceId: string) =>
      request<string[]>(`filters.listTags?workspace_id=${workspaceId}`),
  },
}

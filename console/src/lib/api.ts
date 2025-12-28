import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from '../types/workspace'
import type { AnalyticsQuery, AnalyticsResponse, MetricDefinition, DimensionDefinition } from '../types/analytics'

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
}

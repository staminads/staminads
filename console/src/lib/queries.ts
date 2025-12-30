import { queryOptions } from '@tanstack/react-query'
import { api } from './api'
import type { AnalyticsQuery } from '../types/analytics'

export const workspacesQueryOptions = queryOptions({
  queryKey: ['workspaces'],
  queryFn: api.workspaces.list,
})

export const workspaceQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['workspaces', id],
    queryFn: () => api.workspaces.get(id),
  })

export const analyticsMetricsQueryOptions = queryOptions({
  queryKey: ['analytics', 'metrics'],
  queryFn: api.analytics.metrics,
  staleTime: Infinity,
})

export const analyticsDimensionsQueryOptions = queryOptions({
  queryKey: ['analytics', 'dimensions'],
  queryFn: api.analytics.dimensions,
  staleTime: Infinity,
})

export const analyticsQueryOptions = (query: AnalyticsQuery) =>
  queryOptions({
    queryKey: ['analytics', 'query', query],
    queryFn: () => api.analytics.query(query),
  })

export const customDimensionsQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: ['customDimensions', workspaceId],
    queryFn: () => api.customDimensions.list(workspaceId),
  })

export const filtersQueryOptions = (workspaceId: string, tags?: string[]) =>
  queryOptions({
    queryKey: ['filters', workspaceId, { tags }],
    queryFn: () => api.filters.list(workspaceId, tags),
  })

export const filterTagsQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: ['filters', workspaceId, 'tags'],
    queryFn: () => api.filters.listTags(workspaceId),
  })

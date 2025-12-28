import { queryOptions } from '@tanstack/react-query'
import { api } from './api'

export const workspacesQueryOptions = queryOptions({
  queryKey: ['workspaces'],
  queryFn: api.workspaces.list,
})

export const workspaceQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['workspaces', id],
    queryFn: () => api.workspaces.get(id),
  })

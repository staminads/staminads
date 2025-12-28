import type { Workspace, CreateWorkspaceInput } from '../types/workspace'

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
  },
  tools: {
    websiteMeta: (url: string) =>
      request<WebsiteMetaResponse>('tools.websiteMeta', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
  },
}

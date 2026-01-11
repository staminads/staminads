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
import type {
  LoginResponse,
  RegisterRequest,
  Session,
  User,
} from '../types/auth'
import type {
  SmtpSettings,
  SmtpInfo,
  UpdateSmtpInput,
  TestSmtpResponse
} from '../types/smtp'
import type {
  PublicApiKey,
  CreateApiKeyInput,
  CreateApiKeyResponse,
  RevokeApiKeyInput,
} from '../types/api-keys'
import type {
  InvitationDetails,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
} from '../types/invitation'
import type { Member, Invitation, Role } from '../types/member'

// Extract error message from NestJS response (handles both string and array formats)
function extractErrorMessage(errorData: { message?: string | string[] }, fallback: string): string {
  if (!errorData.message) return fallback
  return Array.isArray(errorData.message) ? errorData.message[0] : errorData.message
}

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
    // Handle expired/invalid token - redirect to logout route
    if (res.status === 401) {
      window.location.href = '/logout'
      throw new Error('Session expired')
    }
    const errorData = await res.json().catch(() => ({}))
    throw new Error(extractErrorMessage(errorData, 'Request failed'))
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
  auth: {
    login: async (email: string, password: string): Promise<LoginResponse> => {
      const res = await fetch('/api/auth.login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(error, 'Login failed'))
      }
      return res.json()
    },

    register: async (data: RegisterRequest): Promise<LoginResponse> => {
      const res = await fetch('/api/auth.register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(error, 'Registration failed'))
      }
      return res.json()
    },

    me: async (): Promise<User> => {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth.me', {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      })
      if (!res.ok) throw new Error('Failed to get user profile')
      return res.json()
    },

    updateProfile: async (data: { name?: string; email?: string }): Promise<User> => {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth.updateProfile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update profile')
      return res.json()
    },

    changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth.changePassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(error, 'Failed to change password'))
      }
    },

    forgotPassword: async (email: string): Promise<void> => {
      const res = await fetch('/api/auth.forgotPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error('Request failed')
    },

    resetPassword: async (token: string, newPassword: string): Promise<void> => {
      const res = await fetch('/api/auth.resetPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(error, 'Password reset failed'))
      }
    },

    sessions: async (): Promise<Session[]> => {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth.sessions', {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      })
      if (!res.ok) throw new Error('Failed to get sessions')
      return res.json()
    },

    revokeSession: async (sessionId: string): Promise<void> => {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/auth.revokeSession?sessionId=${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      })
      if (!res.ok) throw new Error('Failed to revoke session')
    },

    revokeAllSessions: async (): Promise<void> => {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth.revokeAllSessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      })
      if (!res.ok) throw new Error('Failed to revoke sessions')
    },
  },
  smtp: {
    info: (workspaceId: string) =>
      request<SmtpInfo>(`smtp.info?workspace_id=${workspaceId}`),

    update: (workspaceId: string, data: UpdateSmtpInput) =>
      request<SmtpSettings>('smtp.update', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, ...data }),
      }),

    delete: (workspaceId: string) =>
      request<{ success: boolean }>('smtp.delete', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId }),
      }),

    test: (workspaceId: string, toEmail: string) =>
      request<TestSmtpResponse>('smtp.test', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, to_email: toEmail }),
      }),
  },
  apiKeys: {
    list: (workspaceId: string) => {
      const params = new URLSearchParams({ workspace_id: workspaceId })
      return request<PublicApiKey[]>(`apiKeys.list?${params}`)
    },

    create: (data: CreateApiKeyInput) =>
      request<CreateApiKeyResponse>('apiKeys.create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    revoke: (data: RevokeApiKeyInput) =>
      request<{ success: boolean }>('apiKeys.revoke', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  invitations: {
    get: async (token: string): Promise<InvitationDetails> => {
      const res = await fetch(`/api/invitations.get?token=${encodeURIComponent(token)}`)
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(error, 'Invalid invitation'))
      }
      return res.json()
    },

    accept: async (data: AcceptInvitationRequest): Promise<AcceptInvitationResponse> => {
      const res = await fetch('/api/invitations.accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(extractErrorMessage(error, 'Failed to accept invitation'))
      }
      return res.json()
    },

    list: (workspaceId: string) =>
      request<Invitation[]>(`invitations.list?workspaceId=${workspaceId}`),

    create: (workspaceId: string, email: string, role: Exclude<Role, 'owner'>) =>
      request<Invitation>('invitations.create', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, email, role }),
      }),

    resend: (id: string) =>
      request<{ success: boolean }>('invitations.resend', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),

    revoke: (id: string) =>
      request<{ success: boolean }>('invitations.revoke', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
  },
  members: {
    list: (workspaceId: string) =>
      request<Member[]>(`members.list?workspace_id=${workspaceId}`),

    updateRole: (workspaceId: string, userId: string, role: Exclude<Role, 'owner'>) =>
      request<Member>('members.updateRole', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, user_id: userId, role }),
      }),

    remove: (workspaceId: string, userId: string) =>
      request<{ success: boolean }>('members.remove', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, user_id: userId }),
      }),

    transferOwnership: (workspaceId: string, newOwnerId: string) =>
      request<{ success: boolean }>('members.transferOwnership', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, new_owner_id: newOwnerId }),
      }),
  },
}

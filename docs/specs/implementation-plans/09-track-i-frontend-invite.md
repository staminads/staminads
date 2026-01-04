# Track I: Frontend Invitation Acceptance Implementation Plan

**Track:** I - Invitation Acceptance Page
**Dependencies:** API contracts from Track D (Invitations)
**Blocks:** None (user-facing feature)

---

## Overview

This track implements the invitation acceptance page where users click through from email links to join workspaces. It handles both new user registration and existing user confirmation flows.

---

## Files to Create

```
console/src/routes/
└── invite.$token.tsx

console/src/types/
└── invitation.ts (new)

console/src/lib/
└── api.ts (add invitation methods)
```

---

## Task 1: Invitation Types

**File:** `console/src/types/invitation.ts`

```typescript
export interface InvitationDetails {
  id: string;
  workspace: {
    id: string;
    name: string;
    website: string;
    logo_url?: string;
  };
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  inviter: {
    name: string;
  };
  existingUser: boolean;
  expiresAt: string;
}

export interface AcceptInvitationRequest {
  token: string;
  name?: string;
  password?: string;
}

export interface AcceptInvitationResponse {
  userId: string;
  workspaceId: string;
}
```

---

## Task 2: API Client Updates

**File:** `console/src/lib/api.ts` (add to existing)

```typescript
import type {
  InvitationDetails,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
} from '../types/invitation';

// Add to api object
export const api = {
  // ... existing methods

  invitations: {
    get: async (token: string): Promise<InvitationDetails> => {
      const res = await fetch(`/api/invitations.get?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Invalid invitation');
      }
      return res.json();
    },

    accept: async (data: AcceptInvitationRequest): Promise<AcceptInvitationResponse> => {
      const res = await fetch('/api/invitations.accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to accept invitation');
      }
      return res.json();
    },

    // Authenticated endpoints
    list: async (workspaceId: string) => {
      const res = await fetchWithAuth(`/api/invitations.list?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error('Failed to list invitations');
      return res.json();
    },

    create: async (workspaceId: string, email: string, role: string) => {
      const res = await fetchWithAuth('/api/invitations.create', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, email, role }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to send invitation');
      }
      return res.json();
    },

    resend: async (id: string) => {
      const res = await fetchWithAuth(`/api/invitations.resend?id=${id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to resend invitation');
    },

    revoke: async (id: string) => {
      const res = await fetchWithAuth(`/api/invitations.revoke?id=${id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to revoke invitation');
    },
  },
};
```

---

## Task 3: Invitation Acceptance Page

**File:** `console/src/routes/invite.$token.tsx`

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { createFileRoute } from '@tanstack/react-router';
import {
  Card,
  Typography,
  Button,
  Form,
  Input,
  Alert,
  Spin,
  Result,
  Avatar,
  Tag,
  Divider,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  TeamOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { InvitationDetails } from '../types/invitation';

const { Title, Text, Paragraph } = Typography;

export const Route = createFileRoute('/invite/$token')({
  component: InviteAcceptPage,
});

function InviteAcceptPage() {
  const { token } = useParams({ from: '/invite/$token' });
  const navigate = useNavigate();
  const { user, isAuthenticated, setToken: setAuthToken } = useAuth();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // Fetch invitation details
  useEffect(() => {
    const fetchInvitation = async () => {
      try {
        const data = await api.invitations.get(token);
        setInvitation(data);

        // Check if expired
        if (new Date(data.expiresAt) < new Date()) {
          setExpired(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid invitation');
      } finally {
        setLoading(false);
      }
    };

    fetchInvitation();
  }, [token]);

  // Handle new user registration
  const handleNewUserSubmit = async (values: {
    name: string;
    password: string;
    confirmPassword: string;
  }) => {
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setAccepting(true);
    setError(null);

    try {
      const result = await api.invitations.accept({
        token,
        name: values.name,
        password: values.password,
      });

      // Auto-login after registration
      const loginResponse = await api.auth.login(invitation!.email, values.password);
      setAuthToken(loginResponse.access_token);

      navigate({ to: `/workspaces/${result.workspaceId}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  // Handle existing user confirmation
  const handleExistingUserAccept = async () => {
    setAccepting(true);
    setError(null);

    try {
      const result = await api.invitations.accept({ token });
      navigate({ to: `/workspaces/${result.workspaceId}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spin size="large" tip="Loading invitation..." />
      </div>
    );
  }

  // Error state
  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <Result
            status="error"
            title="Invalid Invitation"
            subTitle={error}
            extra={
              <Link to="/login">
                <Button type="primary">Go to Login</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  // Expired state
  if (expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <Result
            status="warning"
            title="Invitation Expired"
            subTitle="This invitation link has expired. Please contact the workspace administrator for a new invitation."
            extra={
              <Link to="/login">
                <Button type="primary">Go to Login</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  if (!invitation) return null;

  const roleColors: Record<string, string> = {
    admin: 'purple',
    editor: 'blue',
    viewer: 'default',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        {/* Workspace Info */}
        <div className="text-center mb-6">
          {invitation.workspace.logo_url ? (
            <Avatar
              src={invitation.workspace.logo_url}
              size={64}
              className="mb-4"
            />
          ) : (
            <Avatar
              size={64}
              icon={<TeamOutlined />}
              className="mb-4 bg-purple-500"
            />
          )}

          <Title level={3} className="!mb-1">
            Join {invitation.workspace.name}
          </Title>

          <div className="flex items-center justify-center gap-2 text-gray-500 mb-2">
            <GlobalOutlined />
            <Text type="secondary">{invitation.workspace.website}</Text>
          </div>

          <Tag color={roleColors[invitation.role]}>
            {invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
          </Tag>
        </div>

        <Divider />

        <Paragraph className="text-center text-gray-600 mb-6">
          <strong>{invitation.inviter.name}</strong> invited you to join this
          workspace as {invitation.role === 'admin' ? 'an' : 'a'}{' '}
          <strong>{invitation.role}</strong>.
        </Paragraph>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            className="mb-6"
            closable
            onClose={() => setError(null)}
          />
        )}

        {/* Existing User Flow */}
        {invitation.existingUser ? (
          <div>
            {isAuthenticated && user?.email === invitation.email ? (
              // Logged in as correct user
              <div className="text-center">
                <Paragraph>
                  You're signed in as <strong>{user.email}</strong>
                </Paragraph>
                <Button
                  type="primary"
                  size="large"
                  block
                  loading={accepting}
                  onClick={handleExistingUserAccept}
                >
                  Accept Invitation
                </Button>
              </div>
            ) : isAuthenticated ? (
              // Logged in as different user
              <div className="text-center">
                <Alert
                  type="warning"
                  message="Email Mismatch"
                  description={`This invitation is for ${invitation.email}, but you're signed in as ${user?.email}. Please log out and sign in with the correct account.`}
                  className="mb-4"
                />
                <Link to="/login">
                  <Button type="primary" size="large" block>
                    Sign in as {invitation.email}
                  </Button>
                </Link>
              </div>
            ) : (
              // Not logged in
              <div className="text-center">
                <Paragraph>
                  You already have an account. Please sign in to accept this
                  invitation.
                </Paragraph>
                <Link to={`/login?redirect=/invite/${token}`}>
                  <Button type="primary" size="large" block>
                    Sign in to Accept
                  </Button>
                </Link>
              </div>
            )}
          </div>
        ) : (
          /* New User Registration Flow */
          <div>
            <Paragraph className="text-center mb-4">
              Create your account to join the workspace
            </Paragraph>

            <Form
              name="accept-invitation"
              onFinish={handleNewUserSubmit}
              layout="vertical"
              size="large"
            >
              <Form.Item label="Email">
                <Input
                  value={invitation.email}
                  disabled
                  prefix={<UserOutlined />}
                />
              </Form.Item>

              <Form.Item
                name="name"
                label="Your Name"
                rules={[
                  { required: true, message: 'Please enter your name' },
                  { min: 1, max: 100, message: 'Name must be 1-100 characters' },
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="Enter your full name"
                  autoComplete="name"
                />
              </Form.Item>

              <Form.Item
                name="password"
                label="Password"
                rules={[
                  { required: true, message: 'Please enter a password' },
                  { min: 8, message: 'Password must be at least 8 characters' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Create a password"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                rules={[
                  { required: true, message: 'Please confirm your password' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('Passwords do not match'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={accepting}
                >
                  Create Account & Join
                </Button>
              </Form.Item>
            </Form>
          </div>
        )}

        <Divider />

        <div className="text-center text-sm text-gray-500">
          <Text type="secondary">
            By joining, you agree to the workspace's terms and policies.
          </Text>
        </div>
      </Card>
    </div>
  );
}
```

---

## Task 4: Update Router Configuration

Make sure the route is registered in the router. With TanStack Router's file-based routing, the file location handles this automatically.

---

## Deliverables Checklist

- [ ] `console/src/types/invitation.ts`
- [ ] `console/src/lib/api.ts` (invitation methods added)
- [ ] `console/src/routes/invite.$token.tsx`
- [ ] Route properly registered
- [ ] Loading state shows spinner
- [ ] Error states handled (invalid, expired)
- [ ] New user registration form works
- [ ] Existing user confirmation works
- [ ] Email mismatch detection works
- [ ] Redirect after acceptance works

---

## User Flows

### New User Flow
1. Click email link → `/invite/{token}`
2. See workspace info and role
3. Enter name and password
4. Click "Create Account & Join"
5. Auto-login and redirect to workspace

### Existing User (Logged In as Correct User)
1. Click email link → `/invite/{token}`
2. See "You're signed in as X"
3. Click "Accept Invitation"
4. Redirect to workspace

### Existing User (Logged In as Wrong User)
1. Click email link → `/invite/{token}`
2. See warning about email mismatch
3. Click to sign in with correct account
4. After login, return to accept

### Existing User (Not Logged In)
1. Click email link → `/invite/{token}`
2. See "Please sign in to accept"
3. Click to sign in
4. After login, return to accept

---

## Acceptance Criteria

1. Token is extracted from URL correctly
2. Invalid tokens show appropriate error
3. Expired invitations show warning
4. Workspace info (name, logo, website) displayed
5. Role badge shows correctly
6. New user form validates all fields
7. Password confirmation works
8. Existing user detection works
9. Email mismatch shows warning
10. Successful acceptance redirects to workspace
11. Auto-login works for new users

# Track H: Frontend Auth Pages Implementation Plan

**Track:** H - Frontend Auth Pages
**Dependencies:** API contracts from Tracks A, G
**Blocks:** None (user-facing feature)

---

## Overview

This track implements the frontend authentication pages including login updates, registration, forgot password, and password reset flows.

---

## Files to Create/Modify

```
console/src/routes/
├── login.tsx (modify)
├── register.tsx (new)
├── forgot-password.tsx (new)
└── reset-password.$token.tsx (new)

console/src/lib/
├── api.ts (modify - add auth methods)
└── auth.tsx (modify - update for user profile)

console/src/types/
└── auth.ts (new)
```

---

## Task 1: Auth Types

**File:** `console/src/types/auth.ts`

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
}

export interface LoginResponse {
  access_token: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
  invitationToken?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface Session {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
}
```

---

## Task 2: API Client Updates

**File:** `console/src/lib/api.ts` (add to existing)

```typescript
import type {
  LoginResponse,
  RegisterRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  Session,
  User,
} from '../types/auth';

// Add to api object
export const api = {
  // ... existing methods

  auth: {
    login: async (email: string, password: string): Promise<LoginResponse> => {
      const res = await fetch('/api/auth.login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Login failed');
      }
      return res.json();
    },

    register: async (data: RegisterRequest): Promise<LoginResponse> => {
      const res = await fetch('/api/auth.register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Registration failed');
      }
      return res.json();
    },

    me: async (): Promise<User> => {
      const res = await fetchWithAuth('/api/auth.me');
      if (!res.ok) throw new Error('Failed to get user profile');
      return res.json();
    },

    updateProfile: async (data: { name?: string; email?: string }): Promise<User> => {
      const res = await fetchWithAuth('/api/auth.updateProfile', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update profile');
      return res.json();
    },

    changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
      const res = await fetchWithAuth('/api/auth.changePassword', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to change password');
      }
    },

    forgotPassword: async (email: string): Promise<void> => {
      const res = await fetch('/api/auth.forgotPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Request failed');
    },

    resetPassword: async (token: string, newPassword: string): Promise<void> => {
      const res = await fetch('/api/auth.resetPassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Password reset failed');
      }
    },

    sessions: async (): Promise<Session[]> => {
      const res = await fetchWithAuth('/api/auth.sessions');
      if (!res.ok) throw new Error('Failed to get sessions');
      return res.json();
    },

    revokeSession: async (sessionId: string): Promise<void> => {
      const res = await fetchWithAuth(`/api/auth.revokeSession?sessionId=${sessionId}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to revoke session');
    },

    revokeAllSessions: async (): Promise<void> => {
      const res = await fetchWithAuth('/api/auth.revokeAllSessions', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to revoke sessions');
    },
  },
};
```

---

## Task 3: Update Login Page

**File:** `console/src/routes/login.tsx` (modify existing)

```tsx
import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { Form, Input, Button, Card, Typography, Alert, Divider } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

const { Title, Text } = Typography;

export default function LoginPage() {
  const navigate = useNavigate();
  const { setToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.auth.login(values.email, values.password);
      setToken(response.access_token);
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <Title level={2} className="!mb-2">Welcome back</Title>
          <Text type="secondary">Sign in to your account</Text>
        </div>

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

        <Form
          name="login"
          onFinish={onFinish}
          layout="vertical"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="Email"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Password"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item className="mb-2">
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              Sign in
            </Button>
          </Form.Item>

          <div className="text-center">
            <Link
              to="/forgot-password"
              className="text-sm text-purple-600 hover:text-purple-700"
            >
              Forgot your password?
            </Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}
```

---

## Task 4: Forgot Password Page

**File:** `console/src/routes/forgot-password.tsx`

```tsx
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { createFileRoute } from '@tanstack/react-router';
import { Form, Input, Button, Card, Typography, Alert, Result } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { api } from '../lib/api';

const { Title, Text } = Typography;

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    setError(null);

    try {
      await api.auth.forgotPassword(values.email);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <Card className="w-full max-w-md">
          <Result
            status="success"
            title="Check your email"
            subTitle="If an account exists with that email, we've sent password reset instructions."
            extra={
              <Link to="/login">
                <Button type="primary">Back to login</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <Title level={2} className="!mb-2">Reset password</Title>
          <Text type="secondary">
            Enter your email and we'll send you a reset link
          </Text>
        </div>

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

        <Form
          name="forgot-password"
          onFinish={onFinish}
          layout="vertical"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="Email"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item className="mb-4">
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              Send reset link
            </Button>
          </Form.Item>

          <div className="text-center">
            <Link
              to="/login"
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              <ArrowLeftOutlined className="mr-1" />
              Back to login
            </Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}
```

---

## Task 5: Reset Password Page

**File:** `console/src/routes/reset-password.$token.tsx`

```tsx
import { useState } from 'react';
import { Link, useParams, useNavigate } from '@tanstack/react-router';
import { createFileRoute } from '@tanstack/react-router';
import { Form, Input, Button, Card, Typography, Alert, Result } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { api } from '../lib/api';

const { Title, Text } = Typography;

export const Route = createFileRoute('/reset-password/$token')({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = useParams({ from: '/reset-password/$token' });
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.auth.resetPassword(token, values.password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <Card className="w-full max-w-md">
          <Result
            status="success"
            title="Password reset successful"
            subTitle="Your password has been updated. You can now sign in with your new password."
            extra={
              <Link to="/login">
                <Button type="primary">Sign in</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <Title level={2} className="!mb-2">Set new password</Title>
          <Text type="secondary">
            Enter your new password below
          </Text>
        </div>

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

        <Form
          name="reset-password"
          onFinish={onFinish}
          layout="vertical"
          size="large"
        >
          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Please enter a password' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="New password"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
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
              placeholder="Confirm password"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              Reset password
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
```

---

## Task 6: Register Page

**File:** `console/src/routes/register.tsx`

```tsx
import { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { createFileRoute } from '@tanstack/react-router';
import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

const { Title, Text } = Typography;

export const Route = createFileRoute('/register')({
  component: RegisterPage,
  validateSearch: (search: Record<string, unknown>) => ({
    email: (search.email as string) || '',
    token: (search.token as string) || '',
  }),
});

function RegisterPage() {
  const navigate = useNavigate();
  const { setToken } = useAuth();
  const search = useSearch({ from: '/register' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => {
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.auth.register({
        email: values.email,
        name: values.name,
        password: values.password,
        invitationToken: search.token || undefined,
      });
      setToken(response.access_token);
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <Title level={2} className="!mb-2">Create your account</Title>
          <Text type="secondary">
            {search.token
              ? 'Complete your registration to accept the invitation'
              : 'Sign up to get started'}
          </Text>
        </div>

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

        <Form
          name="register"
          onFinish={onFinish}
          layout="vertical"
          size="large"
          initialValues={{ email: search.email }}
        >
          <Form.Item
            name="name"
            rules={[
              { required: true, message: 'Please enter your name' },
              { min: 1, max: 100, message: 'Name must be 1-100 characters' },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="Full name"
              autoComplete="name"
            />
          </Form.Item>

          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="Email"
              autoComplete="email"
              disabled={!!search.email}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Please enter a password' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Password"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
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
              placeholder="Confirm password"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item className="mb-4">
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              Create account
            </Button>
          </Form.Item>

          {!search.token && (
            <div className="text-center">
              <Text type="secondary">
                Already have an account?{' '}
                <Link to="/login" className="text-purple-600 hover:text-purple-700">
                  Sign in
                </Link>
              </Text>
            </div>
          )}
        </Form>
      </Card>
    </div>
  );
}
```

---

## Task 7: Update Auth Context

**File:** `console/src/lib/auth.tsx` (update existing)

```tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { api } from './api';
import type { User } from '../types/auth';

interface AuthContextType {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setToken: (token: string | null) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'staminads_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  );
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setToken = (newToken: string | null) => {
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    setTokenState(newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const userData = await api.auth.me();
      setUser(userData);
    } catch (error) {
      // Token invalid - clear it
      logout();
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!token && !!user,
        isLoading,
        setToken,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

---

## Deliverables Checklist

- [ ] `console/src/types/auth.ts`
- [ ] `console/src/lib/api.ts` (auth methods added)
- [ ] `console/src/lib/auth.tsx` (updated with user profile)
- [ ] `console/src/routes/login.tsx` (updated with forgot password link)
- [ ] `console/src/routes/forgot-password.tsx`
- [ ] `console/src/routes/reset-password.$token.tsx`
- [ ] `console/src/routes/register.tsx`
- [ ] Routes registered in router config
- [ ] All components using Ant Design consistently
- [ ] Form validation working
- [ ] Error handling implemented

---

## Acceptance Criteria

1. Login page has "Forgot password?" link
2. Forgot password sends reset email (shows success regardless)
3. Reset password validates token and updates password
4. Password confirmation validation works
5. Registration form captures name, email, password
6. Registration works with invitation tokens
7. Auth context provides user profile data
8. Invalid tokens show appropriate errors
9. Loading states show during API calls
10. Forms use consistent styling with rest of app

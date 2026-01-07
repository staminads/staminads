/**
 * User helper functions for e2e tests
 *
 * Provides utilities for creating test users, authentication, and memberships.
 */

import { INestApplication } from '@nestjs/common';
import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { generateId, hashPassword } from '../../src/common/crypto';
import { toClickHouseDateTime } from './datetime.helper';
import { waitForData } from './wait.helper';
import {
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from '../constants/test-config';

export type UserStatus = 'active' | 'pending' | 'disabled';
export type MembershipRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface CreateUserOptions {
  name?: string;
  status?: UserStatus;
  failedAttempts?: number;
  lockedUntil?: string | null;
  isSuperAdmin?: boolean;
}

export interface UserWithToken {
  id: string;
  token: string;
}

/**
 * Create a test user directly in the database
 *
 * @param client - ClickHouse client for system database
 * @param email - User email
 * @param password - User password (defaults to TEST_PASSWORD)
 * @param options - Additional user options
 * @returns User ID
 *
 * @example
 * const userId = await createTestUser(systemClient, 'user@test.com');
 * const userId = await createTestUser(systemClient, 'user@test.com', 'custompass', { status: 'pending' });
 */
export async function createTestUser(
  client: ClickHouseClient,
  email: string,
  password: string = TEST_PASSWORD,
  options: CreateUserOptions = {},
): Promise<string> {
  const userId = generateId();
  const now = toClickHouseDateTime();

  // Use pre-hashed password for default test password, otherwise hash it
  const passwordHash =
    password === TEST_PASSWORD
      ? TEST_PASSWORD_HASH
      : await hashPassword(password);

  await client.insert({
    table: 'users',
    values: [
      {
        id: userId,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: options.name || 'Test User',
        type: 'user',
        status: options.status || 'active',
        is_super_admin: options.isSuperAdmin ? 1 : 0,
        last_login_at: null,
        failed_login_attempts: options.failedAttempts || 0,
        locked_until: options.lockedUntil || null,
        password_changed_at: now,
        deleted_at: null,
        deleted_by: null,
        created_at: now,
        updated_at: now,
      },
    ],
    format: 'JSONEachRow',
  });

  // Poll until user is visible (faster than fixed 100ms delay)
  await waitForData(
    client,
    'users',
    'id = {id:String}',
    { id: userId },
    { timeoutMs: 2000, intervalMs: 10 },
  );

  return userId;
}

/**
 * Get an authentication token by logging in
 *
 * @param app - NestJS application instance
 * @param email - User email
 * @param password - User password
 * @returns JWT access token
 *
 * @example
 * const token = await getAuthToken(app, 'user@test.com', 'testpass');
 */
export async function getAuthToken(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/auth.login')
    .send({ email, password });

  if (response.status !== 201) {
    throw new Error(
      `Login failed for ${email}: ${response.body.message || JSON.stringify(response.body)}`,
    );
  }

  return response.body.access_token;
}

/**
 * Get auth token for the admin user (from environment)
 *
 * @param app - NestJS application instance
 * @returns JWT access token for admin
 */
export async function getAdminAuthToken(
  app: INestApplication,
): Promise<string> {
  return getAuthToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Create a user and get their auth token in one call
 *
 * @param app - NestJS application instance
 * @param client - ClickHouse client for system database
 * @param email - User email
 * @param password - User password (defaults to TEST_PASSWORD)
 * @param options - Additional user options
 * @returns User ID and auth token
 *
 * @example
 * const { id, token } = await createUserWithToken(app, systemClient, 'user@test.com');
 */
export async function createUserWithToken(
  app: INestApplication,
  client: ClickHouseClient,
  email: string,
  password: string = TEST_PASSWORD,
  options: CreateUserOptions = {},
): Promise<UserWithToken> {
  const id = await createTestUser(client, email, password, options);
  const token = await getAuthToken(app, email, password);
  return { id, token };
}

/**
 * Create a workspace membership
 *
 * @param client - ClickHouse client for system database
 * @param workspaceId - Workspace ID
 * @param userId - User ID
 * @param role - Membership role
 * @param invitedBy - ID of user who invited (optional)
 * @returns Membership ID
 *
 * @example
 * await createMembership(systemClient, workspaceId, userId, 'owner');
 * await createMembership(systemClient, workspaceId, userId, 'editor', ownerUserId);
 */
export async function createMembership(
  client: ClickHouseClient,
  workspaceId: string,
  userId: string,
  role: MembershipRole,
  invitedBy: string | null = null,
): Promise<string> {
  const membershipId = generateId();
  const now = toClickHouseDateTime();

  await client.insert({
    table: 'workspace_memberships',
    values: [
      {
        id: membershipId,
        workspace_id: workspaceId,
        user_id: userId,
        role,
        invited_by: invitedBy,
        joined_at: now,
        created_at: now,
        updated_at: now,
      },
    ],
    format: 'JSONEachRow',
  });

  // Poll until membership is visible (faster than fixed 100ms delay)
  await waitForData(
    client,
    'workspace_memberships',
    'id = {id:String}',
    { id: membershipId },
    { timeoutMs: 2000, intervalMs: 10 },
  );

  return membershipId;
}

/**
 * Create a password reset token for a user
 *
 * @param client - ClickHouse client for system database
 * @param userId - User ID
 * @param expiresInMs - Token expiration time in milliseconds (default: 1 hour)
 * @returns The plain token (not the hash)
 */
export async function createPasswordResetToken(
  client: ClickHouseClient,
  userId: string,
  expiresInMs: number = 60 * 60 * 1000,
): Promise<string> {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMs);
  const tokenId = generateId();

  await client.insert({
    table: 'password_reset_tokens',
    values: [
      {
        id: tokenId,
        user_id: userId,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: toClickHouseDateTime(expiresAt),
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });

  // Poll until token is visible (faster than fixed 100ms delay)
  await waitForData(
    client,
    'password_reset_tokens',
    'id = {id:String}',
    { id: tokenId },
    { timeoutMs: 2000, intervalMs: 10 },
  );

  return token;
}

/**
 * Test scenario users with their tokens
 */
export interface TestScenarioUsers {
  owner: UserWithToken;
  admin: UserWithToken;
  editor: UserWithToken;
  viewer: UserWithToken;
}

/**
 * Setup a complete members test scenario with workspace and 4 users.
 *
 * Creates:
 * - 4 users (owner, admin, editor, viewer)
 * - Workspace membership for each with appropriate role
 *
 * @param app - NestJS application instance
 * @param client - ClickHouse client for system database
 * @param workspaceId - Workspace ID to create memberships for
 * @returns Object with owner, admin, editor, viewer (each has id and token)
 *
 * @example
 * const users = await setupMembersTestScenario(app, systemClient, 'test_ws');
 * const { owner, admin, editor, viewer } = users;
 */
export async function setupMembersTestScenario(
  app: INestApplication,
  client: ClickHouseClient,
  workspaceId: string,
): Promise<TestScenarioUsers> {
  // Create users in parallel (each has unique email/ID, so no conflicts)
  const [owner, admin, editor, viewer] = await Promise.all([
    createUserWithToken(app, client, 'owner@test.com', undefined, {
      name: 'Owner User',
    }),
    createUserWithToken(app, client, 'admin-role@test.com', undefined, {
      name: 'Admin Role User',
    }),
    createUserWithToken(app, client, 'editor@test.com', undefined, {
      name: 'Editor User',
    }),
    createUserWithToken(app, client, 'viewer@test.com', undefined, {
      name: 'Viewer User',
    }),
  ]);

  // Create memberships in parallel (no dependencies between them)
  await Promise.all([
    createMembership(client, workspaceId, owner.id, 'owner'),
    createMembership(client, workspaceId, admin.id, 'admin', owner.id),
    createMembership(client, workspaceId, editor.id, 'editor', owner.id),
    createMembership(client, workspaceId, viewer.id, 'viewer', owner.id),
  ]);

  return { owner, admin, editor, viewer };
}

/**
 * Test context for invitations tests
 */
export interface InvitationsTestContext {
  workspaceId: string;
  owner: UserWithToken;
  editor: UserWithToken;
  viewer: UserWithToken;
}

/**
 * Setup test scenario for invitation tests.
 *
 * Creates:
 * - A test workspace
 * - 3 users (owner, editor, viewer) with memberships
 *
 * @param app - NestJS application instance
 * @param client - ClickHouse client for system database
 * @param createWorkspaceFn - Function to create workspace
 * @returns Test context with workspace and users
 *
 * @example
 * const ctx = await setupInvitationsTestScenario(app, systemClient, createTestWorkspace);
 */
export async function setupInvitationsTestScenario(
  app: INestApplication,
  client: ClickHouseClient,
  createWorkspaceFn: (
    client: ClickHouseClient,
    id: string,
    options?: Record<string, unknown>,
  ) => Promise<string>,
): Promise<InvitationsTestContext> {
  // Create workspace
  const workspaceId = 'test_ws_inv';
  await createWorkspaceFn(client, workspaceId, { name: 'Test Workspace' });

  // Create users in parallel
  const [owner, editor, viewer] = await Promise.all([
    createUserWithToken(app, client, 'inv-owner@test.com', undefined, {
      name: 'Invitation Owner',
    }),
    createUserWithToken(app, client, 'inv-editor@test.com', undefined, {
      name: 'Invitation Editor',
    }),
    createUserWithToken(app, client, 'inv-viewer@test.com', undefined, {
      name: 'Invitation Viewer',
    }),
  ]);

  // Create memberships in parallel
  await Promise.all([
    createMembership(client, workspaceId, owner.id, 'owner'),
    createMembership(client, workspaceId, editor.id, 'editor', owner.id),
    createMembership(client, workspaceId, viewer.id, 'viewer', owner.id),
  ]);

  return { workspaceId, owner, editor, viewer };
}

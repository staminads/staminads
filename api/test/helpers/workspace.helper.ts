/**
 * Workspace helper functions for e2e tests
 *
 * Provides utilities for creating test workspaces, API keys, and related entities.
 */

import { ClickHouseClient } from '@clickhouse/client';
import { generateId, generateApiKeyToken } from '../../src/common/crypto';
import { toClickHouseDateTime } from './datetime.helper';
import { waitForData } from './wait.helper';

export interface WorkspaceSettings {
  timescore_reference?: number;
  bounce_threshold?: number;
}

export interface CreateWorkspaceOptions {
  name?: string;
  website?: string;
  timezone?: string;
  currency?: string;
  status?: 'active' | 'inactive';
  settings?: WorkspaceSettings;
}

export interface CreateApiKeyOptions {
  name?: string;
  description?: string;
  scopes?: string[];
  userId?: string;
  expiresAt?: Date | null;
}

/**
 * Create a test workspace directly in the database
 *
 * @param client - ClickHouse client for system database
 * @param id - Workspace ID (optional, generates one if not provided)
 * @param options - Workspace options
 * @returns Workspace ID
 *
 * @example
 * const wsId = await createTestWorkspace(systemClient);
 * const wsId = await createTestWorkspace(systemClient, 'my-ws-id', { name: 'My Workspace' });
 */
export async function createTestWorkspace(
  client: ClickHouseClient,
  id?: string,
  options: CreateWorkspaceOptions = {},
): Promise<string> {
  const workspaceId = id || generateId();
  const now = toClickHouseDateTime();

  const settings: WorkspaceSettings = {
    timescore_reference: 60,
    bounce_threshold: 10,
    ...options.settings,
  };

  const workspace = {
    id: workspaceId,
    name: options.name || 'Test Workspace',
    website: options.website || 'https://test.com',
    timezone: options.timezone || 'UTC',
    currency: options.currency || 'USD',
    status: options.status || 'active',
    settings: JSON.stringify(settings),
    created_at: now,
    updated_at: now,
  };

  await client.insert({
    table: 'workspaces',
    values: [workspace],
    format: 'JSONEachRow',
  });

  // No delay needed - workspace creation has no immediate read-after-write dependency
  return workspaceId;
}

/**
 * Create a test API key for a workspace
 *
 * @param client - ClickHouse client for system database
 * @param workspaceId - Workspace ID
 * @param options - API key options
 * @returns The plain API key (use this for requests)
 *
 * @example
 * const apiKey = await createTestApiKey(systemClient, workspaceId);
 * const apiKey = await createTestApiKey(systemClient, workspaceId, { scopes: ['events.track'] });
 */
export async function createTestApiKey(
  client: ClickHouseClient,
  workspaceId: string,
  options: CreateApiKeyOptions = {},
): Promise<string> {
  const { key, hash, prefix } = generateApiKeyToken();
  const now = toClickHouseDateTime();
  const keyId = generateId();

  await client.insert({
    table: 'api_keys',
    values: [
      {
        id: keyId,
        key_hash: hash,
        key_prefix: prefix,
        user_id: options.userId || 'test-user',
        workspace_id: workspaceId,
        name: options.name || 'Test API Key',
        description: options.description || '',
        scopes: JSON.stringify(options.scopes || ['events.track']),
        status: 'active',
        expires_at: options.expiresAt
          ? toClickHouseDateTime(options.expiresAt)
          : null,
        last_used_at: null,
        failed_attempts_count: 0,
        last_failed_attempt_at: null,
        created_by: options.userId || 'test-user',
        revoked_by: null,
        revoked_at: null,
        created_at: now,
        updated_at: now,
      },
    ],
    format: 'JSONEachRow',
  });

  // Poll until API key is visible (faster than fixed 100ms delay)
  await waitForData(
    client,
    'api_keys',
    'id = {id:String}',
    { id: keyId },
    { timeoutMs: 2000, intervalMs: 10 },
  );

  return key;
}

/**
 * Create a workspace with an owner user and membership
 *
 * @param systemClient - ClickHouse client for system database
 * @param createUser - Function to create a user (from user.helper.ts)
 * @param createMembership - Function to create membership (from user.helper.ts)
 * @param options - Workspace options
 * @returns Workspace ID and owner user ID
 *
 * @example
 * const { workspaceId, ownerId } = await createWorkspaceWithOwner(
 *   systemClient,
 *   (email) => createTestUser(systemClient, email),
 *   (wsId, userId, role) => createMembership(systemClient, wsId, userId, role),
 * );
 */
export async function createWorkspaceWithOwner(
  systemClient: ClickHouseClient,
  createUser: (email: string) => Promise<string>,
  createMembership: (
    workspaceId: string,
    userId: string,
    role: 'owner',
  ) => Promise<string>,
  options: CreateWorkspaceOptions & { ownerEmail?: string } = {},
): Promise<{ workspaceId: string; ownerId: string }> {
  const workspaceId = await createTestWorkspace(
    systemClient,
    undefined,
    options,
  );
  const ownerEmail = options.ownerEmail || `owner-${workspaceId}@test.com`;
  const ownerId = await createUser(ownerEmail);
  await createMembership(workspaceId, ownerId, 'owner');

  return { workspaceId, ownerId };
}

/**
 * Get the workspace database name for a given workspace ID
 *
 * @param workspaceId - Workspace ID
 * @returns Database name
 */
export function getWorkspaceDatabaseName(workspaceId: string): string {
  return `staminads_ws_${workspaceId}`;
}

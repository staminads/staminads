-- User Invitation System Schema
-- This migration creates tables for multi-user authentication, invitations, and API keys

-- Users Table
-- Global user accounts that can belong to multiple workspaces
CREATE TABLE IF NOT EXISTS users (
    id String,
    email String,
    password_hash Nullable(String),
    name String,
    type Enum8('user' = 1, 'service_account' = 2) DEFAULT 'user',
    status Enum8('pending' = 1, 'active' = 2, 'disabled' = 3),
    is_super_admin UInt8 DEFAULT 0,
    last_login_at Nullable(DateTime64(3)),
    failed_login_attempts UInt8 DEFAULT 0,
    locked_until Nullable(DateTime64(3)),
    password_changed_at Nullable(DateTime64(3)),
    deleted_at Nullable(DateTime64(3)),
    deleted_by Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

-- Sessions Table
-- Track active sessions for "logout all devices" functionality
CREATE TABLE IF NOT EXISTS sessions (
    id String,
    user_id String,
    token_hash String,
    ip_address Nullable(String),
    user_agent Nullable(String),
    expires_at DateTime64(3),
    revoked_at Nullable(DateTime64(3)),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, id);

-- Workspace Memberships Table
-- Links users to workspaces with roles
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id String,
    workspace_id String,
    user_id String,
    role Enum8('owner' = 1, 'admin' = 2, 'editor' = 3, 'viewer' = 4),
    invited_by Nullable(String),
    joined_at DateTime64(3) DEFAULT now64(3),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (workspace_id, user_id);

-- Invitations Table
-- Pending invitations with secure tokens
CREATE TABLE IF NOT EXISTS invitations (
    id String,
    workspace_id String,
    email String,
    role Enum8('admin' = 2, 'editor' = 3, 'viewer' = 4),
    token_hash String,
    invited_by String,
    status Enum8('pending' = 1, 'accepted' = 2, 'expired' = 3, 'revoked' = 4),
    expires_at DateTime64(3),
    accepted_at Nullable(DateTime64(3)),
    revoked_at Nullable(DateTime64(3)),
    revoked_by Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

-- Password Reset Tokens Table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id String,
    user_id String,
    token_hash String,
    status Enum8('pending' = 1, 'used' = 2, 'expired' = 3),
    expires_at DateTime64(3),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

-- Audit Logs Table
-- Track invitation and membership changes for compliance and debugging
CREATE TABLE IF NOT EXISTS audit_logs (
    id String,
    user_id String,
    workspace_id Nullable(String),
    action String,
    target_type String,
    target_id String,
    metadata String,
    ip_address Nullable(String),
    user_agent Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at)
TTL created_at + INTERVAL 90 DAY;

-- API Keys Table
-- API keys for programmatic access, linked to service accounts
CREATE TABLE IF NOT EXISTS api_keys (
    id String,
    key_hash String,
    key_prefix String,
    user_id String,
    workspace_id Nullable(String),
    name String,
    description String DEFAULT '',
    scopes String,
    status Enum8('active' = 1, 'revoked' = 2, 'expired' = 3) DEFAULT 'active',
    expires_at Nullable(DateTime64(3)),
    last_used_at Nullable(DateTime64(3)),
    failed_attempts_count UInt8 DEFAULT 0,
    last_failed_attempt_at Nullable(DateTime64(3)),
    created_by String,
    revoked_by Nullable(String),
    revoked_at Nullable(DateTime64(3)),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

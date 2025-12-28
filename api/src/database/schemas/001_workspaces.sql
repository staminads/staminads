CREATE TABLE IF NOT EXISTS workspaces (
    id String,
    name String,
    website String,
    timezone String,
    currency String,
    logo_url Nullable(String),
    timescore_reference UInt32 DEFAULT 60,
    status Enum8('initializing' = 1, 'active' = 2, 'inactive' = 3, 'error' = 4),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
ORDER BY id;

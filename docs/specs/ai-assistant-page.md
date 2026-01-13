# AI Assistant Enhancement Specification

## Overview

Enhance the existing AI assistant to be available on all workspace pages with persistent conversation history. The assistant floats as a panel accessible from any page, maintains conversation context across navigation, and auto-generates conversation titles.

---

## Current State

The assistant currently:
- Lives only on the Explore page (`/workspaces/$workspaceId/explore`)
- Opens as a side panel (desktop) or bottom drawer (mobile)
- Stores messages in `sessionStorage` (lost on refresh)
- Has no conversation history

---

## Changes

### 1. Global Availability

Move assistant state and UI from explore page to workspace layout level.

**Before:**
```
_authenticated.tsx
  └── workspaces/$workspaceId/
        ├── index.tsx (dashboard)
        ├── explore.tsx (assistant here only)
        ├── live.tsx
        └── goals.tsx
```

**After:**
```
_authenticated.tsx
  └── workspaces/$workspaceId.tsx (assistant state + UI here)
        ├── index.tsx (dashboard)
        ├── explore.tsx
        ├── live.tsx
        └── goals.tsx
```

### 2. Persistent Conversations

Store conversations in workspace settings (JSON) instead of sessionStorage.

### 3. Conversation History Panel

Add a conversation list to the assistant panel with ability to switch between conversations.

### 4. Auto-Generated Titles

Use LLM to generate a short title after the first assistant response.

---

## User Interface

### Assistant Panel (Enhanced)

```
+------------------------------------------+
| [<] Conversations    AI Assistant    [X] |
+------------------------------------------+
|                                          |
| +--------------------------------------+ |
| | User: Show me top landing pages...   | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | Assistant:                           | |
| | [Thinking...]                        | |
| | I found 15 landing pages...          | |
| |                                      | |
| | [View Explore Report] [Copy URL]     | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | Quick Prompts:                       | |
| | [Top campaigns] [Bounce analysis]    | |
| +--------------------------------------+ |
|                                          |
| +--------------------------------------+ |
| | Ask about your analytics...      [>] | |
| +--------------------------------------+ |
|                                          |
| Tokens: 1,234 in / 567 out ($0.002)     |
+------------------------------------------+
```

### Conversation History View

When clicking "[<] Conversations" button:

```
+------------------------------------------+
| [+] New Chat                        [X]  |
+------------------------------------------+
|                                          |
| Today                                    |
| +--------------------------------------+ |
| | UTM campaign performance             | |
| | "Show me top campaigns..." - 2h ago  | |
| +--------------------------------------+ |
| +--------------------------------------+ |
| | Landing page bounce rates         [x]| |
| | "Which pages have high..." - 5h ago  | |
| +--------------------------------------+ |
|                                          |
| Yesterday                                |
| +--------------------------------------+ |
| | Mobile traffic analysis              | |
| | "Compare mobile vs..." - 1d ago      | |
| +--------------------------------------+ |
|                                          |
+------------------------------------------+
```

### Panel States

| State | Description |
|-------|-------------|
| Closed | Only floating button visible |
| Chat | Current conversation (default when opening) |
| History | Conversation list view |

### Floating Button Position

Same as current: fixed bottom-right, visible on all workspace pages.

---

## Data Model

### Conversation Entity

```typescript
interface AssistantConversation {
  id: string                    // UUID
  workspace_id: string          // Reference to workspace
  user_id: string               // User who created it
  title: string                 // LLM-generated title (empty until generated)
  messages: AssistantMessage[]  // All messages (stored as JSON)
  created_at: string            // ISO timestamp
  updated_at: string            // ISO timestamp
}

interface AssistantMessage {
  id: string                    // UUID
  role: 'user' | 'assistant'
  content: string               // Main text content
  thinking?: string             // Claude's thinking (assistant only)
  tool_calls?: ToolCall[]       // Tool invocations (assistant only)
  explore_config?: ExploreConfig    // From configure_explore (assistant only)
  dashboard_config?: DashboardConfig // From configure_dashboard (assistant only)
  usage?: TokenUsage            // Token usage (assistant only)
  created_at: string            // ISO timestamp
}

interface DashboardConfig {
  filters?: Filter[]
  period?: DatePreset
  comparison?: 'previous_period' | 'previous_year' | 'none'
  url: string
}

interface ToolCall {
  name: string
  input: Record<string, unknown>
  result?: unknown
}

interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}
```

### Database Schema (ClickHouse)

```sql
CREATE TABLE assistant_conversations (
  id UUID,
  workspace_id String,
  user_id String,
  title String DEFAULT '',
  messages String DEFAULT '[]',   -- JSON array of AssistantMessage
  created_at DateTime64(3),
  updated_at DateTime64(3)
) ENGINE = MergeTree()
ORDER BY (workspace_id, user_id, updated_at DESC)
SETTINGS index_granularity = 8192;
```

### Storage Limits

- Max 100 messages per conversation (enforced on send, older messages truncated)

---

## API Endpoints

### New Endpoints

```
GET /api/assistant.conversations.list
  Query: { workspace_id: string }
  Response: { conversations: Array<{ id, title, updated_at, message_count }> }

GET /api/assistant.conversations.get
  Query: { workspace_id: string, conversation_id: string }
  Response: AssistantConversation

DELETE /api/assistant.conversations.delete
  Query: { workspace_id: string, conversation_id: string }
  Response: { success: boolean }
```

### Enhanced Chat Endpoint

```
POST /api/assistant.chat
  Body: {
    workspace_id: string
    conversation_id?: string     // Optional: continue existing, omit for new
    prompt: string
    current_page?: 'dashboard' | 'explore' | 'live' | 'goals'  // Context hint
    current_state?: ExploreState // Only if on explore page
  }
  Response: { job_id: string, conversation_id: string, is_new: boolean }
```

### SSE Stream Events (Enhanced)

```
GET /api/assistant.stream/:jobId
  Events:
    - "thinking": Streaming thinking text
    - "tool_call": Tool execution
    - "tool_result": Tool result
    - "explore_config": Explore configuration (from configure_explore)
    - "dashboard_config": Dashboard configuration (from configure_dashboard)
    - "title": Auto-generated title (only for new conversations)
    - "usage": Token usage
    - "error": Error
    - "done": Complete
```

---

## AI Tools

### Existing Tools

| Tool | Purpose | Output |
|------|---------|--------|
| `get_dimensions` | List available dimensions | Dimension list with categories |
| `get_metrics` | List available metrics | Metric list with descriptions |
| `get_dimension_values` | Get actual values for a dimension | Values with session counts |
| `preview_query` | Test query before committing | Sample data preview |
| `configure_explore` | Generate explore report | Config + "View Report" button |

### New Tool: `configure_dashboard`

Generates a dashboard configuration. Renders a "View Dashboard" button (does not navigate automatically).

```typescript
// Input
{
  filters?: Array<{
    dimension: string
    operator: FilterOperator
    values: string[]
  }>
  period?: DatePreset
  comparison?: 'previous_period' | 'previous_year' | 'none'
  customStart?: string  // Only if period = 'custom'
  customEnd?: string
}

// Output
{
  success: true
  config: {
    filters: Filter[]
    period: DatePreset
    comparison: string
    url: string  // Relative URL with query params
  }
}
```

**SSE Event:** Streams as `"dashboard_config"` event. Frontend renders:

```
+---------------------------------------+
| Dashboard                             |
| --------------------------------------|
| Filters: device = mobile              |
| Period: This month                    |
| Comparison: Previous month            |
|                                       |
| [View Dashboard]  [Copy URL]          |
+---------------------------------------+
```

### New Tool: `get_goals`

Returns workspace goal definitions.

```typescript
// Input: None

// Output
{
  goals: Array<{
    id: string
    name: string
    type: 'page_view' | 'event'
    path?: string
    event_name?: string
  }>
}
```

### New Tool: `get_annotations`

Returns workspace annotations within a date range.

```typescript
// Input
{
  period?: DatePreset  // Default: previous_30_days
}

// Output
{
  annotations: Array<{
    id: string
    date: string
    time: string
    title: string
    description?: string
  }>
}
```

### Tool Summary

| Tool | When to use |
|------|-------------|
| `get_dimensions` | User asks what dimensions are available |
| `get_metrics` | User asks what metrics are available |
| `get_dimension_values` | **Always before filtering** on a dimension |
| `preview_query` | Validate complex queries before committing |
| `configure_explore` | User wants an explore report → renders "View Report" button |
| `configure_dashboard` | User wants a dashboard view → renders "View Dashboard" button |
| `get_goals` | User asks about conversions or goals |
| `get_annotations` | User asks about events or annotations |

---

## Title Auto-Generation

### When to Generate

- After first assistant response completes
- Only for new conversations (no existing title)

### How to Generate

Use the same LLM call with a simple prompt appended:

```typescript
// After main response, if new conversation:
const titlePrompt = `Based on this conversation, generate a short title (max 6 words, no quotes):
User: ${firstUserMessage}
Assistant: ${firstAssistantResponse}`

// Stream as "title" event
```

### Title Examples

| User Message | Generated Title |
|--------------|-----------------|
| "Show me top UTM campaigns this month" | "Top UTM campaigns analysis" |
| "Which landing pages have high bounce rates?" | "Landing page bounce rates" |
| "Compare mobile vs desktop traffic" | "Mobile vs desktop comparison" |

---

## Frontend Implementation

### Files to Modify

```
console/src/
  routes/_authenticated/workspaces/$workspaceId.tsx
    - Add assistant state (isOpen, currentConversationId, conversations)
    - Add AssistantButton and AssistantPanel
    - Provide context to child routes

  components/explore/
    AssistantPanel.tsx
      - Add conversation history view
      - Add navigation between chat/history
      - Handle title updates

    AssistantButton.tsx
      - No changes needed (already generic)

  hooks/
    useAssistant.ts
      - Add conversation_id to requests
      - Handle title event
      - Add conversation switching

    useAssistantConversations.ts (new)
      - List conversations
      - Delete conversation
      - Switch conversation
```

### State Management

```typescript
// In workspaces/$workspaceId.tsx layout
interface AssistantState {
  isOpen: boolean
  view: 'chat' | 'history'
  currentConversationId: string | null  // null = new conversation
  conversations: ConversationSummary[]
}

// Provide via context
const AssistantContext = createContext<{
  state: AssistantState
  openAssistant: () => void
  closeAssistant: () => void
  showHistory: () => void
  showChat: () => void
  selectConversation: (id: string | null) => void
  deleteConversation: (id: string) => void
}>()
```

### Context Awareness

The assistant knows which page the user is on:

```typescript
// In AssistantPanel
const location = useLocation()
const currentPage = useMemo(() => {
  if (location.pathname.includes('/explore')) return 'explore'
  if (location.pathname.includes('/live')) return 'live'
  if (location.pathname.includes('/goals')) return 'goals'
  return 'dashboard'
}, [location])

// Pass to chat request
sendPrompt(prompt, { current_page: currentPage, current_state: exploreState })
```

---

## Backend Implementation

### Files to Create

```
api/src/
  assistant/
    conversations/
      conversations.controller.ts    # CRUD endpoints
      conversations.service.ts       # Business logic
      conversations.repository.ts    # ClickHouse queries

    entities/
      conversation.entity.ts         # Conversation + Message types

  database/
    schemas/
      assistant-conversations.schema.ts  # Table schema

    migrations/
      007-assistant-conversations.ts     # Migration file
```

### Files to Modify

```
api/src/
  assistant/
    assistant.controller.ts
      - Add conversations.list endpoint
      - Add conversations.get endpoint
      - Add conversations.delete endpoint
      - Modify chat to accept conversation_id

    assistant.service.ts
      - Add conversation persistence logic
      - Add title generation after first response
      - Load conversation history for context

    dto/
      chat.dto.ts
        - Add conversation_id field
        - Add current_page field

  database/
    database.service.ts
      - Add assistant_conversations table
```

### Repository Methods

```typescript
// conversations.repository.ts
@Injectable()
export class ConversationsRepository {
  constructor(private db: DatabaseService) {}

  async create(conversation: AssistantConversation): Promise<void> {
    await this.db.insert('assistant_conversations', {
      ...conversation,
      messages: JSON.stringify(conversation.messages),
    })
  }

  async list(workspaceId: string, userId: string): Promise<ConversationSummary[]> {
    // Return without messages for list view
    const rows = await this.db.query(`
      SELECT id, title, updated_at, length(JSONExtractArrayRaw(messages)) as message_count
      FROM assistant_conversations
      WHERE workspace_id = {workspaceId:String}
        AND user_id = {userId:String}
      ORDER BY updated_at DESC
      LIMIT 50
    `, { workspaceId, userId })
    return rows
  }

  async get(conversationId: string): Promise<AssistantConversation | null> {
    const rows = await this.db.query(`
      SELECT * FROM assistant_conversations
      WHERE id = {id:UUID}
      ORDER BY updated_at DESC
      LIMIT 1
    `, { id: conversationId })

    if (!rows[0]) return null

    return {
      ...rows[0],
      messages: JSON.parse(rows[0].messages || '[]'),
    }
  }

  async update(conversation: AssistantConversation): Promise<void> {
    // ClickHouse doesn't support UPDATE, so delete + insert.
    // DELETE is async, but queries use ORDER BY updated_at DESC LIMIT 1
    // to always get the newest row.
    await this.db.command(`
      ALTER TABLE assistant_conversations DELETE WHERE id = {id:UUID}
    `, { id: conversation.id })

    await this.db.insert('assistant_conversations', {
      ...conversation,
      messages: JSON.stringify(conversation.messages),
      updated_at: new Date().toISOString(),
    })
  }

  async delete(conversationId: string): Promise<void> {
    await this.db.command(`
      ALTER TABLE assistant_conversations DELETE WHERE id = {id:UUID}
    `, { id: conversationId })
  }
}
```

### Title Generation

```typescript
// In AssistantService, after main response completes
if (isNewConversation && !conversation.title) {
  const titleResponse = await this.anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',  // Fast, cheap
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: `Generate a short title (max 6 words) for this conversation:\nUser: ${firstUserMessage}\nAssistant: ${firstAssistantResponse.substring(0, 200)}`
    }]
  })

  const title = titleResponse.content[0].text.trim()
  this.sseStream.emit('title', { title })
  conversation.title = title
}
```

---

## System Prompt Enhancement

Add page context to system prompt:

```
You are an analytics assistant for "{workspace_name}".

The user is currently viewing the {current_page} page.
{if current_page == 'explore' && current_state}
Current explore configuration:
- Dimensions: {dimensions}
- Filters: {filters}
- Period: {period}
{/if}

You can help with:
- Analyzing traffic and engagement data
- Creating explore reports (dimensions, filters, date ranges)
- Generating dashboard links with filters
- Answering questions about their analytics

{if current_page == 'dashboard'}
The user is on the main dashboard. You can suggest explore reports for deeper analysis.
{/if}
{if current_page == 'live'}
The user is viewing live/real-time data. Consider recent time periods in your suggestions.
{/if}
{if current_page == 'goals'}
The user is looking at conversion goals. Focus on goal-related analysis.
{/if}
```

---

## Database Migration

### Migration File

Create `api/src/database/migrations/007-assistant-conversations.ts`:

```typescript
import { Migration } from '../migration.interface'

export const migration007AssistantConversations: Migration = {
  version: 7,
  name: 'assistant-conversations',

  async up(db) {
    await db.command(`
      CREATE TABLE IF NOT EXISTS assistant_conversations (
        id UUID,
        workspace_id String,
        user_id String,
        title String DEFAULT '',
        messages String DEFAULT '[]',
        created_at DateTime64(3),
        updated_at DateTime64(3)
      ) ENGINE = MergeTree()
      ORDER BY (workspace_id, user_id, updated_at DESC)
      SETTINGS index_granularity = 8192
    `)
  },

  async down(db) {
    await db.command('DROP TABLE IF EXISTS assistant_conversations')
  },
}
```

### Register Migration

Add to `api/src/database/migrations/index.ts`:

```typescript
import { migration007AssistantConversations } from './007-assistant-conversations'

export const migrations = [
  // ... existing migrations
  migration007AssistantConversations,
]
```

### Version Bump

This is a schema change, so bump the minor version in `api/src/version.ts`.

---

## Code Migration

### From Current Implementation

1. Keep existing `useAssistant` hook logic
2. Move state up to workspace layout
3. Add conversation persistence via new tables
4. Add history UI

### SessionStorage Cleanup

Remove sessionStorage usage from `useAssistant.ts` - all persistence now via API.

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| Workspace layout | Add assistant state + UI |
| Explore page | Remove assistant (now in layout) |
| AssistantPanel | Add history view, title display |
| useAssistant | Add conversation support, remove sessionStorage |
| Backend | Add conversation endpoints, title generation |
| Database | New `assistant_conversations` table (messages as JSON) |
| Migration | `007-assistant-conversations.ts` |

---

## Not Included (Future)

- Search within conversations
- Conversation sharing between users
- Export conversations
- Conversation templates/favorites

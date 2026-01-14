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

Store conversations in browser localStorage (per workspace) instead of sessionStorage.

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
  title: string                 // LLM-generated title (empty until generated)
  messages: AssistantMessage[]  // All messages
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

### Browser Storage (localStorage)

Conversations are stored per-workspace in localStorage:

```typescript
// Storage key format
const STORAGE_KEY = `staminads:assistant:${workspaceId}`

// Stored structure
interface StoredConversations {
  conversations: AssistantConversation[]
}

// Example localStorage entry
localStorage.setItem('staminads:assistant:ws_123', JSON.stringify({
  conversations: [
    { id: 'conv_1', title: 'UTM analysis', messages: [...], ... },
    { id: 'conv_2', title: 'Mobile traffic', messages: [...], ... }
  ]
}))
```

### Storage Limits

- Max 50 conversations per workspace (oldest auto-deleted when exceeded)
- Max 100 messages per conversation (oldest messages truncated)
- Total localStorage limit ~5MB per origin (browser limit)

---

## API Endpoints

### Enhanced Chat Endpoint

```
POST /api/assistant.chat
  Body: {
    workspace_id: string
    messages: AssistantMessage[]  // Full conversation history from localStorage
    prompt: string
    current_page?: 'dashboard' | 'explore' | 'live' | 'goals'  // Context hint
    current_state?: ExploreState // Only if on explore page
    generate_title?: boolean     // Request title generation (first message only)
  }
  Response: { job_id: string }
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
    - "title": Auto-generated title (only when generate_title=true)
    - "usage": Token usage
    - "error": Error
    - "done": Complete
```

Note: Conversation persistence is handled entirely in the browser. The API receives the full message history with each request and does not store conversations.

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
      - Send full message history with requests
      - Handle title event
      - Add conversation switching

    useAssistantStorage.ts (new)
      - Load/save conversations from localStorage
      - Create/delete conversations
      - Enforce storage limits
```

### State Management

```typescript
// In workspaces/$workspaceId.tsx layout
interface AssistantState {
  isOpen: boolean
  view: 'chat' | 'history'
  currentConversationId: string | null  // null = new conversation
  conversations: AssistantConversation[]  // Loaded from localStorage
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
  saveConversation: (conversation: AssistantConversation) => void
}>()
```

### Storage Hook

```typescript
// hooks/useAssistantStorage.ts
const STORAGE_KEY_PREFIX = 'staminads:assistant:'
const MAX_CONVERSATIONS = 50
const MAX_MESSAGES = 100

export function useAssistantStorage(workspaceId: string) {
  const storageKey = `${STORAGE_KEY_PREFIX}${workspaceId}`

  const loadConversations = (): AssistantConversation[] => {
    try {
      const data = localStorage.getItem(storageKey)
      if (!data) return []
      const parsed = JSON.parse(data)
      return parsed.conversations || []
    } catch {
      return []
    }
  }

  const saveConversations = (conversations: AssistantConversation[]) => {
    // Enforce max conversations limit
    const limited = conversations
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, MAX_CONVERSATIONS)

    // Enforce max messages per conversation
    const trimmed = limited.map(conv => ({
      ...conv,
      messages: conv.messages.slice(-MAX_MESSAGES)
    }))

    localStorage.setItem(storageKey, JSON.stringify({ conversations: trimmed }))
  }

  const saveConversation = (conversation: AssistantConversation) => {
    const conversations = loadConversations()
    const index = conversations.findIndex(c => c.id === conversation.id)
    if (index >= 0) {
      conversations[index] = conversation
    } else {
      conversations.unshift(conversation)
    }
    saveConversations(conversations)
  }

  const deleteConversation = (conversationId: string) => {
    const conversations = loadConversations().filter(c => c.id !== conversationId)
    saveConversations(conversations)
  }

  return { loadConversations, saveConversation, deleteConversation }
}
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

### Files to Modify

```
api/src/
  assistant/
    assistant.controller.ts
      - Modify chat to accept messages array and generate_title flag

    assistant.service.ts
      - Accept full message history from request
      - Add title generation when generate_title=true

    dto/
      chat.dto.ts
        - Add messages field (array of past messages)
        - Add current_page field
        - Add generate_title field
```

No database changes required - conversations are stored in browser localStorage.

### Title Generation

```typescript
// In AssistantService, after main response completes
// Only runs when generate_title=true in request
if (generateTitle) {
  const titleResponse = await this.anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',  // Fast, cheap
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: `Generate a short title (max 6 words) for this conversation:\nUser: ${userPrompt}\nAssistant: ${assistantResponse.substring(0, 200)}`
    }]
  })

  const title = titleResponse.content[0].text.trim()
  this.sseStream.emit('title', { title })
  // Frontend saves the title to localStorage
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

---

## Code Migration

### From Current Implementation

1. Keep existing `useAssistant` hook logic
2. Move state up to workspace layout
3. Replace sessionStorage with localStorage for persistence
4. Add history UI
5. Send full message history with each API request

### SessionStorage to LocalStorage

Replace sessionStorage usage in `useAssistant.ts` with localStorage-based `useAssistantStorage.ts` hook for persistent conversation storage.

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| Workspace layout | Add assistant state + UI |
| Explore page | Remove assistant (now in layout) |
| AssistantPanel | Add history view, title display |
| useAssistant | Send full message history, handle title events |
| useAssistantStorage (new) | localStorage-based conversation persistence |
| Backend | Accept messages array, optional title generation |
| Storage | Browser localStorage (no database table needed) |

---

## Not Included (Future)

- Search within conversations
- Conversation sharing between users
- Export conversations
- Conversation templates/favorites

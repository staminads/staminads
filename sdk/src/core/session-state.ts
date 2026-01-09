/**
 * SessionState - Manages cumulative actions[] array for V3 session payload
 *
 * Key concepts:
 * - actions[]: Array of completed pageviews and goals
 * - currentPage: The page user is currently viewing (duration/scroll updating)
 * - checkpoint: Last acknowledged action index from server (for delta sending)
 * - attributesSent: Whether session attributes have been sent
 */

import type {
  Action,
  PageviewAction,
  GoalAction,
  CurrentPage,
  SessionPayload,
  SessionAttributes,
  SessionStateSnapshot,
} from '../types/session-state';

const STORAGE_KEY = 'stm_session_state';
const SDK_VERSION = __SDK_VERSION__;
const MAX_ACTIONS = 1000; // Match server limit from Phase 2

export interface SessionStateConfig {
  workspace_id: string;
  session_id: string;
  created_at: number;
}

export class SessionState {
  private actions: Action[] = [];
  private currentPage: CurrentPage | null = null;
  private checkpoint: number = -1; // -1 means no checkpoint
  private attributesSent: boolean = false;

  private readonly workspaceId: string;
  private readonly sessionId: string;
  private readonly createdAt: number;

  constructor(config: SessionStateConfig) {
    this.workspaceId = config.workspace_id;
    this.sessionId = config.session_id;
    this.createdAt = config.created_at;
  }

  // === Getters ===

  getActions(): Action[] {
    return [...this.actions];
  }

  getCurrentPage(): CurrentPage | null {
    return this.currentPage ? { ...this.currentPage } : null;
  }

  getCheckpoint(): number {
    return this.checkpoint;
  }

  hasAttributesSent(): boolean {
    return this.attributesSent;
  }

  // === Page Tracking ===

  addPageview(path: string): void {
    const now = Date.now();

    // Finalize previous page if exists
    if (this.currentPage) {
      this.finalizeCurrentPage(now);
    }

    // Start new page
    const pageNumber = this.getNextPageNumber();
    this.currentPage = {
      path,
      page_number: pageNumber,
      entered_at: now,
      scroll: 0,
    };
  }

  updateScroll(scrollPercent: number): void {
    if (!this.currentPage) return;

    // Clamp to 0-100
    const clamped = Math.max(0, Math.min(100, scrollPercent));

    // Only update if higher (track max)
    if (clamped > this.currentPage.scroll) {
      this.currentPage.scroll = clamped;
    }
  }

  // === Goal Tracking ===

  addGoal(
    name: string,
    value?: number,
    properties?: Record<string, string>,
  ): boolean {
    // Check MAX_ACTIONS limit
    if (this.actions.length >= MAX_ACTIONS) {
      console.warn(
        `[SessionState] MAX_ACTIONS (${MAX_ACTIONS}) reached, goal not added`,
      );
      return false;
    }

    const goal: GoalAction = {
      type: 'goal',
      name,
      path: this.currentPage?.path || '/',
      page_number: this.currentPage?.page_number || 1,
      timestamp: Date.now(),
    };

    if (value !== undefined) {
      goal.value = value;
    }

    if (properties) {
      goal.properties = properties;
    }

    this.actions.push(goal);

    // Warn if approaching limit
    if (this.actions.length >= MAX_ACTIONS * 0.9) {
      console.warn(
        `[SessionState] Approaching MAX_ACTIONS limit (${this.actions.length}/${MAX_ACTIONS})`,
      );
    }

    return true;
  }

  // === Payload Building ===

  buildPayload(attributes: SessionAttributes): SessionPayload {
    const payload: SessionPayload = {
      workspace_id: this.workspaceId,
      session_id: this.sessionId,
      actions: [...this.actions],
      created_at: this.createdAt,
      updated_at: Date.now(),
      sdk_version: SDK_VERSION,
    };

    // Include current page if present
    if (this.currentPage) {
      payload.current_page = { ...this.currentPage };
    }

    // Include checkpoint if set
    if (this.checkpoint >= 0) {
      payload.checkpoint = this.checkpoint;
    }

    // Include attributes only on first send
    if (!this.attributesSent) {
      payload.attributes = attributes;
    }

    return payload;
  }

  // === Checkpoint Management ===

  applyCheckpoint(newCheckpoint: number): void {
    if (newCheckpoint > this.checkpoint) {
      this.checkpoint = newCheckpoint;
    }
  }

  markAttributesSent(): void {
    this.attributesSent = true;
  }

  // === Unload Handling ===

  finalizeForUnload(): void {
    if (!this.currentPage) return;

    this.finalizeCurrentPage(Date.now());
    this.currentPage = null;
  }

  // === Persistence ===

  persist(): void {
    try {
      const snapshot: SessionStateSnapshot = {
        actions: this.actions,
        currentPage: this.currentPage,
        checkpoint: this.checkpoint,
        attributesSent: this.attributesSent,
      };

      // Include session ID for validation on restore
      const data = {
        session_id: this.sessionId,
        ...snapshot,
      };

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // sessionStorage may be unavailable (private mode, quota exceeded)
      console.warn('[SessionState] Failed to persist:', e);
    }
  }

  restore(): void {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);

      // Validate session ID matches
      if (data.session_id !== this.sessionId) {
        // Different session, clear old data
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }

      // Restore state
      this.actions = data.actions || [];
      this.currentPage = data.currentPage || null;
      this.checkpoint = data.checkpoint ?? -1;
      this.attributesSent = data.attributesSent ?? false;
    } catch (e) {
      // Corrupted data, ignore
      console.warn('[SessionState] Failed to restore:', e);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  // === Private Helpers ===

  private finalizeCurrentPage(exitTime: number): void {
    if (!this.currentPage) return;

    const duration = exitTime - this.currentPage.entered_at;

    const pageview: PageviewAction = {
      type: 'pageview',
      path: this.currentPage.path,
      page_number: this.currentPage.page_number,
      duration,
      scroll: this.currentPage.scroll,
      entered_at: this.currentPage.entered_at,
      exited_at: exitTime,
    };

    this.actions.push(pageview);
  }

  private getNextPageNumber(): number {
    // Find highest page_number in actions
    let maxPageNumber = 0;

    for (const action of this.actions) {
      if (action.page_number > maxPageNumber) {
        maxPageNumber = action.page_number;
      }
    }

    // Current page would be next
    if (this.currentPage && this.currentPage.page_number > maxPageNumber) {
      maxPageNumber = this.currentPage.page_number;
    }

    return maxPageNumber + 1;
  }
}

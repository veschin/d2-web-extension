export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'detector' | 'editor' | 'save' | 'api' | 'preview' | 'system';
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

const MAX_ENTRIES = 500;
const FLUSH_DELAY_MS = 1000;
const STORAGE_KEY = 'd2ext-log';

let entries: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function push(entry: LogEntry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToStorage();
  }, FLUSH_DELAY_MS);
}

async function flushToStorage() {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.session) {
      await browser.storage.session.set({ [STORAGE_KEY]: entries });
    }
  } catch {
    // Storage unavailable (e.g. in tests or content script without permission)
  }
}

function consoleOutput(entry: LogEntry) {
  const prefix = `[d2ext:${entry.source}]`;
  const suffix = entry.durationMs != null ? ` (${entry.durationMs}ms)` : '';
  const msg = `${prefix} ${entry.message}${suffix}`;
  switch (entry.level) {
    case 'error':
      console.error(msg, entry.data ?? '');
      break;
    case 'warn':
      console.warn(msg, entry.data ?? '');
      break;
    default:
      console.log(msg, entry.data ?? '');
  }
}

export function logInfo(source: LogEntry['source'], message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { ts: Date.now(), level: 'info', source, message, data };
  push(entry);
  consoleOutput(entry);
}

export function logWarn(source: LogEntry['source'], message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { ts: Date.now(), level: 'warn', source, message, data };
  push(entry);
  consoleOutput(entry);
}

export function logError(source: LogEntry['source'], message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { ts: Date.now(), level: 'error', source, message, data };
  push(entry);
  consoleOutput(entry);
}

/**
 * Wrap a sync or async function, logging its execution time.
 */
export async function logTimed<T>(
  source: LogEntry['source'],
  message: string,
  fn: () => T | Promise<T>,
  data?: Record<string, unknown>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);
    const entry: LogEntry = { ts: Date.now(), level: 'info', source, message, durationMs, data };
    push(entry);
    consoleOutput(entry);
    return result;
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    const entry: LogEntry = {
      ts: Date.now(),
      level: 'error',
      source,
      message: `${message} — ${(e as Error).message}`,
      durationMs,
      data,
    };
    push(entry);
    consoleOutput(entry);
    throw e;
  }
}

/**
 * Get all log entries. Merges in-memory with storage if possible.
 */
export async function getEntries(): Promise<LogEntry[]> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.session) {
      const result = await browser.storage.session.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as LogEntry[] | undefined;
      if (stored && stored.length > entries.length) {
        entries = stored;
      }
    }
  } catch {
    // Storage unavailable
  }
  return [...entries];
}

/**
 * Clear all log entries from memory and storage.
 */
export async function clearLog() {
  entries = [];
  try {
    if (typeof browser !== 'undefined' && browser.storage?.session) {
      await browser.storage.session.remove(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable
  }
}

/**
 * Get entries from memory only (synchronous, for testing).
 */
export function getEntriesSync(): LogEntry[] {
  return [...entries];
}

/**
 * Reset in-memory state (for testing).
 */
export function _resetForTesting() {
  entries = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

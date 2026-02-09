import { getEntries, clearLog, type LogEntry } from '../shared/logger';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let panelVisible = false;

export type StatusLevel = 'ok' | 'error' | 'progress' | 'idle';

const LEVEL_COLORS: Record<StatusLevel, string> = {
  ok: '#22c55e',
  error: '#ef4444',
  progress: '#f59e0b',
  idle: '#94a3b8',
};

function q(selector: string): HTMLElement | null {
  return shadow?.querySelector(selector) ?? null;
}

function init() {
  if (hostEl) return;

  hostEl = document.createElement('div');
  hostEl.id = 'd2ext-statusbar-host';
  hostEl.style.all = 'initial';
  shadow = hostEl.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STATUSBAR_CSS;
  shadow.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'd2ext-statusbar';
  bar.innerHTML = `
    <div class="d2ext-sb-left">
      <span class="d2ext-sb-dot" id="d2ext-sb-dot"></span>
      <span class="d2ext-sb-text" id="d2ext-sb-text">d2ext idle</span>
    </div>
    <div class="d2ext-sb-right">
      <span class="d2ext-sb-version">d2ext v0.1.0</span>
      <button class="d2ext-sb-btn" id="d2ext-sb-debug">Debug</button>
    </div>
  `;
  shadow.appendChild(bar);

  // Debug panel (hidden by default)
  const panel = document.createElement('div');
  panel.className = 'd2ext-debug-panel';
  panel.id = 'd2ext-debug-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="d2ext-dp-header">
      <span>Debug Log</span>
      <div class="d2ext-dp-actions">
        <button class="d2ext-dp-btn" id="d2ext-dp-refresh">Refresh</button>
        <button class="d2ext-dp-btn" id="d2ext-dp-copy">Copy JSON</button>
        <button class="d2ext-dp-btn" id="d2ext-dp-clear">Clear</button>
        <button class="d2ext-dp-btn" id="d2ext-dp-close">Close</button>
      </div>
    </div>
    <div class="d2ext-dp-entries" id="d2ext-dp-entries"></div>
  `;
  shadow.appendChild(panel);

  document.body.appendChild(hostEl);

  // Event listeners
  q('#d2ext-sb-debug')?.addEventListener('click', togglePanel);
  q('#d2ext-dp-refresh')?.addEventListener('click', refreshPanel);
  q('#d2ext-dp-copy')?.addEventListener('click', copyLog);
  q('#d2ext-dp-clear')?.addEventListener('click', clearEntries);
  q('#d2ext-dp-close')?.addEventListener('click', togglePanel);

  setStatusBarText('d2ext idle', 'idle');
}

export function setStatusBarText(text: string, level: StatusLevel = 'ok') {
  if (!hostEl) init();
  const dot = q('#d2ext-sb-dot');
  const textEl = q('#d2ext-sb-text');
  if (dot) dot.style.background = LEVEL_COLORS[level];
  if (textEl) textEl.textContent = text;
}

async function togglePanel() {
  panelVisible = !panelVisible;
  const panel = q('#d2ext-debug-panel');
  if (!panel) return;
  panel.style.display = panelVisible ? 'flex' : 'none';
  if (panelVisible) refreshPanel();
}

async function refreshPanel() {
  const container = q('#d2ext-dp-entries');
  if (!container) return;

  const entries = await getEntries();
  if (entries.length === 0) {
    container.innerHTML = '<div class="d2ext-dp-empty">No log entries</div>';
    return;
  }

  container.innerHTML = entries
    .slice()
    .reverse()
    .map((e) => renderEntry(e))
    .join('');
}

function renderEntry(entry: LogEntry): string {
  const time = new Date(entry.ts).toLocaleTimeString();
  const levelClass = `d2ext-dp-level-${entry.level}`;
  const duration = entry.durationMs != null ? ` <span class="d2ext-dp-duration">${entry.durationMs}ms</span>` : '';
  const data = entry.data ? ` <span class="d2ext-dp-data">${JSON.stringify(entry.data)}</span>` : '';
  return `
    <div class="d2ext-dp-entry ${levelClass}">
      <span class="d2ext-dp-time">${time}</span>
      <span class="d2ext-dp-source">${entry.source}</span>
      <span class="d2ext-dp-msg">${escapeHtml(entry.message)}${duration}${data}</span>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function copyLog() {
  const entries = await getEntries();
  try {
    await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
    setStatusBarText('Log copied to clipboard', 'ok');
  } catch {
    setStatusBarText('Failed to copy log', 'error');
  }
}

async function clearEntries() {
  await clearLog();
  refreshPanel();
  setStatusBarText('Log cleared', 'ok');
}

// --- CSS ---

const STATUSBAR_CSS = `
  :host {
    all: initial;
  }

  .d2ext-statusbar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 24px;
    background: #1e1e2e;
    color: #cdd6f4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    z-index: 99998;
    box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.2);
  }

  .d2ext-sb-left, .d2ext-sb-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .d2ext-sb-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #94a3b8;
    flex-shrink: 0;
  }

  .d2ext-sb-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 400px;
  }

  .d2ext-sb-version {
    color: #6c7086;
  }

  .d2ext-sb-btn {
    background: transparent;
    border: 1px solid #45475a;
    color: #cdd6f4;
    padding: 1px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
  }

  .d2ext-sb-btn:hover {
    background: #313244;
  }

  .d2ext-debug-panel {
    position: fixed;
    bottom: 24px;
    left: 0;
    right: 0;
    height: 300px;
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
    z-index: 99997;
    display: flex;
    flex-direction: column;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.3);
  }

  .d2ext-dp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid #313244;
    font-weight: 600;
    flex-shrink: 0;
  }

  .d2ext-dp-actions {
    display: flex;
    gap: 6px;
  }

  .d2ext-dp-btn {
    background: transparent;
    border: 1px solid #45475a;
    color: #cdd6f4;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
  }

  .d2ext-dp-btn:hover {
    background: #313244;
  }

  .d2ext-dp-entries {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .d2ext-dp-empty {
    padding: 20px;
    text-align: center;
    color: #6c7086;
  }

  .d2ext-dp-entry {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 12px;
    border-bottom: 1px solid #181825;
  }

  .d2ext-dp-entry:hover {
    background: #181825;
  }

  .d2ext-dp-time {
    color: #6c7086;
    flex-shrink: 0;
    width: 70px;
  }

  .d2ext-dp-source {
    background: #313244;
    padding: 0 4px;
    border-radius: 2px;
    flex-shrink: 0;
    font-size: 10px;
  }

  .d2ext-dp-msg {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .d2ext-dp-duration {
    color: #a6adc8;
  }

  .d2ext-dp-data {
    color: #6c7086;
    font-size: 10px;
  }

  .d2ext-dp-level-info .d2ext-dp-source { color: #89b4fa; }
  .d2ext-dp-level-warn .d2ext-dp-source { color: #f9e2af; background: #45475a; }
  .d2ext-dp-level-error .d2ext-dp-source { color: #f38ba8; background: #45475a; }
  .d2ext-dp-level-error .d2ext-dp-msg { color: #f38ba8; }
`;

// Auto-init when content script loads
init();

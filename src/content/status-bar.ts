import { getEntries, clearLog, type LogEntry } from '../shared/logger';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let panelVisible = false;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let activeFilter: 'all' | 'api' = 'all';

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
  // Only show on Confluence pages
  if (!document.querySelector('meta[name="ajs-page-id"]')) return;
  // Don't show on edit pages — interferes with the editor
  if (document.getElementById('editpageform') || document.querySelector('.wiki-edit')) return;

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
    <span class="d2ext-sb-dot" id="d2ext-sb-dot"></span>
    <span class="d2ext-sb-text" id="d2ext-sb-text">d2ext idle</span>
    <span class="d2ext-sb-sep">&middot;</span>
    <span class="d2ext-sb-version">v0.1.0</span>
    <button class="d2ext-sb-btn" id="d2ext-sb-debug">Debug</button>
  `;
  shadow.appendChild(bar);

  // Debug panel (hidden by default)
  const panel = document.createElement('div');
  panel.className = 'd2ext-debug-panel';
  panel.id = 'd2ext-debug-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="d2ext-dp-header">
      <div class="d2ext-dp-filters">
        <button class="d2ext-dp-filter d2ext-dp-filter-active" id="d2ext-dp-filter-all">All</button>
        <button class="d2ext-dp-filter" id="d2ext-dp-filter-api">Network</button>
      </div>
      <div class="d2ext-dp-actions">
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
  q('#d2ext-dp-copy')?.addEventListener('click', copyLog);
  q('#d2ext-dp-clear')?.addEventListener('click', clearEntries);
  q('#d2ext-dp-close')?.addEventListener('click', togglePanel);
  q('#d2ext-dp-filter-all')?.addEventListener('click', () => setFilter('all'));
  q('#d2ext-dp-filter-api')?.addEventListener('click', () => setFilter('api'));

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
  if (panelVisible) {
    refreshPanel();
    // Auto-refresh every 2s while panel is open
    refreshInterval = setInterval(refreshPanel, 2000);
  } else {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  }
}

function setFilter(filter: 'all' | 'api') {
  activeFilter = filter;
  // Update button styles
  const allBtn = q('#d2ext-dp-filter-all');
  const apiBtn = q('#d2ext-dp-filter-api');
  if (allBtn) allBtn.className = `d2ext-dp-filter${filter === 'all' ? ' d2ext-dp-filter-active' : ''}`;
  if (apiBtn) apiBtn.className = `d2ext-dp-filter${filter === 'api' ? ' d2ext-dp-filter-active' : ''}`;
  refreshPanel();
}

async function refreshPanel() {
  const container = q('#d2ext-dp-entries');
  if (!container) return;

  let entries = await getEntries();

  // Apply filter
  if (activeFilter === 'api') {
    entries = entries.filter((e) => e.source === 'api');
  }

  if (entries.length === 0) {
    const msg = activeFilter === 'api' ? 'No network requests captured yet' : 'No log entries';
    container.innerHTML = `<div class="d2ext-dp-empty">${msg}</div>`;
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
  const isApi = entry.source === 'api';
  const duration = entry.durationMs != null ? ` <span class="d2ext-dp-duration">${entry.durationMs}ms</span>` : '';
  const data = entry.data ? ` <span class="d2ext-dp-data">${JSON.stringify(entry.data)}</span>` : '';

  let msg = escapeHtml(entry.message);

  // Highlight HTTP status codes in network entries: "→ 200", "→ 404", "→ 500"
  if (isApi) {
    msg = msg.replace(/→ (\d{3})/, (_, status) => {
      const s = parseInt(status, 10);
      const cls = s < 300 ? 'd2ext-dp-status-ok' : s < 500 ? 'd2ext-dp-status-warn' : 'd2ext-dp-status-err';
      return `→ <span class="${cls}">${status}</span>`;
    });
    // Highlight FAILED
    msg = msg.replace(/FAILED/, '<span class="d2ext-dp-status-err">FAILED</span>');
  }

  return `
    <div class="d2ext-dp-entry ${levelClass}${isApi ? ' d2ext-dp-entry-api' : ''}">
      <span class="d2ext-dp-time">${time}</span>
      <span class="d2ext-dp-source">${entry.source}</span>
      <span class="d2ext-dp-msg">${msg}${duration}${data}</span>
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
    bottom: 8px;
    right: 8px;
    left: auto;
    height: auto;
    padding: 4px 10px;
    border-radius: 6px;
    background: #1e1e2e;
    color: #cdd6f4;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    z-index: 99998;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    max-width: 350px;
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
  }

  .d2ext-sb-sep {
    color: #6c7086;
  }

  .d2ext-sb-version {
    color: #6c7086;
    white-space: nowrap;
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
    bottom: 36px;
    right: 8px;
    left: auto;
    width: 500px;
    height: 300px;
    border-radius: 8px;
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

  .d2ext-dp-filters {
    display: flex;
    gap: 4px;
  }

  .d2ext-dp-filter {
    background: transparent;
    border: 1px solid #45475a;
    color: #6c7086;
    padding: 1px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
  }

  .d2ext-dp-filter:hover {
    color: #cdd6f4;
  }

  .d2ext-dp-filter-active {
    background: #45475a;
    color: #cdd6f4;
  }

  .d2ext-dp-level-info .d2ext-dp-source { color: #89b4fa; }
  .d2ext-dp-level-warn .d2ext-dp-source { color: #f9e2af; background: #45475a; }
  .d2ext-dp-level-error .d2ext-dp-source { color: #f38ba8; background: #45475a; }
  .d2ext-dp-level-error .d2ext-dp-msg { color: #f38ba8; }

  /* Network request entries */
  .d2ext-dp-entry-api .d2ext-dp-source { color: #a78bfa; }
  .d2ext-dp-status-ok { color: #22c55e; font-weight: 600; }
  .d2ext-dp-status-warn { color: #f59e0b; font-weight: 600; }
  .d2ext-dp-status-err { color: #ef4444; font-weight: 600; }
`;

/** Remove status bar (when navigating to edit page via SPA) */
function destroy() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  panelVisible = false;
  if (hostEl) {
    hostEl.remove();
    hostEl = null;
    shadow = null;
  }
}

// Auto-init when content script loads
init();

// Watch for SPA transitions to edit mode — remove status bar if edit markers appear
const sbObserver = new MutationObserver(() => {
  if (hostEl && (document.getElementById('editpageform') || document.querySelector('.wiki-edit'))) {
    destroy();
    sbObserver.disconnect();
  }
});
sbObserver.observe(document.body, { childList: true, subtree: true });

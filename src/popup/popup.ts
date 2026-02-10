import type { MacroInfo, PageMeta } from '../shared/types';
import { loadEditorPrefs, saveEditorPrefs, listStandaloneDrafts, deleteStandaloneDraft } from '../shared/editor-prefs';
import { loadSettings, saveSettings } from '../shared/extension-settings';
import { getEntries, clearLog, type LogEntry } from '../shared/logger';
import { logInfo, logWarn } from '../shared/logger';

let userServerUrl = '';

// --- DOM refs ---
const statusEl = document.getElementById('status')!;
const listEl = document.getElementById('macro-list')!;
const tabMacros = document.getElementById('tab-macros')!;
const tabSettings = document.getElementById('tab-settings')!;
const tabDebug = document.getElementById('tab-debug')!;

// --- Tabs ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    tabMacros.style.display = target === 'macros' ? '' : 'none';
    tabSettings.style.display = target === 'settings' ? '' : 'none';
    tabDebug.style.display = target === 'debug' ? '' : 'none';
    if (target === 'settings') initSettings();
    if (target === 'debug') {
      initDebug();
    } else if (debugRefreshInterval) {
      clearInterval(debugRefreshInterval);
      debugRefreshInterval = null;
    }
  });
});

// --- New diagram button ---
document.getElementById('new-diagram')?.addEventListener('click', () => {
  browser.tabs.create({ url: browser.runtime.getURL('standalone/editor.html') });
  window.close();
});

// --- Macros tab ---
function renderMacros(macros: MacroInfo[], _pageMeta: PageMeta | null) {
  if (!macros || macros.length === 0) {
    statusEl.className = 'status empty';
    statusEl.textContent = 'No D2 macros found on this page';
    listEl.innerHTML = '';
    return;
  }

  statusEl.className = 'status found';
  statusEl.textContent = `${macros.length} D2 macro${macros.length > 1 ? 's' : ''} found`;

  listEl.innerHTML = macros
    .map((m, i) => {
      const firstLine = m.code.split('\n')[0].substring(0, 40);
      return `
      <div class="macro-item" data-index="${i}">
        <div class="macro-item-header">
          <span class="macro-index">${i + 1}</span>
          <div class="macro-info">
            <div class="macro-code">${escapeHtml(firstLine)}</div>
            <div class="macro-params">
              <span class="param-badge">${escapeHtml(m.params.layout)}</span>
              <span class="param-badge">theme ${escapeHtml(m.params.theme)}</span>
            </div>
          </div>
        </div>
        <div class="macro-thumb" id="thumb-${i}"><div class="thumb-spinner"></div></div>
      </div>
    `;
    })
    .join('');

  // Click handler — open editor
  listEl.querySelectorAll('.macro-item').forEach((item) => {
    item.addEventListener('click', () => {
      const index = parseInt(item.getAttribute('data-index') ?? '0', 10);
      browser.runtime.sendMessage({ type: 'open-editor', macroIndex: index });
      window.close();
    });
  });

  // Load SVG thumbnails async
  macros.forEach((m, i) => loadThumbnail(m, i));
}

async function loadThumbnail(macro: MacroInfo, index: number) {
  const thumbEl = document.getElementById(`thumb-${index}`);
  if (!thumbEl) return;

  // Use cached SVG from the page if available
  if (macro.cachedSvg) {
    thumbEl.innerHTML = macro.cachedSvg;
    return;
  }

  // Resolve server: user setting first, then macro param
  const serverUrl = userServerUrl || macro.params.server;
  if (!serverUrl) {
    thumbEl.innerHTML = '<span style="font-size:10px;color:#aaa">N/A</span>';
    return;
  }

  try {
    const body = new URLSearchParams();
    body.append('d2', macro.code);
    if (macro.params.theme) body.append('theme', macro.params.theme);
    if (macro.params.layout) body.append('layout', macro.params.layout);

    const result = await browser.runtime.sendMessage({
      type: 'proxy-fetch',
      url: `${serverUrl}/svg`,
      method: 'POST',
      body: body.toString(),
      contentType: 'application/x-www-form-urlencoded',
    });

    if (result?.status < 400 && result?.data) {
      thumbEl.innerHTML = result.data;
    } else {
      thumbEl.innerHTML = '<span style="font-size:10px;color:#c62828">err</span>';
    }
  } catch {
    thumbEl.innerHTML = '<span style="font-size:10px;color:#aaa">N/A</span>';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Drafts section ---
async function loadDraftsList() {
  const section = document.getElementById('drafts-section');
  const listEl = document.getElementById('drafts-list');
  if (!section || !listEl) return;

  const drafts = await listStandaloneDrafts();
  if (drafts.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  listEl.innerHTML = drafts.map((d) => `
    <div class="draft-item" data-draft-id="${escapeHtml(d.id)}">
      <div class="draft-item-info">
        <div class="draft-item-name">${escapeHtml(d.name)}</div>
        <div class="draft-item-date">${new Date(d.updatedAt).toLocaleDateString()} ${new Date(d.updatedAt).toLocaleTimeString()}</div>
      </div>
      <div class="draft-item-actions">
        <button class="btn btn-sm" data-open-draft="${escapeHtml(d.id)}">Open</button>
        <button class="btn btn-sm btn-danger" data-delete-draft="${escapeHtml(d.id)}">Del</button>
      </div>
    </div>
  `).join('');

  // Wire open buttons
  listEl.querySelectorAll('[data-open-draft]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-open-draft');
      if (id) {
        browser.tabs.create({ url: browser.runtime.getURL(`standalone/editor.html?draft=${id}`) });
        window.close();
      }
    });
  });

  // Wire delete buttons
  listEl.querySelectorAll('[data-delete-draft]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-draft');
      const name = drafts.find((d) => d.id === id)?.name ?? 'draft';
      if (id && confirm(`Delete "${name}"?`)) {
        await deleteStandaloneDraft(id);
        loadDraftsList();
      }
    });
  });
}

// --- Settings tab ---
let settingsInitialized = false;

async function initSettings() {
  if (settingsInitialized) return;
  settingsInitialized = true;

  // Server URL
  const settings = await loadSettings();
  const serverInput = document.getElementById('custom-server-url') as HTMLInputElement;
  if (serverInput) serverInput.value = settings.serverUrl;

  document.getElementById('save-server')?.addEventListener('click', async () => {
    const url = serverInput?.value.trim() ?? '';
    await saveSettings({ serverUrl: url });
    userServerUrl = url;
    showInlineStatus('server-status', 'Saved!');
  });

  // Editor prefs
  const prefs = await loadEditorPrefs();
  const fontInput = document.getElementById('editor-font-size') as HTMLInputElement;
  if (fontInput) fontInput.value = String(prefs.fontSize);

  document.getElementById('save-editor-prefs')?.addEventListener('click', async () => {
    const fontSize = parseInt(fontInput?.value ?? '13', 10);
    await saveEditorPrefs({ fontSize: Math.max(8, Math.min(28, fontSize)) });
    showInlineStatus('editor-status', 'Saved!');
  });
}

function showInlineStatus(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    setTimeout(() => (el.textContent = ''), 2000);
  }
}

// --- Debug tab ---
let debugInitialized = false;
let debugFilter: 'all' | 'api' = 'all';
let debugRefreshInterval: ReturnType<typeof setInterval> | null = null;

async function initDebug() {
  if (!debugInitialized) {
    debugInitialized = true;

    document.getElementById('debug-filter-all')?.addEventListener('click', () => {
      debugFilter = 'all';
      updateDebugFilterButtons();
      refreshDebug();
    });
    document.getElementById('debug-filter-net')?.addEventListener('click', () => {
      debugFilter = 'api';
      updateDebugFilterButtons();
      refreshDebug();
    });
    document.getElementById('debug-copy')?.addEventListener('click', async () => {
      const entries = await getEntries();
      try {
        await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      } catch {}
    });
    document.getElementById('debug-clear')?.addEventListener('click', async () => {
      await clearLog();
      refreshDebug();
    });
  }

  refreshDebug();
  // Auto-refresh while debug tab is visible
  if (debugRefreshInterval) clearInterval(debugRefreshInterval);
  debugRefreshInterval = setInterval(refreshDebug, 2000);
}

function updateDebugFilterButtons() {
  const allBtn = document.getElementById('debug-filter-all');
  const netBtn = document.getElementById('debug-filter-net');
  allBtn?.classList.toggle('active', debugFilter === 'all');
  netBtn?.classList.toggle('active', debugFilter === 'api');
}

async function refreshDebug() {
  const container = document.getElementById('debug-entries');
  if (!container) return;

  let entries = await getEntries();
  if (debugFilter === 'api') {
    entries = entries.filter((e) => e.source === 'api');
  }

  if (entries.length === 0) {
    const msg = debugFilter === 'api' ? 'No network requests captured yet' : 'No log entries';
    container.innerHTML = `<div class="debug-empty">${msg}</div>`;
    return;
  }

  container.innerHTML = entries
    .slice()
    .reverse()
    .map((e) => renderDebugEntry(e))
    .join('');
}

function renderDebugEntry(entry: LogEntry): string {
  const time = new Date(entry.ts).toLocaleTimeString();
  const levelClass = `debug-level-${entry.level}`;
  const duration = entry.durationMs != null ? ` <span class="debug-duration">${entry.durationMs}ms</span>` : '';

  let msg = escapeHtml(entry.message);
  if (entry.source === 'api') {
    msg = msg.replace(/→ (\d{3})/, (_, status) => {
      const s = parseInt(status, 10);
      const cls = s < 300 ? 'debug-status-ok' : s < 500 ? 'debug-status-warn' : 'debug-status-err';
      return `→ <span class="${cls}">${status}</span>`;
    });
    msg = msg.replace(/FAILED/, '<span class="debug-status-err">FAILED</span>');
  }

  return `
    <div class="debug-entry ${levelClass}">
      <span class="debug-time">${time}</span>
      <span class="debug-source">${entry.source}</span>
      <span class="debug-msg">${msg}${duration}</span>
    </div>
  `;
}

// --- Init: load settings then macros + drafts ---
loadSettings().then((settings) => {
  userServerUrl = settings.serverUrl;
}).finally(() => {
  browser.runtime.sendMessage({ type: 'get-macros' }).then((response) => {
    if (response) {
      logInfo('system', `Popup: retrieved ${response.macros?.length ?? 0} macros`);
      renderMacros(response.macros, response.pageMeta);
    } else {
      logWarn('system', 'Popup: no response from service worker');
      statusEl.className = 'status empty';
      statusEl.textContent = 'Navigate to a Confluence page first';
    }
  });

  // Load standalone drafts
  loadDraftsList();
});

import type { MacroInfo, PageMeta } from '../shared/types';
import { loadEditorPrefs, saveEditorPrefs } from '../shared/editor-prefs';
import { loadSettings, saveSettings } from '../shared/extension-settings';
import { logInfo, logWarn } from '../shared/logger';

let userServerUrl = '';

// --- DOM refs ---
const statusEl = document.getElementById('status')!;
const listEl = document.getElementById('macro-list')!;
const tabMacros = document.getElementById('tab-macros')!;
const tabSettings = document.getElementById('tab-settings')!;

// --- Tabs ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    tabMacros.style.display = target === 'macros' ? '' : 'none';
    tabSettings.style.display = target === 'settings' ? '' : 'none';
    if (target === 'settings') initSettings();
  });
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// --- Init: load settings then macros ---
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
});

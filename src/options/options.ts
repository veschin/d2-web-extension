import type { ReferenceSource } from '../shared/types';
import { loadSettings, saveSettings } from '../shared/extension-settings';
import { checkServerReachable } from '../shared/d2-server';

const listEl = document.getElementById('sources-list')!;
const addBtn = document.getElementById('add-source')!;
const saveBtn = document.getElementById('save')!;
const statusEl = document.getElementById('status')!;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const testServerBtn = document.getElementById('test-server')!;
const serverStatusEl = document.getElementById('server-status')!;

let sources: ReferenceSource[] = [];

// --- D2 Server settings ---
loadSettings().then((settings) => {
  serverUrlInput.value = settings.serverUrl;
});

testServerBtn.addEventListener('click', async () => {
  const url = serverUrlInput.value.trim();
  if (!url) {
    serverStatusEl.textContent = 'Enter a URL first';
    serverStatusEl.className = 'status status-error';
    return;
  }
  serverStatusEl.textContent = 'Testing...';
  serverStatusEl.className = 'status';
  const ok = await checkServerReachable(url);
  if (ok) {
    serverStatusEl.textContent = 'Connected!';
    serverStatusEl.className = 'status';
  } else {
    serverStatusEl.textContent = 'Unreachable';
    serverStatusEl.className = 'status status-error';
  }
  setTimeout(() => (serverStatusEl.textContent = ''), 3000);
});

function renderSources() {
  listEl.innerHTML = sources
    .map(
      (s, i) => `
    <div class="source-row" data-index="${i}">
      <input type="text" placeholder="Space key (e.g. TEAM)" value="${escapeAttr(s.spaceKey)}" data-field="spaceKey" />
      <input type="text" placeholder="Page title" value="${escapeAttr(s.pageTitle)}" data-field="pageTitle" />
      <button class="remove-btn" data-remove="${i}" title="Remove">&times;</button>
    </div>
  `
    )
    .join('');

  // Bind input changes
  listEl.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      const row = input.closest('.source-row')!;
      const idx = parseInt(row.getAttribute('data-index')!, 10);
      const field = input.getAttribute('data-field') as 'spaceKey' | 'pageTitle';
      sources[idx][field] = input.value;
    });
  });

  // Bind remove buttons
  listEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-remove')!, 10);
      sources.splice(idx, 1);
      renderSources();
    });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}

addBtn.addEventListener('click', () => {
  sources.push({ spaceKey: '', pageTitle: '' });
  renderSources();
});

saveBtn.addEventListener('click', async () => {
  // Save server URL
  await saveSettings({ serverUrl: serverUrlInput.value.trim() });

  // Filter out empty rows
  const validSources = sources.filter((s) => s.spaceKey.trim() && s.pageTitle.trim());
  await browser.runtime.sendMessage({ type: 'set-reference-sources', sources: validSources });
  sources = validSources;
  renderSources();
  statusEl.textContent = 'Saved!';
  setTimeout(() => (statusEl.textContent = ''), 2000);
});

// Load saved sources on page load
browser.runtime.sendMessage({ type: 'get-reference-sources' }).then((response) => {
  sources = response?.sources ?? [];
  if (sources.length === 0) {
    sources.push({ spaceKey: '', pageTitle: '' });
  }
  renderSources();
});

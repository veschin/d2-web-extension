import type { ReferenceSource } from '../shared/types';

const listEl = document.getElementById('sources-list')!;
const addBtn = document.getElementById('add-source')!;
const saveBtn = document.getElementById('save')!;
const statusEl = document.getElementById('status')!;

let sources: ReferenceSource[] = [];

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

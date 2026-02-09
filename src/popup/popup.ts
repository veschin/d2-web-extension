import type { MacroInfo, PageMeta } from '../shared/types';

const statusEl = document.getElementById('status')!;
const listEl = document.getElementById('macro-list')!;

function renderMacros(macros: MacroInfo[], pageMeta: PageMeta | null) {
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
      const firstLine = m.code.split('\n')[0].substring(0, 50);
      return `
      <div class="macro-item" data-index="${i}">
        <span class="macro-index">${i + 1}</span>
        <span class="macro-code">${escapeHtml(firstLine)}</span>
        <span class="macro-params">
          <span class="param-badge">${m.params.layout}</span>
        </span>
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
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Load macros from service worker
browser.runtime.sendMessage({ type: 'get-macros' }).then((response) => {
  if (response) {
    renderMacros(response.macros, response.pageMeta);
  } else {
    statusEl.className = 'status empty';
    statusEl.textContent = 'Navigate to a Confluence page first';
  }
});

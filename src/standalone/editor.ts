import type { MacroParams } from '../shared/types';
import { DEFAULT_PARAMS } from '../shared/types';
import { loadSettings } from '../shared/extension-settings';
import { loadEditorPrefs, saveEditorPrefs } from '../shared/editor-prefs';
import {
  listStandaloneDrafts,
  loadStandaloneDraft,
  saveStandaloneDraft,
  deleteStandaloneDraft,
  type StandaloneDraft,
} from '../shared/editor-prefs';
import { createEditor, setFontSize } from '../editor/editor-setup';
import { renderSvgWithFallback, formatD2, renderPng, resolveServerUrl, checkServerReachable } from '../shared/d2-server';
import type { EditorView } from '@codemirror/view';

// --- State ---
let editorView: EditorView | null = null;
let currentDraftId: string = '';
let currentParams: MacroParams = { ...DEFAULT_PARAMS };
let userServerUrl = '';
let previewEnabled = false;
let optionsOpen = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let currentFontSize = 13;

// Preview zoom/pan
let pvZoom = 1;
let pvPanX = 0;
let pvPanY = 0;
let pvPanning = false;
let pvPanStartX = 0;
let pvPanStartY = 0;

// --- DOM refs ---
const $ = (id: string) => document.getElementById(id);

function getEditorCode(): string {
  return editorView?.state.doc.toString() ?? '';
}

function setEditorCode(code: string) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: code },
  });
}

function setStatus(text: string) {
  const el = $('status');
  if (el) el.textContent = text;
}

// --- Init ---
async function init() {
  // Load settings
  try {
    const settings = await loadSettings();
    userServerUrl = settings.serverUrl;
  } catch { userServerUrl = ''; }

  const prefs = await loadEditorPrefs();
  currentFontSize = prefs.fontSize;

  // Check URL params for draft ID
  const params = new URLSearchParams(window.location.search);
  const draftId = params.get('draft');

  if (draftId) {
    const draft = await loadStandaloneDraft(draftId);
    if (draft) {
      currentDraftId = draftId;
      currentParams = { ...DEFAULT_PARAMS, ...draft.params };
      setDraftName(draft.name);
      await initEditor(draft.code);
      populateOptions();
      setStatus('Draft loaded');
      updateLastSaved(draft.updatedAt);
    } else {
      currentDraftId = generateId();
      await initEditor('');
      populateOptions();
      setStatus('Draft not found, created new');
    }
  } else {
    currentDraftId = generateId();
    await initEditor('');
    populateOptions();
  }

  // Check server
  checkServer();

  // Wire UI
  wireButtons();
  wireOptions();
  wirePreviewZoom();
}

async function initEditor(initialCode: string) {
  const container = $('editor-container');
  if (!container) return;

  editorView = await createEditor(container, initialCode, {
    onSave: () => doSave(),
    onFormat: () => doFormat(),
    onChange: () => {
      if (previewEnabled) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => doPreview(), 2000);
      }
      scheduleAutoSave();
    },
    onZoomIn: () => changeFontSize(1),
    onZoomOut: () => changeFontSize(-1),
    getServerUrl: () => userServerUrl,
  });

  if (editorView && currentFontSize !== 13) {
    setFontSize(editorView, currentFontSize);
  }
}

function changeFontSize(delta: number) {
  currentFontSize = Math.max(8, Math.min(28, currentFontSize + delta));
  if (editorView) setFontSize(editorView, currentFontSize);
  saveEditorPrefs({ fontSize: currentFontSize });
}

// --- Draft management ---
function generateId(): string {
  return `sa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDraftName(): string {
  return ($('draft-name') as HTMLInputElement)?.value.trim() || 'Untitled';
}

function setDraftName(name: string) {
  const el = $('draft-name') as HTMLInputElement;
  if (el) el.value = name;
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => doSave(true), 2000);
}

async function doSave(silent = false) {
  const draft: StandaloneDraft = {
    name: getDraftName(),
    code: getEditorCode(),
    params: { ...currentParams },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Preserve original createdAt
  const existing = await loadStandaloneDraft(currentDraftId);
  if (existing) draft.createdAt = existing.createdAt;

  await saveStandaloneDraft(currentDraftId, draft);
  updateLastSaved(draft.updatedAt);
  if (!silent) setStatus('Saved');
}

function updateLastSaved(ts: number) {
  const el = $('last-saved');
  if (el) el.textContent = `saved ${new Date(ts).toLocaleTimeString()}`;
}

// --- Preview ---
async function doPreview() {
  const canvasEl = $('preview-canvas');
  if (!canvasEl || !editorView) return;

  const code = getEditorCode();
  if (!userServerUrl) {
    canvasEl.innerHTML = '<div class="sa-preview-empty">No server URL configured.<br>Set one in the extension popup settings.</div>';
    return;
  }

  canvasEl.innerHTML = '<div class="sa-preview-loading">Rendering...</div>';
  setStatus('Rendering...');

  try {
    const { svg, error } = await renderSvgWithFallback(userServerUrl, '', code, currentParams);
    if (error) {
      canvasEl.innerHTML = `<div class="sa-preview-empty">Error: ${escapeHtml(error)}</div>`;
      setStatus('Preview error');
    } else if (svg) {
      canvasEl.innerHTML = svg;
      const svgEl = canvasEl.querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
      }
      setStatus('Preview updated');
    } else {
      canvasEl.innerHTML = '<div class="sa-preview-empty">Empty response</div>';
    }
  } catch (e) {
    canvasEl.innerHTML = `<div class="sa-preview-empty">${escapeHtml((e as Error).message)}</div>`;
    setStatus('Preview error');
  }
}

async function doFormat() {
  if (!editorView) return;
  const code = getEditorCode();
  const serverUrl = await resolveServerUrl(userServerUrl, '');
  if (!serverUrl) {
    setStatus('Format error: no server');
    return;
  }
  setStatus('Formatting...');
  const { formatted, error } = await formatD2(serverUrl, code);
  if (error) {
    setStatus(`Format error: ${error}`);
  } else if (formatted) {
    setEditorCode(formatted);
    setStatus('Formatted');
  }
}

// --- Export ---
async function exportSvg() {
  const canvasSvg = $('preview-canvas')?.querySelector('svg');
  let svgContent: string | undefined;

  if (canvasSvg) {
    svgContent = canvasSvg.outerHTML;
  } else {
    setStatus('Rendering for export...');
    const result = await renderSvgWithFallback(userServerUrl, '', getEditorCode(), currentParams);
    if (result.error || !result.svg) {
      setStatus('Export failed');
      return;
    }
    svgContent = result.svg;
  }
  downloadFile(svgContent, `${getDraftName()}.svg`, 'image/svg+xml');
  setStatus('Exported SVG');
}

async function exportPng() {
  const serverUrl = await resolveServerUrl(userServerUrl, '');
  if (!serverUrl) {
    setStatus('Export failed: no server');
    return;
  }
  setStatus('Rendering PNG...');
  const result = await renderPng(serverUrl, getEditorCode(), currentParams);
  if (result.error || !result.png) {
    setStatus('Export failed');
    return;
  }
  downloadBlob(result.png, `${getDraftName()}.png`);
  setStatus('Exported PNG');
}

async function copySvg() {
  const canvasSvg = $('preview-canvas')?.querySelector('svg');
  let svgContent: string | undefined;

  if (canvasSvg) {
    svgContent = canvasSvg.outerHTML;
  } else {
    const result = await renderSvgWithFallback(userServerUrl, '', getEditorCode(), currentParams);
    svgContent = result.svg;
  }
  if (svgContent) {
    navigator.clipboard.writeText(svgContent).catch(() => {});
    setStatus('SVG copied to clipboard');
  }
}

function downloadFile(content: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Server check ---
async function checkServer() {
  const dot = $('server-dot');
  const urlEl = $('server-url');
  if (!dot) return;
  if (!userServerUrl) {
    dot.style.background = '#ef4444';
    if (urlEl) urlEl.textContent = 'no server';
    return;
  }
  if (urlEl) urlEl.textContent = userServerUrl;
  const ok = await checkServerReachable(userServerUrl);
  dot.style.background = ok ? '#22c55e' : '#ef4444';
}

// --- Options ---
function populateOptions() {
  const setVal = (id: string, val: string) => {
    const el = $(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = val;
  };
  setVal('opt-theme', currentParams.theme);
  setVal('opt-layout', currentParams.layout);
  setVal('opt-direction', currentParams.direction);
  setVal('opt-scale', currentParams.scale);
  setVal('opt-sketch', currentParams.sketch);
  setVal('opt-preset', currentParams.preset);
}

function wireOptions() {
  const fields = ['theme', 'layout', 'direction', 'scale', 'sketch', 'preset'] as const;
  for (const field of fields) {
    const el = $(`opt-${field}`) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      el.addEventListener('change', () => {
        (currentParams as any)[field] = el.value;
        if (previewEnabled) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => doPreview(), 500);
        }
        scheduleAutoSave();
      });
    }
  }
}

// --- Preview zoom/pan ---
function updatePvTransform() {
  const canvas = $('preview-canvas') as HTMLElement | null;
  if (canvas) canvas.style.transform = `translate(${pvPanX}px, ${pvPanY}px) scale(${pvZoom})`;
  const label = $('pv-zoom-label');
  if (label) label.textContent = `${Math.round(pvZoom * 100)}%`;
}

function wirePreviewZoom() {
  $('pv-zoom-in')?.addEventListener('click', () => {
    pvZoom = Math.min(5, pvZoom + 0.25);
    updatePvTransform();
  });
  $('pv-zoom-out')?.addEventListener('click', () => {
    pvZoom = Math.max(0.1, pvZoom - 0.25);
    updatePvTransform();
  });
  $('pv-reset')?.addEventListener('click', () => {
    pvZoom = 1;
    pvPanX = 0;
    pvPanY = 0;
    updatePvTransform();
  });

  const previewContent = $('preview-content');
  if (!previewContent) return;

  previewContent.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    pvZoom = Math.max(0.1, Math.min(5, pvZoom + delta));
    updatePvTransform();
  }, { passive: false });

  previewContent.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();
      pvPanning = true;
      pvPanStartX = e.clientX - pvPanX;
      pvPanStartY = e.clientY - pvPanY;
      previewContent.style.cursor = 'grabbing';
    }
  });

  previewContent.addEventListener('mousemove', (e) => {
    if (!pvPanning) return;
    pvPanX = e.clientX - pvPanStartX;
    pvPanY = e.clientY - pvPanStartY;
    updatePvTransform();
  });

  const stopPan = () => {
    if (pvPanning) {
      pvPanning = false;
      const pc = $('preview-content');
      if (pc) pc.style.cursor = '';
    }
  };
  previewContent.addEventListener('mouseup', stopPan);
  previewContent.addEventListener('mouseleave', stopPan);
}

// --- Open dialog ---
async function showOpenDialog() {
  const dialog = $('open-dialog');
  if (!dialog) return;
  dialog.style.display = '';

  const listEl = $('open-dialog-list');
  if (!listEl) return;

  const drafts = await listStandaloneDrafts();
  if (drafts.length === 0) {
    listEl.innerHTML = '<div class="sa-dialog-empty">No saved drafts</div>';
    return;
  }

  listEl.innerHTML = drafts.map((d) => `
    <div class="sa-draft-item" data-draft-id="${escapeHtml(d.id)}">
      <div class="sa-draft-item-info">
        <div class="sa-draft-item-name">${escapeHtml(d.name)}</div>
        <div class="sa-draft-item-date">${new Date(d.updatedAt).toLocaleString()}</div>
      </div>
      <div class="sa-draft-item-actions">
        <button class="sa-btn sa-btn-sm sa-btn-danger" data-delete-draft="${escapeHtml(d.id)}">Delete</button>
      </div>
    </div>
  `).join('');

  // Wire clicks
  listEl.querySelectorAll('.sa-draft-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-delete-draft]')) return;
      const id = item.getAttribute('data-draft-id');
      if (id) openDraft(id);
    });
  });

  listEl.querySelectorAll('[data-delete-draft]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-draft');
      if (id && confirm(`Delete draft "${drafts.find((d) => d.id === id)?.name ?? id}"?`)) {
        await deleteStandaloneDraft(id);
        showOpenDialog(); // Refresh list
      }
    });
  });
}

function hideOpenDialog() {
  const dialog = $('open-dialog');
  if (dialog) dialog.style.display = 'none';
}

async function openDraft(id: string) {
  const draft = await loadStandaloneDraft(id);
  if (!draft) return;

  currentDraftId = id;
  currentParams = { ...DEFAULT_PARAMS, ...draft.params };
  setDraftName(draft.name);
  setEditorCode(draft.code);
  populateOptions();
  updateLastSaved(draft.updatedAt);
  setStatus('Draft loaded');
  hideOpenDialog();

  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.set('draft', id);
  history.replaceState(null, '', url.toString());

  if (previewEnabled) doPreview();
}

// --- Wire buttons ---
function wireButtons() {
  $('btn-new')?.addEventListener('click', () => {
    currentDraftId = generateId();
    currentParams = { ...DEFAULT_PARAMS };
    setDraftName('');
    setEditorCode('');
    populateOptions();
    setStatus('New draft');
    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('draft', currentDraftId);
    history.replaceState(null, '', url.toString());
  });

  $('btn-open')?.addEventListener('click', () => showOpenDialog());
  $('open-dialog-close')?.addEventListener('click', () => hideOpenDialog());
  $('open-dialog')?.addEventListener('click', (e) => {
    if (e.target === $('open-dialog')) hideOpenDialog();
  });

  $('btn-format')?.addEventListener('click', () => doFormat());

  $('btn-preview')?.addEventListener('click', () => {
    previewEnabled = !previewEnabled;
    const pane = $('preview-pane');
    const btn = $('btn-preview');
    if (pane) pane.style.display = previewEnabled ? '' : 'none';
    if (btn) btn.classList.toggle('active', previewEnabled);
    if (previewEnabled) doPreview();
  });

  $('btn-options')?.addEventListener('click', () => {
    optionsOpen = !optionsOpen;
    const pane = $('options-pane');
    const btn = $('btn-options');
    if (pane) pane.style.display = optionsOpen ? '' : 'none';
    if (btn) btn.classList.toggle('active', optionsOpen);
  });

  // Export
  $('btn-export')?.addEventListener('click', () => {
    const dd = $('export-dropdown');
    if (dd) dd.style.display = dd.style.display === 'none' ? '' : 'none';
  });
  document.querySelector('[data-export="svg"]')?.addEventListener('click', () => {
    hideExportDropdown();
    exportSvg();
  });
  document.querySelector('[data-export="png"]')?.addEventListener('click', () => {
    hideExportDropdown();
    exportPng();
  });
  document.querySelector('[data-export="copy"]')?.addEventListener('click', () => {
    hideExportDropdown();
    copySvg();
  });

  // Close export dropdown on outside click
  document.addEventListener('click', (e) => {
    const dd = $('export-dropdown');
    if (dd?.style.display !== 'none') {
      const wrap = (e.target as HTMLElement).closest('.sa-export-wrap');
      if (!wrap) hideExportDropdown();
    }
  });

  // Draft name change triggers auto-save
  $('draft-name')?.addEventListener('input', () => scheduleAutoSave());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      doSave();
    }
  });
}

function hideExportDropdown() {
  const dd = $('export-dropdown');
  if (dd) dd.style.display = 'none';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Go!
init();

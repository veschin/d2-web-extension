import type { MacroInfo, PageMeta } from '../shared/types';
import { renderSvg, formatD2 } from '../shared/d2-server';
import { fetchPageStorage, parseStorageMacros, replaceStorageMacroCode, savePage } from '../shared/confluence-api';
import { createEditor } from '../editor/editor-setup';
import type { EditorView } from '@codemirror/view';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let editorView: EditorView | null = null;
let currentMacro: MacroInfo | null = null;
let originalCode = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Lucide-style SVG icons (inline) */
const ICONS = {
  save: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>',
  alignLeft: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/></svg>',
  eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  loader: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>',
};

function q(selector: string): HTMLElement | null {
  return shadow?.querySelector(selector) ?? null;
}

function getEditorCode(): string {
  return editorView?.state.doc.toString() ?? '';
}

function setEditorCode(code: string) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: code },
  });
}

/** Open the editor modal for a specific macro */
export async function openEditor(macro: MacroInfo, pageMeta: PageMeta) {
  currentMacro = macro;
  originalCode = macro.code;

  if (hostEl) {
    closeEditor();
  }

  // Create shadow DOM host
  hostEl = document.createElement('div');
  hostEl.id = 'd2ext-shadow-host';
  hostEl.style.all = 'initial';
  shadow = hostEl.attachShadow({ mode: 'open' });

  // Inject styles into shadow root
  const style = document.createElement('style');
  style.textContent = MODAL_CSS;
  shadow.appendChild(style);

  // Create modal DOM inside shadow root
  const overlay = document.createElement('div');
  overlay.className = 'd2ext-modal-overlay';
  overlay.innerHTML = `
    <div class="d2ext-modal">
      <div class="d2ext-modal-header">
        <div class="d2ext-modal-title">
          <span class="d2ext-modal-badge">#${macro.domIndex + 1}</span>
          D2 Editor
          <span class="d2ext-modal-params">${macro.params.layout} | theme ${macro.params.theme}</span>
        </div>
        <div class="d2ext-modal-actions">
          <button class="d2ext-btn" data-action="preview" title="Preview (Ctrl+P)">${ICONS.eye} Preview</button>
          <button class="d2ext-btn" data-action="format" title="Format (Ctrl+Shift+F)">${ICONS.alignLeft} Format</button>
          <button class="d2ext-btn d2ext-btn-primary" data-action="save" title="Save (Ctrl+S)">${ICONS.save} Save</button>
          <button class="d2ext-btn" data-action="close" title="Close (Escape)">${ICONS.x}</button>
        </div>
      </div>
      <div class="d2ext-modal-body">
        <div class="d2ext-editor-pane" id="d2ext-editor-container"></div>
        <div class="d2ext-preview-pane">
          <div class="d2ext-preview-content" id="d2ext-preview">
            <div class="d2ext-preview-loading">${ICONS.loader} Loading preview...</div>
          </div>
          <div class="d2ext-error-bar" id="d2ext-error" style="display:none"></div>
        </div>
      </div>
      <div class="d2ext-modal-footer">
        <span class="d2ext-status" id="d2ext-status">Ready</span>
        <span class="d2ext-server-url">${macro.params.server || 'no server detected'}</span>
      </div>
    </div>
  `;

  shadow.appendChild(overlay);
  document.body.appendChild(hostEl);

  // Button handlers
  overlay.querySelector('[data-action="preview"]')?.addEventListener('click', () => doPreview());
  overlay.querySelector('[data-action="format"]')?.addEventListener('click', () => doFormat());
  overlay.querySelector('[data-action="save"]')?.addEventListener('click', () => doSave(pageMeta));
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => closeEditor());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditor();
  });

  // Create CodeMirror editor
  setStatus('Loading editor...');
  try {
    const container = q('#d2ext-editor-container')!;
    editorView = await createEditor(container, macro.code, {
      onSave: () => doSave(pageMeta),
      onFormat: () => doFormat(),
      onChange: () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => doPreview(), 500);
      },
    });

    setStatus('Ready');
    // Initial preview
    doPreview();
  } catch (e) {
    setStatus(`Error: ${(e as Error).message}`);
  }

  // Escape to close
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && hostEl) {
      closeEditor();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/** Close the editor modal */
function closeEditor() {
  if (!hostEl) return;

  const currentCode = getEditorCode();
  if (currentCode !== originalCode) {
    if (!confirm('You have unsaved changes. Close anyway?')) return;
  }

  editorView?.destroy();
  editorView = null;
  hostEl.remove();
  hostEl = null;
  shadow = null;
  currentMacro = null;
}

/** Render preview via d2server */
async function doPreview() {
  if (!editorView || !currentMacro) return;

  const code = getEditorCode();
  const serverUrl = currentMacro.params.server;
  if (!serverUrl) {
    showError('No D2 server URL detected. Configure it in extension options.');
    return;
  }

  const previewEl = q('#d2ext-preview');
  if (!previewEl) return;

  setStatus('Rendering...');
  hideError();

  const { svg, error } = await renderSvg(serverUrl, code, currentMacro.params);

  if (error) {
    showError(error);
    setStatus('Error');
  } else if (svg) {
    previewEl.innerHTML = svg;
    // Make SVG responsive
    const svgEl = previewEl.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = '100%';
      svgEl.style.height = 'auto';
    }
    setStatus('Preview updated');
  }
}

/** Format code via d2server */
async function doFormat() {
  if (!editorView || !currentMacro) return;

  const code = getEditorCode();
  const serverUrl = currentMacro.params.server;
  if (!serverUrl) return;

  setStatus('Formatting...');
  const { formatted, error } = await formatD2(serverUrl, code);

  if (error) {
    showError(error);
    setStatus('Format error');
  } else if (formatted) {
    setEditorCode(formatted);
    hideError();
    setStatus('Formatted');
  }
}

/** Save the edited code back to Confluence */
async function doSave(pageMeta: PageMeta) {
  if (!editorView || !currentMacro) return;

  const newCode = getEditorCode();
  if (newCode === originalCode) {
    setStatus('No changes to save');
    return;
  }

  setStatus('Saving...');

  if (currentMacro.mode === 'edit') {
    saveEditMode(newCode);
  } else {
    await saveViewMode(pageMeta, newCode);
  }
}

/** Save in edit mode by modifying TinyMCE DOM */
function saveEditMode(newCode: string) {
  const ext = (window as any).__d2ext;
  if (!ext?.elements || !currentMacro) return;

  const element = ext.elements[currentMacro.domIndex];
  if (!element) {
    setStatus('Error: macro element not found');
    return;
  }

  const pre = element.querySelector('td.wysiwyg-macro-body pre');
  if (pre) {
    pre.textContent = newCode;
    const event = new Event('input', { bubbles: true });
    pre.dispatchEvent(event);
    originalCode = newCode;
    setStatus('Saved to editor. Click Publish to persist.');
  } else {
    setStatus('Error: could not find macro body');
  }
}

/** Save in view mode via Confluence REST API */
async function saveViewMode(pageMeta: PageMeta, newCode: string) {
  if (!currentMacro) return;

  try {
    const { storageValue, version, title } = await fetchPageStorage(pageMeta.pageId);
    const storageMacros = parseStorageMacros(storageValue);
    const targetMacro = storageMacros.find((m) => m.macroId === currentMacro!.macroId);

    if (!targetMacro) {
      setStatus('Error: macro not found in page storage');
      return;
    }

    if (targetMacro.code.trim() !== originalCode.trim()) {
      setStatus('Warning: page was modified externally. Please refresh and try again.');
      return;
    }

    const newStorage = replaceStorageMacroCode(storageValue, currentMacro.macroId, newCode);
    const result = await savePage(pageMeta.pageId, title, version, newStorage);

    if (result.success) {
      originalCode = newCode;
      setStatus(`Saved! Version ${result.newVersion}`);
      refreshDiagramOnPage(newCode);
    } else {
      setStatus(`Save failed: ${result.error}`);
    }
  } catch (e) {
    setStatus(`Save error: ${(e as Error).message}`);
  }
}

/** Re-render the diagram on the page after save */
function refreshDiagramOnPage(newCode: string) {
  if (!currentMacro) return;
  const ext = (window as any).__d2ext;
  if (!ext?.elements) return;

  const element = ext.elements[currentMacro.domIndex];
  if (!element) return;

  const codeDiv = element.querySelector('.d2-code');
  if (codeDiv) {
    codeDiv.textContent = newCode.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/&/g, '&amp;');
  }

  const diagramDiv = element.querySelector('.d2-diagram');
  if (diagramDiv && currentMacro.params.server) {
    renderSvg(currentMacro.params.server, newCode, currentMacro.params).then(({ svg }) => {
      if (svg && diagramDiv) {
        const container = diagramDiv.querySelector('[id^="svg-container"]') || diagramDiv;
        container.innerHTML = svg;
        const svgEl = container.querySelector('svg');
        if (svgEl) {
          svgEl.style.transformOrigin = 'top left';
        }
      }
    });
  }
}

function setStatus(text: string) {
  const el = q('#d2ext-status');
  if (el) el.textContent = text;
}

function showError(text: string) {
  const el = q('#d2ext-error');
  if (el) {
    el.style.display = 'block';
    el.textContent = text;
  }
}

function hideError() {
  const el = q('#d2ext-error');
  if (el) el.style.display = 'none';
}

// --- CSS injected into shadow DOM (isolated from page styles) ---

const MODAL_CSS = `
  :host {
    all: initial;
  }

  .d2ext-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #333;
  }

  .d2ext-modal {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    width: 90vw;
    height: 85vh;
    max-width: 1400px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .d2ext-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid #e0e0e0;
    background: #f8f9fa;
    flex-shrink: 0;
  }

  .d2ext-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #333;
  }

  .d2ext-modal-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: #4a90d9;
    color: white;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
  }

  .d2ext-modal-params {
    font-size: 11px;
    color: #888;
    font-weight: 400;
  }

  .d2ext-modal-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .d2ext-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: #f0f0f0;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: #444;
    transition: background 0.15s;
    font-family: inherit;
  }

  .d2ext-btn:hover {
    background: #e0e0e0;
  }

  .d2ext-btn-primary {
    background: #4a90d9;
    border-color: #3a7bc8;
    color: white;
  }

  .d2ext-btn-primary:hover {
    background: #3a7bc8;
  }

  .d2ext-modal-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .d2ext-editor-pane {
    flex: 1;
    min-width: 0;
    border-right: 1px solid #e0e0e0;
  }

  .d2ext-preview-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .d2ext-preview-content {
    flex: 1;
    overflow: auto;
    padding: 16px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .d2ext-preview-content svg {
    max-width: 100%;
    height: auto;
  }

  .d2ext-preview-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #888;
    font-size: 13px;
    padding: 40px;
  }

  .d2ext-preview-loading svg {
    animation: d2ext-spin 1s linear infinite;
  }

  @keyframes d2ext-spin {
    to { transform: rotate(360deg); }
  }

  .d2ext-error-bar {
    padding: 8px 12px;
    background: #fff3f3;
    border-top: 1px solid #ffcdd2;
    color: #c62828;
    font-size: 12px;
    font-family: monospace;
    white-space: pre-wrap;
    max-height: 120px;
    overflow: auto;
    flex-shrink: 0;
  }

  .d2ext-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px;
    border-top: 1px solid #e0e0e0;
    background: #f8f9fa;
    font-size: 11px;
    color: #888;
    flex-shrink: 0;
  }

  .d2ext-status {
    font-weight: 500;
  }

  /* CodeMirror inside shadow DOM needs its own base styles */
  .cm-editor {
    height: 100%;
  }
  .cm-scroller {
    overflow: auto;
  }
`;

// Listen for open-editor events (from popup or overlay buttons)
window.addEventListener('d2ext-open-editor', ((e: CustomEvent) => {
  const { macroIndex } = e.detail;
  const ext = (window as any).__d2ext;
  if (!ext?.macros?.[macroIndex] || !ext.pageMeta) return;
  openEditor(ext.macros[macroIndex], ext.pageMeta);
}) as EventListener);

// Also listen for browser runtime messages (from popup)
browser.runtime?.onMessage?.addListener((message: any) => {
  if (message.type === 'open-editor') {
    const ext = (window as any).__d2ext;
    if (!ext?.macros?.[message.macroIndex] || !ext.pageMeta) return;
    openEditor(ext.macros[message.macroIndex], ext.pageMeta);
  }
});

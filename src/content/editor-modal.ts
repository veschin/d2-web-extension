import type { MacroInfo, MacroParams, PageMeta, ReferenceSource, ReferenceBlock, ReferenceMacro, EnrichedBlock, BlockMetadata } from '../shared/types';
import { DEFAULT_PARAMS } from '../shared/types';
import { renderSvg, formatD2, renderSvgWithFallback, resolveServerUrl, renderPng, checkServerReachable } from '../shared/d2-server';
import { loadSettings } from '../shared/extension-settings';
import { fetchPageStorage, parseStorageMacros, replaceStorageMacroCode, replaceStorageMacroParams, savePage, fetchPageMacrosByUrl } from '../shared/confluence-api';
import { createEditor, setFontSize } from '../editor/editor-setup';
import { setReferenceCompletions, initD2Parser } from '../editor/d2-language';
import { analyzeD2Block } from '../editor/d2-analyzer';
import { extractD2Blocks, type D2Block } from '../shared/d2-parser';
import type { EditorView } from '@codemirror/view';
import type { Parser } from 'web-tree-sitter';
import { logInfo, logWarn, logError, logTimed } from '../shared/logger';
import { loadEditorPrefs, saveEditorPrefs, saveDraft, loadDraft, clearDraft } from '../shared/editor-prefs';

const REF_SOURCES_KEY = 'd2ext-ref-sources';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let editorView: EditorView | null = null;
let currentMacro: MacroInfo | null = null;
let originalCode = '';
let originalParams: MacroParams = { ...DEFAULT_PARAMS };
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let previewEnabled = false;
let libraryOpen = false;
let optionsOpen = false;
let userServerUrl = '';

// Library panel state
let libraryView: 'sources' | 'macros' | 'blocks' = 'sources';
let librarySources: ReferenceSource[] = [];
let libraryMacroData: Map<string, { macros: ReferenceMacro[]; pageTitle: string }> = new Map();
let currentLibSource: ReferenceSource | null = null;
let currentLibMacroIdx = -1;
let libraryInitialized = false;
let thumbnailObserver: IntersectionObserver | null = null;
let libViewerView: EditorView | null = null;
let d2Parser: Parser | undefined;
const metadataCache = new Map<string, BlockMetadata>();

/** Lucide icons (lucide.dev, MIT license) */
const ICONS = {
  save: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>',
  alignLeft: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10H3"/><path d="M21 6H3"/><path d="M21 14H3"/><path d="M21 18H3"/></svg>',
  eye: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  loader: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  library: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/></svg>',
  settings: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  refreshCw: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  download: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
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

/** Update macro code in the global macros array so reopening shows the latest saved version */
function updateMacroCode(newCode: string) {
  if (!currentMacro) return;
  currentMacro.code = newCode;
  const ext = (window as any).__d2ext;
  if (ext?.macros) {
    const m = ext.macros.find((m: MacroInfo) => m.macroId === currentMacro!.macroId);
    if (m) m.code = newCode;
  }
}

/** Open the editor modal for a specific macro */
export async function openEditor(macro: MacroInfo, pageMeta: PageMeta) {
  // Close any existing editor first (before setting currentMacro,
  // because closeEditor() resets it to null)
  if (hostEl) {
    // Suppress unsaved-changes prompt when reopening
    originalCode = getEditorCode();
    closeEditor();
  }

  currentMacro = macro;
  originalCode = macro.code;
  originalParams = { ...macro.params };

  // Load user server URL from settings
  try {
    const settings = await loadSettings();
    userServerUrl = settings.serverUrl;
  } catch { userServerUrl = ''; }

  // Create shadow DOM host
  hostEl = document.createElement('div');
  hostEl.id = 'd2ext-shadow-host';
  hostEl.style.all = 'initial';
  shadow = hostEl.attachShadow({ mode: 'open' });

  // Inject styles into shadow root
  const fontUrl = browser.runtime?.getURL?.('assets/Agave-Regular-slashed.ttf') ?? '';
  const style = document.createElement('style');
  style.textContent = (fontUrl
    ? `@font-face { font-family: 'Agave'; src: url('${fontUrl}') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }\n`
    : '') + MODAL_CSS;
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
        </div>
        <div class="d2ext-modal-actions">
          <button class="d2ext-btn" data-action="zoom-out" title="Decrease font size (Ctrl+-)">A-</button>
          <button class="d2ext-btn" data-action="zoom-in" title="Increase font size (Ctrl+=)">A+</button>
          <button class="d2ext-btn" data-action="options" title="Macro parameters">${ICONS.settings}<span class="d2ext-btn-label"> Options</span></button>
          <button class="d2ext-btn" data-action="library" title="Reference library">${ICONS.library}<span class="d2ext-btn-label"> Library</span></button>
          <button class="d2ext-btn" data-action="preview" title="Toggle preview panel">${ICONS.eye}<span class="d2ext-btn-label"> Preview</span></button>
          <button class="d2ext-btn" data-action="format" title="Format (Ctrl+Shift+F)">${ICONS.alignLeft}<span class="d2ext-btn-label"> Format</span></button>
          <div class="d2ext-export-wrap">
            <button class="d2ext-btn" data-action="export" title="Export diagram">${ICONS.download}<span class="d2ext-btn-label"> Export</span></button>
            <div class="d2ext-export-dropdown" id="d2ext-export-dropdown" style="display:none">
              <button class="d2ext-export-option" data-export="svg">Export as SVG</button>
              <button class="d2ext-export-option" data-export="png">Export as PNG</button>
            </div>
          </div>
          <button class="d2ext-btn d2ext-btn-primary" data-action="save" title="Save (Ctrl+S)">${ICONS.save}<span class="d2ext-btn-label"> Save</span></button>
          <button class="d2ext-btn" data-action="close" title="Close (Escape)">${ICONS.x}</button>
        </div>
      </div>
      <div class="d2ext-modal-body">
        <div class="d2ext-editor-pane" id="d2ext-editor-container"></div>
        <div class="d2ext-preview-pane" id="d2ext-preview-pane" style="display:none">
          <div class="d2ext-preview-toolbar">
            <button class="d2ext-btn d2ext-btn-sm" data-preview-action="zoom-in" title="Zoom in">+</button>
            <button class="d2ext-btn d2ext-btn-sm" data-preview-action="zoom-out" title="Zoom out">&minus;</button>
            <button class="d2ext-btn d2ext-btn-sm" data-preview-action="reset" title="Reset zoom">1:1</button>
            <span class="d2ext-preview-zoom-label" id="d2ext-zoom-label">100%</span>
          </div>
          <div class="d2ext-preview-content" id="d2ext-preview">
            <div class="d2ext-preview-canvas" id="d2ext-preview-canvas">
              <div class="d2ext-preview-loading">${ICONS.loader} Loading...</div>
            </div>
          </div>
          <div class="d2ext-error-bar" id="d2ext-error" style="display:none"></div>
        </div>
        <div class="d2ext-library-pane" id="d2ext-library-pane" style="display:none">
          <div class="d2ext-lib-breadcrumb" id="d2ext-lib-breadcrumb"></div>
          <div class="d2ext-lib-search-bar">
            <input type="text" class="d2ext-lib-search" id="d2ext-lib-search" placeholder="Search blocks..." />
          </div>
          <div class="d2ext-lib-content" id="d2ext-lib-content"></div>
          <div class="d2ext-lib-viewer" id="d2ext-lib-viewer" style="display:none"></div>
        </div>
        <div class="d2ext-options-pane" id="d2ext-options-pane" style="display:none">
          <div class="d2ext-options-title">Macro Parameters</div>
          <div class="d2ext-options-form" id="d2ext-options-form">
            <label class="d2ext-opt-label">Theme
              <select id="d2ext-opt-theme" class="d2ext-opt-input">
                <option value="0">0 (Default)</option>
                <option value="1">1 (Neutral Grey)</option>
                <option value="3">3 (Vanilla)</option>
                <option value="4">4 (Aubergine)</option>
                <option value="5">5 (Cool Classics)</option>
                <option value="6">6 (Mixed Berry)</option>
                <option value="100">100 (Terminal)</option>
                <option value="101">101 (Terminal Grayscale)</option>
                <option value="102">102 (Origami)</option>
              </select>
            </label>
            <label class="d2ext-opt-label">Layout
              <select id="d2ext-opt-layout" class="d2ext-opt-input">
                <option value="elk">elk</option>
                <option value="dagre">dagre</option>
              </select>
            </label>
            <label class="d2ext-opt-label">Direction
              <select id="d2ext-opt-direction" class="d2ext-opt-input">
                <option value="up">up</option>
                <option value="down">down</option>
                <option value="left">left</option>
                <option value="right">right</option>
              </select>
            </label>
            <label class="d2ext-opt-label">Scale
              <input type="number" id="d2ext-opt-scale" class="d2ext-opt-input" step="0.1" min="0.1" max="3" />
            </label>
            <label class="d2ext-opt-label">Sketch
              <select id="d2ext-opt-sketch" class="d2ext-opt-input">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label class="d2ext-opt-label">Preset
              <input type="text" id="d2ext-opt-preset" class="d2ext-opt-input" placeholder="(optional)" />
            </label>
            <label class="d2ext-opt-label">Server URL
              <input type="text" id="d2ext-opt-server" class="d2ext-opt-input" placeholder="https://..." />
            </label>
          </div>
        </div>
      </div>
      <div class="d2ext-modal-footer">
        <span class="d2ext-status" id="d2ext-status">Ready</span>
        <span class="d2ext-server-info">
          <span class="d2ext-server-dot" id="d2ext-server-dot"></span>
          <span class="d2ext-server-url" id="d2ext-server-url">${userServerUrl ? 'user: ' + userServerUrl : (macro.params.server ? 'macro: ' + macro.params.server : 'no server')}</span>
        </span>
      </div>
    </div>
  `;

  shadow.appendChild(overlay);
  document.body.appendChild(hostEl);

  // Stop keyboard events from leaking to the page (Confluence shortcuts intercept keys).
  // Use bubble phase (no `true`) so events reach CodeMirror children first.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Only close if Escape wasn't consumed by CM (autocomplete, tooltip, etc.)
      const target = e.target as HTMLElement | null;
      const inCm = target?.closest?.('.cm-editor');
      if (!inCm) closeEditor();
    }
    // Prevent browser defaults (Ctrl+S "Save page" dialog, etc.)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') e.preventDefault();
    e.stopPropagation();
  });
  overlay.addEventListener('keypress', (e) => e.stopPropagation());
  overlay.addEventListener('keyup', (e) => e.stopPropagation());

  // Button handlers
  overlay.querySelector('[data-action="options"]')?.addEventListener('click', () => toggleOptions());
  overlay.querySelector('[data-action="library"]')?.addEventListener('click', () => toggleLibrary(pageMeta));
  overlay.querySelector('[data-action="preview"]')?.addEventListener('click', () => togglePreview());
  overlay.querySelector('[data-action="format"]')?.addEventListener('click', () => doFormat());
  overlay.querySelector('[data-action="save"]')?.addEventListener('click', () => doSave(pageMeta));
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => closeEditor());
  overlay.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => changeFontSize(1));
  overlay.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => changeFontSize(-1));

  // Preview zoom buttons
  overlay.querySelector('[data-preview-action="zoom-in"]')?.addEventListener('click', () => {
    previewZoom = Math.min(5, previewZoom + 0.25);
    updatePreviewTransform();
  });
  overlay.querySelector('[data-preview-action="zoom-out"]')?.addEventListener('click', () => {
    previewZoom = Math.max(0.1, previewZoom - 0.25);
    updatePreviewTransform();
  });
  overlay.querySelector('[data-preview-action="reset"]')?.addEventListener('click', () => resetPreviewZoom());

  // Init pan/zoom on preview
  initPreviewZoomPan();

  // Export button + dropdown
  overlay.querySelector('[data-action="export"]')?.addEventListener('click', () => toggleExportDropdown());
  overlay.querySelector('[data-export="svg"]')?.addEventListener('click', () => { hideExportDropdown(); exportAsSvg(); });
  overlay.querySelector('[data-export="png"]')?.addEventListener('click', () => { hideExportDropdown(); exportAsPng(); });

  overlay.addEventListener('click', (e) => {
    // Close export dropdown on outside click
    const dropdown = q('#d2ext-export-dropdown');
    if (dropdown?.style.display !== 'none') {
      const wrap = (e.target as HTMLElement).closest?.('.d2ext-export-wrap');
      if (!wrap) hideExportDropdown();
    }
    if (e.target === overlay) closeEditor();
  });

  // Load persistent editor preferences
  const prefs = await loadEditorPrefs();
  currentFontSize = prefs.fontSize;

  // Create CodeMirror editor
  setStatus('Loading editor...');
  logInfo('editor', `Opening editor for macro #${macro.domIndex + 1}`, { macroId: macro.macroId });
  try {
    const container = q('#d2ext-editor-container')!;
    editorView = await createEditor(container, macro.code, {
      onSave: () => doSave(pageMeta),
      onFormat: () => doFormat(),
      onChange: () => {
        if (previewEnabled) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => doPreview(), 2000);
        }
        // Auto-save draft
        if (currentMacro?.macroId) {
          if (draftTimer) clearTimeout(draftTimer);
          draftTimer = setTimeout(() => {
            if (currentMacro?.macroId) saveDraft(currentMacro.macroId, getEditorCode());
          }, 2000);
        }
      },
      onZoomIn: () => changeFontSize(1),
      onZoomOut: () => changeFontSize(-1),
      getServerUrl: () => userServerUrl || currentMacro?.params.server || '',
    });

    // Apply persisted font size via compartment
    if (editorView && currentFontSize !== 13) {
      setFontSize(editorView, currentFontSize);
    }

    // Check for unsaved draft
    if (macro.macroId) {
      const draft = await loadDraft(macro.macroId);
      if (draft && draft !== macro.code) {
        const useDraft = confirm('An unsaved draft was found for this macro. Restore it?');
        if (useDraft) {
          setEditorCode(draft);
          setStatus('Draft restored');
        } else {
          await clearDraft(macro.macroId);
        }
      }
    }

    setStatus('Ready');
  } catch (e) {
    setStatus(`Error: ${(e as Error).message}`);
    logError('editor', `Failed to create editor: ${(e as Error).message}`);
  }

  // Ping server for connection indicator
  checkServerConnection(macro.params.server);
}

async function checkServerConnection(macroServerUrl: string) {
  const dot = q('#d2ext-server-dot');
  const urlEl = q('#d2ext-server-url');
  if (!dot) return;

  const resolved = await resolveServerUrl(userServerUrl, macroServerUrl);
  if (!resolved) {
    dot.style.background = '#ef4444';
    if (urlEl) urlEl.textContent = 'no server';
    return;
  }

  const isUserServer = resolved === userServerUrl && userServerUrl !== '';
  if (urlEl) urlEl.textContent = `${isUserServer ? 'user' : 'macro'}: ${resolved}`;

  const ok = await checkServerReachable(resolved);
  dot.style.background = ok ? '#22c55e' : '#ef4444';
}

/** Close the editor modal */
function closeEditor() {
  if (!hostEl) return;

  if (editorView) {
    const currentCode = getEditorCode();
    if (currentCode !== originalCode) {
      if (!confirm('You have unsaved changes. Close anyway?')) return;
    }
  }

  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  previewInFlight = false;

  editorView?.destroy();
  editorView = null;
  libViewerView?.destroy();
  libViewerView = null;
  hostEl.remove();
  hostEl = null;
  shadow = null;
  currentMacro = null;
  previewEnabled = false;
  previewZoom = 1;
  previewPanX = 0;
  previewPanY = 0;
  libraryOpen = false;
  libraryInitialized = false;
  optionsOpen = false;
  libraryView = 'sources';
  librarySources = [];
  libraryMacroData = new Map();
  currentLibSource = null;
  currentLibMacroIdx = -1;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  setReferenceCompletions([]);
  metadataCache.clear();
}

/** Toggle the preview pane */
function togglePreview() {
  logInfo('preview', `togglePreview called, was ${previewEnabled}`);
  previewEnabled = !previewEnabled;
  const pane = q('#d2ext-preview-pane');
  if (pane) pane.style.display = previewEnabled ? '' : 'none';
  if (previewEnabled) doPreview();
}

/** Change editor font size */
let currentFontSize = 13;
function changeFontSize(delta: number) {
  currentFontSize = Math.max(8, Math.min(28, currentFontSize + delta));
  if (editorView) setFontSize(editorView, currentFontSize);
  saveEditorPrefs({ fontSize: currentFontSize });
}

/** Toggle the macro options panel */
function toggleOptions() {
  optionsOpen = !optionsOpen;
  const pane = q('#d2ext-options-pane');
  if (pane) pane.style.display = optionsOpen ? '' : 'none';
  if (optionsOpen && currentMacro) populateOptions(currentMacro.params);
}

/** Populate options form with current macro params */
function populateOptions(params: MacroInfo['params']) {
  const setVal = (id: string, val: string) => {
    const el = q(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = val;
  };

  setVal('#d2ext-opt-theme', params.theme);
  setVal('#d2ext-opt-layout', params.layout);
  setVal('#d2ext-opt-direction', params.direction);
  setVal('#d2ext-opt-scale', params.scale);
  setVal('#d2ext-opt-sketch', params.sketch);
  setVal('#d2ext-opt-preset', params.preset);

  setVal('#d2ext-opt-server', params.server);

  // Wire change handlers
  const fields = ['theme', 'layout', 'direction', 'scale', 'sketch', 'preset', 'server'] as const;
  for (const field of fields) {
    const el = q(`#d2ext-opt-${field}`) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      el.onchange = () => {
        if (!currentMacro) return;
        (currentMacro.params as any)[field] = el.value;
        // Update server URL display if changed
        if (field === 'server') {
          const urlEl = q('#d2ext-server-url');
          if (urlEl) urlEl.textContent = el.value || 'no server';
          checkServerConnection(el.value);
        }
        // Re-render preview if enabled
        if (previewEnabled) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => doPreview(), 2000);
        }
      };
    }
  }
}

/** Toggle the reference library panel */
function toggleLibrary(_pageMeta: PageMeta) {
  libraryOpen = !libraryOpen;
  const pane = q('#d2ext-library-pane');
  if (pane) pane.style.display = libraryOpen ? '' : 'none';
  if (libraryOpen && !libraryInitialized) {
    libraryInitialized = true;
    initLibrary();
  }
}

/** Initialize library panel: load sources, wire search */
async function initLibrary() {
  // Cache parser for metadata analysis
  try { d2Parser = await initD2Parser(); } catch { /* fallback to regex */ }

  // Load configured sources directly from storage (bypasses SW cold-start)
  try {
    const result = await browser.storage.local.get(REF_SOURCES_KEY);
    librarySources = (result[REF_SOURCES_KEY] as ReferenceSource[]) ?? [];
  } catch { librarySources = []; }

  // Wire search with debounce
  const searchInput = q('#d2ext-lib-search') as HTMLInputElement | null;
  if (searchInput) {
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const query = searchInput.value.trim().toLowerCase();
        if (query.length >= 2) {
          renderSearchResults(query);
        } else if (libraryView === 'sources') {
          renderLibrarySources();
        } else if (libraryView === 'macros' && currentLibSource) {
          renderLibraryMacros(currentLibSource);
        } else if (libraryView === 'blocks' && currentLibSource) {
          renderLibraryBlocks(currentLibSource, currentLibMacroIdx);
        }
      }, 150);
    });
  }

  renderLibraryBreadcrumb();
  renderLibrarySources();
}

/** Render breadcrumb navigation */
function renderLibraryBreadcrumb() {
  const el = q('#d2ext-lib-breadcrumb');
  if (!el) return;

  const parts: string[] = [];
  parts.push(libraryView === 'sources'
    ? '<span class="d2ext-lib-bc-current">Library</span>'
    : '<span class="d2ext-lib-bc-link" data-bc="sources">Library</span>');

  if (libraryView === 'macros' || libraryView === 'blocks') {
    const data = currentLibSource ? libraryMacroData.get(currentLibSource.spaceKey) : null;
    const title = data?.pageTitle || currentLibSource?.pageTitle || '';
    parts.push('<span class="d2ext-lib-bc-sep">&rsaquo;</span>');
    parts.push(libraryView === 'macros'
      ? `<span class="d2ext-lib-bc-current">${escapeHtml(title)}</span>`
      : `<span class="d2ext-lib-bc-link" data-bc="macros">${escapeHtml(title)}</span>`);
  }

  if (libraryView === 'blocks') {
    parts.push('<span class="d2ext-lib-bc-sep">&rsaquo;</span>');
    parts.push(`<span class="d2ext-lib-bc-current">Macro #${currentLibMacroIdx + 1}</span>`);
  }

  el.innerHTML = parts.join('');

  // Wire breadcrumb clicks
  el.querySelectorAll('[data-bc]').forEach((link) => {
    link.addEventListener('click', () => {
      const target = link.getAttribute('data-bc');
      closeLibViewer();
      if (target === 'sources') {
        libraryView = 'sources';
        renderLibraryBreadcrumb();
        renderLibrarySources();
      } else if (target === 'macros' && currentLibSource) {
        libraryView = 'macros';
        renderLibraryBreadcrumb();
        renderLibraryMacros(currentLibSource);
      }
    });
  });
}

/** Render sources list view */
function renderLibrarySources() {
  const contentEl = q('#d2ext-lib-content');
  if (!contentEl) return;
  libraryView = 'sources';

  if (librarySources.length === 0) {
    contentEl.innerHTML = `
      <div class="d2ext-lib-empty">No reference sources configured.<br>Add a source below.</div>
      <div class="d2ext-lib-add-btn-wrap">
        <button class="d2ext-btn d2ext-btn-sm d2ext-btn-primary" id="d2ext-lib-add-src">+ Add Source</button>
      </div>`;
    q('#d2ext-lib-add-src')?.addEventListener('click', () => showAddSourceForm());
    return;
  }

  contentEl.innerHTML = librarySources.map((s, i) => `
    <div class="d2ext-lib-source-card" data-src-idx="${i}">
      <div class="d2ext-lib-source-info">
        <span class="d2ext-lib-source-space">${escapeHtml(s.spaceKey)}</span>
        <span class="d2ext-lib-source-title">${escapeHtml(s.pageTitle)}</span>
      </div>
      <div class="d2ext-lib-source-actions">
        <button class="d2ext-btn d2ext-btn-sm" data-src-refresh="${i}" title="Refresh">${ICONS.refreshCw}</button>
        <button class="d2ext-btn d2ext-btn-sm" data-src-remove="${i}" title="Remove">${ICONS.x}</button>
      </div>
    </div>
  `).join('') + `
    <div class="d2ext-lib-add-btn-wrap">
      <button class="d2ext-btn d2ext-btn-sm d2ext-btn-primary" id="d2ext-lib-add-src">+ Add Source</button>
    </div>`;

  // Wire source card clicks (navigate to macros)
  contentEl.querySelectorAll('.d2ext-lib-source-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-src-refresh], [data-src-remove]')) return;
      const idx = parseInt(card.getAttribute('data-src-idx')!, 10);
      currentLibSource = librarySources[idx];
      libraryView = 'macros';
      renderLibraryBreadcrumb();
      renderLibraryMacros(currentLibSource);
    });
  });

  // Wire refresh buttons
  contentEl.querySelectorAll('[data-src-refresh]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-src-refresh')!, 10);
      refreshSource(librarySources[idx]);
    });
  });

  // Wire remove buttons
  contentEl.querySelectorAll('[data-src-remove]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-src-remove')!, 10);
      removeReferenceSource(idx);
    });
  });

  // Wire add button
  q('#d2ext-lib-add-src')?.addEventListener('click', () => showAddSourceForm());
}

/** Show inline form to add a new source */
function showAddSourceForm() {
  const contentEl = q('#d2ext-lib-content');
  if (!contentEl) return;

  // Append form at the end
  const form = document.createElement('div');
  form.className = 'd2ext-lib-source-form';
  form.innerHTML = `
    <div class="d2ext-lib-form-section">
      <input type="text" class="d2ext-lib-input" placeholder="Paste Confluence page URL or page ID" id="d2ext-lib-new-url" />
      <div class="d2ext-lib-form-actions">
        <button class="d2ext-btn d2ext-btn-sm d2ext-btn-primary" id="d2ext-lib-fetch-url">Fetch</button>
      </div>
    </div>
    <div class="d2ext-lib-form-divider">or add by space key</div>
    <div class="d2ext-lib-form-section">
      <input type="text" class="d2ext-lib-input" placeholder="Space key (e.g. TEAM)" id="d2ext-lib-new-space" />
      <input type="text" class="d2ext-lib-input" placeholder="Page title" id="d2ext-lib-new-title" />
      <div class="d2ext-lib-form-actions">
        <button class="d2ext-btn d2ext-btn-sm" id="d2ext-lib-cancel-src">Cancel</button>
        <button class="d2ext-btn d2ext-btn-sm d2ext-btn-primary" id="d2ext-lib-save-src">Add</button>
      </div>
    </div>`;
  contentEl.appendChild(form);

  const urlInput = q('#d2ext-lib-new-url') as HTMLInputElement;
  urlInput?.focus();

  // Fetch by URL
  const doFetchUrl = () => {
    const url = (q('#d2ext-lib-new-url') as HTMLInputElement)?.value.trim();
    if (url) fetchByUrl(url);
  };
  q('#d2ext-lib-fetch-url')?.addEventListener('click', doFetchUrl);
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFetchUrl();
  });

  q('#d2ext-lib-cancel-src')?.addEventListener('click', () => renderLibrarySources());
  q('#d2ext-lib-save-src')?.addEventListener('click', () => {
    const space = (q('#d2ext-lib-new-space') as HTMLInputElement)?.value.trim();
    const title = (q('#d2ext-lib-new-title') as HTMLInputElement)?.value.trim();
    if (space && title) addReferenceSource(space, title);
  });
}

/** Add a new reference source */
async function addReferenceSource(spaceKey: string, pageTitle: string) {
  librarySources.push({ spaceKey, pageTitle });
  try {
    await browser.storage.local.set({ [REF_SOURCES_KEY]: librarySources });
  } catch {}
  renderLibrarySources();
  logInfo('editor', `Added reference source: ${spaceKey}/${pageTitle}`);
}

/** Remove a reference source */
async function removeReferenceSource(index: number) {
  const removed = librarySources.splice(index, 1)[0];
  try {
    await browser.storage.local.set({ [REF_SOURCES_KEY]: librarySources });
  } catch {}
  if (removed) libraryMacroData.delete(removed.spaceKey);
  renderLibrarySources();
  updateReferenceCompletions();
  logInfo('editor', `Removed reference source at index ${index}`);
}

/** Refresh a source (force re-fetch) */
async function refreshSource(source: ReferenceSource) {
  libraryMacroData.delete(source.spaceKey);
  if (currentLibSource?.spaceKey === source.spaceKey && libraryView !== 'sources') {
    renderLibraryMacros(source);
  }
  setStatus(`Refreshing ${source.pageTitle}...`);
}

/** Fetch macros from a Confluence page URL and navigate to the macros view */
async function fetchByUrl(url: string) {
  const contentEl = q('#d2ext-lib-content');
  if (!contentEl) return;

  contentEl.innerHTML = `<div class="d2ext-lib-loading">${ICONS.loader} Fetching page...</div>`;

  try {
    // Call directly from content script (same origin as Confluence) so cookies are sent
    const resp = await fetchPageMacrosByUrl(url);

    if (resp.error) {
      contentEl.innerHTML = `<div class="d2ext-lib-empty">${escapeHtml(resp.error)}</div>`;
      return;
    }

    if (resp.macros.length === 0) {
      contentEl.innerHTML = '<div class="d2ext-lib-empty">No D2 macros found on this page.</div>';
      return;
    }

    const pageTitle = resp.pageTitle || 'URL Import';
    const sourceKey = `url:${url}`;

    // Convert to ReferenceMacro format with blocks
    const macros: ReferenceMacro[] = resp.macros.map((m) => {
      const blocks = extractD2Blocks(m.code, d2Parser);
      return {
        index: m.index,
        code: m.code,
        blocks: blocks.map((b, bi) => mapD2BlockToRef(b, bi, pageTitle, sourceKey, m.index)),
      };
    });

    libraryMacroData.set(sourceKey, { macros, pageTitle });
    updateReferenceCompletions();

    // Persist source if not already saved
    if (!librarySources.some((s) => s.spaceKey === sourceKey)) {
      librarySources.push({ spaceKey: sourceKey, pageTitle });
      try {
        await browser.storage.local.set({ [REF_SOURCES_KEY]: librarySources });
      } catch {}
    }

    // Navigate to macros view
    currentLibSource = { spaceKey: sourceKey, pageTitle };
    libraryView = 'macros';
    renderLibraryBreadcrumb();
    renderLibraryMacros(currentLibSource);
    logInfo('editor', `Fetched ${macros.length} macros from URL: ${url}`);
  } catch (e) {
    contentEl.innerHTML = `<div class="d2ext-lib-empty">Failed to fetch: ${escapeHtml((e as Error).message)}</div>`;
  }
}

/** Render macros list for a source */
async function renderLibraryMacros(source: ReferenceSource) {
  const contentEl = q('#d2ext-lib-content');
  if (!contentEl) return;

  // Check cache
  let data = libraryMacroData.get(source.spaceKey);
  if (!data) {
    contentEl.innerHTML = `<div class="d2ext-lib-loading">${ICONS.loader} Loading macros...</div>`;
    try {
      if (source.spaceKey.startsWith('url:')) {
        // URL-based sources: fetch directly from content script (needs cookies)
        const url = source.spaceKey.slice(4);
        const resp = await fetchPageMacrosByUrl(url);
        if (resp.error) throw new Error(resp.error);
        const macros: ReferenceMacro[] = resp.macros.map((m) => {
          const blocks = extractD2Blocks(m.code, d2Parser);
          const pt = resp.pageTitle || source.pageTitle;
          return {
            index: m.index,
            code: m.code,
            blocks: blocks.map((b, bi) => mapD2BlockToRef(b, bi, pt, source.spaceKey, m.index)),
          };
        });
        data = { macros, pageTitle: resp.pageTitle || source.pageTitle };
      } else {
        // Space-based sources: fetch via service worker
        const resp = await browser.runtime.sendMessage({
          type: 'get-reference-macros',
          spaceKey: source.spaceKey,
        });
        data = { macros: resp?.macros ?? [], pageTitle: resp?.pageTitle ?? source.pageTitle };
      }
      libraryMacroData.set(source.spaceKey, data);
      updateReferenceCompletions();
    } catch (e) {
      contentEl.innerHTML = `<div class="d2ext-lib-empty">Failed to load: ${escapeHtml((e as Error).message)}</div>`;
      return;
    }
  }

  if (data.macros.length === 0) {
    contentEl.innerHTML = '<div class="d2ext-lib-empty">No D2 macros found on this page.</div>';
    return;
  }

  contentEl.innerHTML = data.macros.map((m, i) => `
    <div class="d2ext-lib-macro-card" data-macro-idx="${m.index}">
      <div class="d2ext-lib-macro-info">
        <span class="d2ext-lib-macro-name">Macro #${m.index + 1}</span>
        <span class="d2ext-lib-badge">${m.blocks.length} block${m.blocks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="d2ext-lib-macro-actions">
        <button class="d2ext-btn d2ext-btn-sm" data-macro-view="${i}" title="View code">${ICONS.eye}</button>
      </div>
    </div>
  `).join('');

  // Wire macro card clicks (navigate to blocks)
  contentEl.querySelectorAll('.d2ext-lib-macro-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-macro-view]')) return;
      const idx = parseInt(card.getAttribute('data-macro-idx')!, 10);
      currentLibMacroIdx = idx;
      libraryView = 'blocks';
      renderLibraryBreadcrumb();
      renderLibraryBlocks(source, idx);
    });
  });

  // Wire view buttons (read-only editor)
  contentEl.querySelectorAll('[data-macro-view]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(btn.getAttribute('data-macro-view')!, 10);
      openMacroViewer(data!.macros[i].code);
    });
  });

  renderLibraryBreadcrumb();
}

/** Render blocks list for a specific macro */
/** Get or compute block metadata with caching */
function getBlockMetadata(code: string): BlockMetadata {
  let meta = metadataCache.get(code);
  if (!meta) {
    meta = analyzeD2Block(code, d2Parser);
    metadataCache.set(code, meta);
  }
  return meta;
}

function renderLibraryBlocks(source: ReferenceSource, macroIndex: number) {
  const contentEl = q('#d2ext-lib-content');
  if (!contentEl) return;

  const data = libraryMacroData.get(source.spaceKey);
  const macro = data?.macros.find((m) => m.index === macroIndex);
  if (!macro || macro.blocks.length === 0) {
    contentEl.innerHTML = '<div class="d2ext-lib-empty">No blocks in this macro.</div>';
    return;
  }

  // Enrich blocks with metadata (recursively)
  const enriched: EnrichedBlock[] = macro.blocks.map((b) => enrichBlock(b));

  contentEl.innerHTML = enriched.map((b, i) => renderBlockCard(b, i)).join('');

  wireBlockCardEvents(contentEl, enriched);

  // Setup lazy thumbnail observer
  setupThumbnailObserver(enriched);
  renderLibraryBreadcrumb();
}

/** Enrich a ReferenceBlock with metadata, recursively including children */
function enrichBlock(b: ReferenceBlock): EnrichedBlock {
  const enriched: EnrichedBlock = {
    ...b,
    metadata: getBlockMetadata(b.code),
  };
  if (b.children && b.children.length > 0) {
    enriched.children = b.children.map(c => enrichBlock(c));
  }
  return enriched;
}

/** Wire copy, insert, expand, and drag events on block cards */
function wireBlockCardEvents(container: Element, blocks: EnrichedBlock[], depth = 0) {
  container.querySelectorAll('[data-blk-copy]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-blk-copy')!, 10);
      if (blocks[idx]) {
        navigator.clipboard.writeText(blocks[idx].code).catch(() => {});
        setStatus('Copied to clipboard');
        showToast('Copied');
      }
    });
  });

  container.querySelectorAll('[data-blk-insert]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-blk-insert')!, 10);
      if (blocks[idx]) {
        insertAtCursor(blocks[idx].code);
        setStatus(`Inserted "${blocks[idx].name}"`);
        showToast(`Inserted "${blocks[idx].name}"`);
      }
    });
  });

  // Wire expand buttons
  container.querySelectorAll('[data-blk-expand]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-blk-expand')!, 10);
      const block = blocks[idx];
      if (!block?.children || block.children.length === 0) return;

      const childContainer = container.querySelector(`[data-children-of="${idx}"]`) as HTMLElement | null;
      if (!childContainer) return;

      const isExpanded = childContainer.style.display !== 'none';
      if (isExpanded) {
        childContainer.style.display = 'none';
        (btn as HTMLElement).innerHTML = `&#9654; ${block.children.length}`;
      } else {
        childContainer.style.display = '';
        (btn as HTMLElement).innerHTML = `&#9660; ${block.children.length}`;
        // Lazy render children if not yet rendered
        if (!childContainer.hasChildNodes()) {
          const childEnriched = block.children as EnrichedBlock[];
          const childDepth = depth + 1;
          childContainer.innerHTML = childEnriched.map((c, ci) => renderBlockCard(c, ci, childDepth)).join('');
          wireBlockCardEvents(childContainer, childEnriched, childDepth);
          observeChildThumbnails(childContainer, childEnriched);
        }
      }
    });
  });

  // Wire drag events
  setupDragOnCards(container, blocks);
}

/** Setup drag events on draggable block cards within a container */
function setupDragOnCards(container: Element, blocks: EnrichedBlock[]) {
  container.querySelectorAll('.d2ext-lib-block-card[draggable="true"]').forEach((card) => {
    const el = card as HTMLElement;
    // Avoid double-binding
    if (el.dataset.dragBound) return;
    el.dataset.dragBound = '1';

    el.addEventListener('dragstart', (e) => {
      // Stop propagation so parent cards don't override child drag data
      e.stopPropagation();
      const idx = parseInt(el.getAttribute('data-blk-idx') ?? '', 10);
      const block = blocks[idx];
      if (!block || !e.dataTransfer) return;
      e.dataTransfer.setData('application/x-d2ext-block', block.code);
      e.dataTransfer.setData('text/plain', block.code);
      e.dataTransfer.effectAllowed = 'copy';
      el.classList.add('d2ext-dragging');
    });
    el.addEventListener('dragend', (e) => {
      e.stopPropagation();
      el.classList.remove('d2ext-dragging');
    });
  });
}

/** Render a single block card HTML */
function renderBlockCard(block: EnrichedBlock, index: number, depth = 0): string {
  const meta = block.metadata;
  const badges: string[] = [];
  if (meta) {
    if (meta.shapeCount > 0) badges.push(`<span class="d2ext-lib-badge">${meta.shapeCount} shape${meta.shapeCount !== 1 ? 's' : ''}</span>`);
    if (meta.connectionCount > 0) badges.push(`<span class="d2ext-lib-badge">${meta.connectionCount} &rarr;</span>`);
    badges.push(`<span class="d2ext-lib-badge d2ext-lib-badge-cat">${meta.category}</span>`);
    if (meta.nestingDepth > 1) badges.push(`<span class="d2ext-lib-badge">depth ${meta.nestingDepth}</span>`);
    if (meta.hasStyles) badges.push('<span class="d2ext-lib-badge">styled</span>');
    if (meta.hasClasses) badges.push('<span class="d2ext-lib-badge">classes</span>');
  }

  const hasChildren = block.children && block.children.length > 0;
  const expandBtn = hasChildren
    ? `<button class="d2ext-lib-expand-btn" data-blk-expand="${index}" title="Expand children">&#9654; ${block.children!.length}</button>`
    : '';
  const labelHtml = block.label
    ? `<div class="d2ext-lib-block-label">${escapeHtml(block.label)}</div>`
    : '';
  const indent = depth > 0 ? ` style="margin-left:${depth * 16}px"` : '';

  return `
    <div class="d2ext-lib-block-card" data-blk-idx="${index}" draggable="true"${indent}>
      <div class="d2ext-lib-block-top">
        <div class="d2ext-lib-block-thumb" data-thumb-idx="${index}">
          <span class="d2ext-lib-block-thumb-ph">${ICONS.loader}</span>
        </div>
        <div class="d2ext-lib-block-info">
          <div class="d2ext-lib-block-name" title="${escapeHtml(block.name)}">${escapeHtml(block.name)}${expandBtn ? ' ' + expandBtn : ''}</div>
          ${labelHtml}
          <div class="d2ext-lib-block-meta">${badges.join('')}</div>
        </div>
      </div>
      <div class="d2ext-lib-block-actions">
        <button class="d2ext-btn d2ext-btn-sm" data-blk-copy="${index}">Copy</button>
        <button class="d2ext-btn d2ext-btn-sm d2ext-btn-primary" data-blk-insert="${index}">Insert</button>
      </div>
      ${hasChildren ? `<div class="d2ext-lib-children" data-children-of="${index}" style="display:none"></div>` : ''}
    </div>`;
}

/** Map from thumbnail element to its block, used by the IntersectionObserver */
const thumbBlockMap = new WeakMap<Element, EnrichedBlock>();

/** Setup IntersectionObserver for lazy SVG thumbnail rendering */
function setupThumbnailObserver(blocks: EnrichedBlock[]) {
  thumbnailObserver?.disconnect();
  // WeakMap entries for old elements are GC'd automatically

  const root = q('#d2ext-lib-content');
  if (!root) return;

  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as HTMLElement;
      const block = thumbBlockMap.get(el);
      if (!block) continue;
      thumbnailObserver?.unobserve(el);
      renderThumbnail(el, block);
    }
  }, { root, rootMargin: '100px', threshold: 0 });

  root.querySelectorAll('[data-thumb-idx]').forEach((el) => {
    const idx = parseInt(el.getAttribute('data-thumb-idx') ?? '', 10);
    if (!isNaN(idx) && blocks[idx]) {
      thumbBlockMap.set(el, blocks[idx]);
      thumbnailObserver?.observe(el);
    }
  });
}

/** Observe thumbnail elements for a set of child blocks (appends to existing observer) */
function observeChildThumbnails(container: Element, blocks: EnrichedBlock[]) {
  if (!thumbnailObserver) return;
  container.querySelectorAll('[data-thumb-idx]').forEach((el) => {
    const idx = parseInt(el.getAttribute('data-thumb-idx') ?? '', 10);
    if (!isNaN(idx) && blocks[idx]) {
      thumbBlockMap.set(el, blocks[idx]);
      thumbnailObserver?.observe(el);
    }
  });
}

/** DJB2 hash for cache keys */
function hashCode(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  return hash;
}

const SVG_CACHE_KEY = 'd2ext-svg-cache';

/** Render a single SVG thumbnail */
async function renderThumbnail(el: HTMLElement, block: EnrichedBlock) {
  const serverUrl = await resolveServerUrl(userServerUrl, currentMacro?.params.server ?? '');
  if (!serverUrl) {
    el.innerHTML = '<span class="d2ext-lib-block-thumb-ph" style="font-size:9px;color:#aaa">No server</span>';
    return;
  }

  const blockKey = `${block.sourceSpaceKey}:${block.macroIndex}:${block.blockIndex}`;
  const codeHash = hashCode(block.code);

  // Check cache
  try {
    const result = await browser.storage.local.get(SVG_CACHE_KEY);
    const cache = (result[SVG_CACHE_KEY] as Record<string, { svg: string; codeHash: number; cachedAt: number }>) ?? {};
    const cached = cache[blockKey];
    if (cached && cached.codeHash === codeHash && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) {
      el.innerHTML = cached.svg;
      fitThumbSvg(el);
      return;
    }
  } catch {}

  // Render via d2-server
  try {
    const { svg, error } = await renderSvg(serverUrl, block.code, { ...currentMacro!.params, scale: '0.5' });
    if (error || !svg) {
      el.innerHTML = '<span class="d2ext-lib-block-thumb-ph" style="font-size:9px;color:#e57373">Error</span>';
      return;
    }
    el.innerHTML = svg;
    fitThumbSvg(el);

    // Save to cache
    try {
      const result = await browser.storage.local.get(SVG_CACHE_KEY);
      const cache = (result[SVG_CACHE_KEY] as Record<string, { svg: string; codeHash: number; cachedAt: number }>) ?? {};
      // Evict oldest if too many
      const keys = Object.keys(cache);
      if (keys.length > 200) {
        const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
        for (let i = 0; i < 50; i++) delete cache[sorted[i]];
      }
      cache[blockKey] = { svg, codeHash, cachedAt: Date.now() };
      await browser.storage.local.set({ [SVG_CACHE_KEY]: cache });
    } catch {}
  } catch {
    el.innerHTML = '<span class="d2ext-lib-block-thumb-ph" style="font-size:9px;color:#e57373">Error</span>';
  }
}

function fitThumbSvg(el: HTMLElement) {
  const svgEl = el.querySelector('svg');
  if (svgEl) {
    svgEl.style.maxWidth = '100%';
    svgEl.style.maxHeight = '100%';
    svgEl.style.width = 'auto';
    svgEl.style.height = 'auto';
  }
}

/** Search blocks across all loaded sources (recursively including children) */
function renderSearchResults(query: string) {
  const contentEl = q('#d2ext-lib-content');
  if (!contentEl) return;

  const results: EnrichedBlock[] = [];

  function searchBlocks(blocks: ReferenceBlock[]) {
    for (const block of blocks) {
      const meta = getBlockMetadata(block.code);
      const searchable = [
        block.name,
        block.label || '',
        meta.category,
        ...meta.topIdentifiers,
        block.code.substring(0, 300),
      ].join(' ').toLowerCase();
      if (searchable.includes(query)) {
        results.push(enrichBlock(block));
      }
      // Also search children recursively
      if (block.children) searchBlocks(block.children);
    }
  }

  for (const [, data] of libraryMacroData) {
    for (const macro of data.macros) {
      searchBlocks(macro.blocks);
    }
  }

  if (results.length === 0) {
    contentEl.innerHTML = `<div class="d2ext-lib-empty">No blocks matching "${escapeHtml(query)}"</div>`;
    return;
  }

  contentEl.innerHTML = results.map((b, i) => renderBlockCard(b, i)).join('');

  wireBlockCardEvents(contentEl, results);
  setupThumbnailObserver(results);
}

/** Open read-only CodeMirror viewer for a macro */
async function openMacroViewer(code: string) {
  const viewerEl = q('#d2ext-lib-viewer');
  if (!viewerEl) return;

  closeLibViewer();
  viewerEl.style.display = '';

  try {
    libViewerView = await createEditor(viewerEl, code, { readOnly: true });
  } catch (e) {
    viewerEl.innerHTML = `<pre style="padding:8px;font-size:11px;overflow:auto">${escapeHtml(code)}</pre>`;
  }
}

/** Close the read-only viewer */
function closeLibViewer() {
  libViewerView?.destroy();
  libViewerView = null;
  const viewerEl = q('#d2ext-lib-viewer');
  if (viewerEl) {
    viewerEl.style.display = 'none';
    viewerEl.innerHTML = '';
  }
}

/** Update autocomplete with all loaded reference blocks */
function updateReferenceCompletions() {
  const allBlocks: Array<{ name: string; code: string }> = [];
  for (const [, data] of libraryMacroData) {
    for (const macro of data.macros) {
      for (const block of macro.blocks) {
        allBlocks.push({ name: block.name, code: block.code });
      }
    }
  }
  setReferenceCompletions(allBlocks);
}

/** Insert text at cursor position in editor */
function insertAtCursor(text: string) {
  if (!editorView) return;
  const cursor = editorView.state.selection.main.head;
  const insert = '\n' + text + '\n';
  editorView.dispatch({
    changes: { from: cursor, insert },
    selection: { anchor: cursor + insert.length },
  });
  editorView.focus();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Map a D2Block (from parser) to ReferenceBlock, recursively including children */
function mapD2BlockToRef(
  b: D2Block,
  bi: number,
  pageTitle: string,
  sourceKey: string,
  macroIndex: number,
): ReferenceBlock {
  const ref: ReferenceBlock = {
    name: b.name,
    code: b.code,
    sourcePageTitle: pageTitle,
    sourceSpaceKey: sourceKey,
    blockIndex: bi,
    macroIndex,
  };
  if (b.label) ref.label = b.label;
  if (b.children && b.children.length > 0) {
    ref.children = b.children.map((c, ci) => mapD2BlockToRef(c, ci, pageTitle, sourceKey, macroIndex));
  }
  return ref;
}

// --- Preview zoom/pan state ---
let previewZoom = 1;
let previewPanX = 0;
let previewPanY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

function updatePreviewTransform() {
  const canvas = q('#d2ext-preview-canvas') as HTMLElement | null;
  if (canvas) canvas.style.transform = `translate(${previewPanX}px, ${previewPanY}px) scale(${previewZoom})`;
  const label = q('#d2ext-zoom-label');
  if (label) label.textContent = `${Math.round(previewZoom * 100)}%`;
}

function resetPreviewZoom() {
  previewZoom = 1;
  previewPanX = 0;
  previewPanY = 0;
  updatePreviewTransform();
}

function initPreviewZoomPan() {
  const previewContent = q('#d2ext-preview');
  if (!previewContent) return;

  // Wheel zoom
  previewContent.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    previewZoom = Math.max(0.1, Math.min(5, previewZoom + delta));
    updatePreviewTransform();
  }, { passive: false });

  // Pan via middle mouse or Ctrl+left mouse
  previewContent.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX - previewPanX;
      panStartY = e.clientY - previewPanY;
      previewContent.style.cursor = 'grabbing';
    }
  });

  previewContent.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    previewPanX = e.clientX - panStartX;
    previewPanY = e.clientY - panStartY;
    updatePreviewTransform();
  });

  const stopPan = () => {
    if (isPanning) {
      isPanning = false;
      const pc = q('#d2ext-preview');
      if (pc) pc.style.cursor = '';
    }
  };
  previewContent.addEventListener('mouseup', stopPan);
  previewContent.addEventListener('mouseleave', stopPan);
}

/** Render preview via d2server with fallback */
let previewInFlight = false;
async function doPreview() {
  logInfo('preview', `doPreview: view=${!!editorView} macro=${!!currentMacro} inFlight=${previewInFlight}`);
  if (!editorView || !currentMacro) return;
  if (previewInFlight) return; // Skip if previous request still running
  previewInFlight = true;

  const code = getEditorCode();
  const macroServerUrl = currentMacro.params.server;

  const canvasEl = q('#d2ext-preview-canvas');
  if (!canvasEl) { previewInFlight = false; return; }

  if (!userServerUrl && !macroServerUrl) {
    canvasEl.innerHTML = '<div class="d2ext-preview-empty">No D2 server URL detected.<br>Check macro configuration or set a custom server in settings.</div>';
    setStatus('Preview: no server URL');
    logWarn('preview', 'No D2 server URL detected');
    previewInFlight = false;
    return;
  }

  // Show loading spinner
  canvasEl.innerHTML = `<div class="d2ext-preview-loading">${ICONS.loader} Rendering...</div>`;
  setStatus('Rendering...');
  hideError();

  try {
    const { svg, error, usedServer } = await renderSvgWithFallback(userServerUrl, macroServerUrl, code, currentMacro!.params);

    if (error) {
      showError(error);
      canvasEl.innerHTML = `<div class="d2ext-preview-empty">Render error. See error bar below.</div>`;
      setStatus('Preview error');
      logError('preview', 'Render failed', { error });
    } else if (svg) {
      canvasEl.innerHTML = svg;
      const svgEl = canvasEl.querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
      }
      const isUser = usedServer === userServerUrl && userServerUrl !== '';
      setStatus(`Preview updated (${isUser ? 'user' : 'macro'} server)`);
    } else {
      canvasEl.innerHTML = '<div class="d2ext-preview-empty">Empty response from server.</div>';
      setStatus('Preview: empty response');
      logWarn('preview', 'Empty SVG response from server');
    }
  } catch (e) {
    const msg = (e as Error).message;
    showError(`Preview failed: ${msg}`);
    canvasEl.innerHTML = `<div class="d2ext-preview-empty">Preview failed: ${escapeHtml(msg)}</div>`;
    setStatus('Preview error');
    logError('preview', `Preview exception: ${msg}`);
  } finally {
    previewInFlight = false;
  }
}

/** Format code via d2server (with user server fallback) */
async function doFormat() {
  if (!editorView || !currentMacro) return;

  const code = getEditorCode();
  const serverUrl = await resolveServerUrl(userServerUrl, currentMacro.params.server);
  if (!serverUrl) {
    showError('No D2 server URL detected.');
    setStatus('Format error: no server');
    logWarn('editor', 'Format: no D2 server URL');
    return;
  }

  setStatus('Formatting...');
  logInfo('editor', `Format request to ${serverUrl}/format`);
  const { formatted, error } = await logTimed('editor', 'Format D2 code', () =>
    formatD2(serverUrl, code)
  );

  if (error) {
    showError(error);
    setStatus('Format error');
    logError('editor', 'Format failed', { error });
  } else if (formatted) {
    setEditorCode(formatted);
    hideError();
    setStatus('Formatted');
  }
}

/** Check if macro params have changed from original */
function paramsChanged(): boolean {
  if (!currentMacro) return false;
  return (Object.keys(currentMacro.params) as (keyof MacroParams)[]).some(
    (k) => currentMacro!.params[k] !== originalParams[k]
  );
}

/** Save the edited code back to Confluence */
async function doSave(pageMeta: PageMeta) {
  logInfo('save', `doSave: view=${!!editorView} macro=${!!currentMacro} macroId=${currentMacro?.macroId ?? 'N/A'}`);
  if (!editorView || !currentMacro) return;

  const newCode = getEditorCode();
  const hasParamChanges = paramsChanged();
  if (newCode === originalCode && !hasParamChanges) {
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

    // Update data-macro-parameters if params changed
    if (paramsChanged()) {
      const paramStr = (Object.keys(currentMacro.params) as (keyof MacroParams)[])
        .filter((k) => currentMacro!.params[k] !== '')
        .map((k) => `${k}=${currentMacro!.params[k]}`)
        .join('|');
      element.setAttribute('data-macro-parameters', paramStr);
      originalParams = { ...currentMacro.params };
      logInfo('save', 'Updated data-macro-parameters on TinyMCE element');
    }

    const event = new Event('input', { bubbles: true });
    pre.dispatchEvent(event);
    originalCode = newCode;
    updateMacroCode(newCode);
    if (currentMacro?.macroId) clearDraft(currentMacro.macroId);
    setStatus('Saved to editor. Click Publish to persist.');
    showToast('Saved to editor');
    logInfo('save', 'Saved to TinyMCE editor (edit mode)');
  } else {
    setStatus('Error: could not find macro body');
    showToast('Save failed: macro body not found', 'error');
    logError('save', 'Could not find macro body element');
  }
}

/** Save in view mode via Confluence REST API */
async function saveViewMode(pageMeta: PageMeta, newCode: string) {
  if (!currentMacro) return;

  try {
    const { storageValue, version, title } = await logTimed('save', 'Fetch page storage for save', () =>
      fetchPageStorage(pageMeta.pageId)
    );
    const storageMacros = parseStorageMacros(storageValue);
    const targetMacro = storageMacros.find((m) => m.macroId === currentMacro!.macroId);

    if (!targetMacro) {
      setStatus('Error: macro not found in page storage');
      logError('save', 'Macro not found in page storage', { macroId: currentMacro!.macroId });
      return;
    }

    if (targetMacro.code.trim() !== originalCode.trim()) {
      setStatus('Warning: page was modified externally. Please refresh and try again.');
      logWarn('save', 'Page modified externally — conflict detected');
      return;
    }

    let newStorage = replaceStorageMacroCode(storageValue, currentMacro.macroId, newCode);

    // Also update params in storage if changed
    if (paramsChanged()) {
      newStorage = replaceStorageMacroParams(newStorage, currentMacro.macroId, { ...currentMacro.params });
      logInfo('save', 'Params updated in storage XML');
    }

    const result = await logTimed('save', 'Save page via REST API', () =>
      savePage(pageMeta.pageId, title, version, newStorage)
    );

    if (result.success) {
      originalCode = newCode;
      if (currentMacro) originalParams = { ...currentMacro.params };
      updateMacroCode(newCode);
      if (currentMacro?.macroId) clearDraft(currentMacro.macroId);
      setStatus(`Saved! Version ${result.newVersion}`);
      showToast(`Saved! Version ${result.newVersion}`);
      logInfo('save', `Saved successfully`, { version: result.newVersion });
      refreshDiagramOnPage(newCode);
    } else {
      setStatus(`Save failed: ${result.error}`);
      showToast(`Save failed: ${result.error}`, 'error');
      logError('save', `Save failed: ${result.error}`);
    }
  } catch (e) {
    setStatus(`Save error: ${(e as Error).message}`);
    showToast(`Save error: ${(e as Error).message}`, 'error');
    logError('save', `Save error: ${(e as Error).message}`);
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
    // textContent automatically escapes HTML — no manual entity encoding needed
    codeDiv.textContent = newCode;
  }

  const diagramDiv = element.querySelector('.d2-diagram');
  if (diagramDiv) {
    resolveServerUrl(userServerUrl, currentMacro.params.server).then((srv) => {
      if (!srv) return;
      return renderSvg(srv, newCode, currentMacro!.params);
    }).then((result) => {
      const svg = result?.svg;
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

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(text: string, type: 'success' | 'error' = 'success') {
  let toast = q('#d2ext-toast');
  if (!toast && shadow) {
    toast = document.createElement('div');
    toast.id = 'd2ext-toast';
    toast.className = 'd2ext-toast';
    shadow.querySelector('.d2ext-modal')?.appendChild(toast);
  }
  if (!toast) return;
  toast.textContent = text;
  toast.className = `d2ext-toast d2ext-toast-${type} d2ext-toast-show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast!.className = 'd2ext-toast';
  }, 3000);
}

// --- Export ---

function toggleExportDropdown() {
  const dropdown = q('#d2ext-export-dropdown');
  if (!dropdown) return;
  dropdown.style.display = dropdown.style.display === 'none' ? '' : 'none';
}

function hideExportDropdown() {
  const dropdown = q('#d2ext-export-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}

async function exportAsSvg() {
  if (!editorView || !currentMacro) return;

  let svgContent: string | undefined;
  const previewSvg = q('#d2ext-preview-canvas svg');
  if (previewSvg) {
    svgContent = previewSvg.outerHTML;
  } else {
    setStatus('Rendering for export...');
    const macroServerUrl = currentMacro.params.server;
    const result = await renderSvgWithFallback(userServerUrl, macroServerUrl, getEditorCode(), currentMacro.params);
    if (result.error || !result.svg) {
      showError(result.error || 'Empty SVG');
      setStatus('Export failed');
      return;
    }
    svgContent = result.svg;
  }

  downloadFile(svgContent, 'diagram.svg', 'image/svg+xml');
  setStatus('Exported as SVG');
  showToast('Exported SVG');
}

async function exportAsPng() {
  if (!editorView || !currentMacro) return;

  const macroServerUrl = currentMacro.params.server;
  const serverUrl = await resolveServerUrl(userServerUrl, macroServerUrl);
  if (!serverUrl) {
    showError('No server URL configured');
    setStatus('Export failed: no server');
    return;
  }

  setStatus('Rendering PNG...');
  const code = getEditorCode();
  const result = await renderPng(serverUrl, code, currentMacro.params);
  if (result.error || !result.png) {
    showError(result.error || 'Empty PNG');
    setStatus('Export failed');
    return;
  }

  downloadBlob(result.png, 'diagram.png');
  setStatus('Exported as PNG');
  showToast('Exported PNG');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
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

// --- Listen for settings changes (e.g. user changes server URL in options page while editor is open) ---
browser.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['d2ext-settings']) {
    const newVal = changes['d2ext-settings'].newValue as Record<string, unknown> | undefined;
    if (newVal && typeof newVal === 'object') {
      userServerUrl = (newVal.serverUrl as string) || '';
      // Update footer display
      const urlEl = q('#d2ext-server-url');
      if (urlEl && currentMacro) {
        urlEl.textContent = userServerUrl
          ? `user: ${userServerUrl}`
          : (currentMacro.params.server ? `macro: ${currentMacro.params.server}` : 'no server');
      }
      // Re-check connection
      if (currentMacro) checkServerConnection(currentMacro.params.server);
      // Re-render preview if enabled
      if (previewEnabled) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => doPreview(), 500);
      }
    }
  }
});

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
    font-family: 'Agave', monospace;
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
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    flex-shrink: 1;
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

  .d2ext-modal-params {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .d2ext-modal-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-shrink: 0;
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

  .d2ext-preview-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid #e0e0e0;
    background: #f8f9fa;
    flex-shrink: 0;
  }

  .d2ext-preview-zoom-label {
    font-size: 11px;
    color: #888;
    margin-left: 4px;
    min-width: 36px;
  }

  .d2ext-preview-content {
    flex: 1;
    overflow: hidden;
    padding: 0;
    position: relative;
  }

  .d2ext-preview-canvas {
    transform-origin: 0 0;
    padding: 16px;
    display: inline-block;
    min-width: 100%;
    min-height: 100%;
  }

  .d2ext-preview-canvas svg {
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

  .d2ext-preview-empty {
    color: #888;
    font-size: 13px;
    text-align: center;
    padding: 40px 20px;
    line-height: 1.6;
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

  .d2ext-server-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .d2ext-server-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #94a3b8;
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

  /* Reference library panel */
  .d2ext-library-pane {
    width: 340px;
    min-width: 300px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #e0e0e0;
    background: #fafafa;
  }

  .d2ext-btn-sm {
    padding: 4px 8px;
    font-size: 11px;
  }

  /* Breadcrumb */
  .d2ext-lib-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 11px;
    color: #666;
    flex-shrink: 0;
    background: #f8f9fa;
  }
  .d2ext-lib-bc-link {
    cursor: pointer;
    color: #4a90d9;
  }
  .d2ext-lib-bc-link:hover {
    text-decoration: underline;
  }
  .d2ext-lib-bc-sep {
    color: #ccc;
  }
  .d2ext-lib-bc-current {
    color: #333;
    font-weight: 600;
  }

  /* Search */
  .d2ext-lib-search-bar {
    padding: 6px 8px;
    border-bottom: 1px solid #e0e0e0;
    flex-shrink: 0;
  }
  .d2ext-lib-search {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .d2ext-lib-search:focus {
    border-color: #4a90d9;
  }

  /* Content */
  .d2ext-lib-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .d2ext-lib-empty {
    text-align: center;
    color: #888;
    font-size: 12px;
    padding: 24px 12px;
    line-height: 1.6;
  }
  .d2ext-lib-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #888;
    font-size: 12px;
    padding: 24px 12px;
  }
  .d2ext-lib-loading svg {
    animation: d2ext-spin 1s linear infinite;
  }

  /* Source cards */
  .d2ext-lib-source-card {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 6px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: border-color 0.15s;
  }
  .d2ext-lib-source-card:hover {
    border-color: #4a90d9;
    background: #f8faff;
  }
  .d2ext-lib-source-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .d2ext-lib-source-space {
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }
  .d2ext-lib-source-title {
    font-size: 12px;
    font-weight: 600;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d2ext-lib-source-actions {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  /* Add source form */
  .d2ext-lib-add-btn-wrap {
    padding: 4px 0;
    text-align: center;
  }
  .d2ext-lib-source-form {
    background: #f5f5f5;
    border: 1px dashed #ccc;
    border-radius: 4px;
    padding: 8px;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .d2ext-lib-input {
    padding: 5px 8px;
    border: 1px solid #d0d0d0;
    border-radius: 3px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  .d2ext-lib-input:focus {
    border-color: #4a90d9;
  }
  .d2ext-lib-form-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  .d2ext-lib-form-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .d2ext-lib-form-divider {
    text-align: center;
    font-size: 11px;
    color: #888;
    padding: 2px 0;
    border-top: 1px solid #ddd;
    margin-top: 2px;
  }

  /* Macro cards */
  .d2ext-lib-macro-card {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 6px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: border-color 0.15s;
  }
  .d2ext-lib-macro-card:hover {
    border-color: #4a90d9;
    background: #f8faff;
  }
  .d2ext-lib-macro-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .d2ext-lib-macro-name {
    font-size: 12px;
    font-weight: 600;
    color: #333;
  }
  .d2ext-lib-macro-actions {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  /* Block cards */
  .d2ext-lib-block-card {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 6px;
    cursor: grab;
  }
  .d2ext-lib-block-card:hover {
    border-color: #4a90d9;
  }
  .d2ext-lib-block-card.d2ext-dragging {
    opacity: 0.5;
  }
  .d2ext-lib-block-label {
    font-size: 11px;
    color: #888;
    font-style: italic;
    margin-bottom: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d2ext-lib-expand-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: none;
    border: 1px solid #d0d0d0;
    border-radius: 3px;
    padding: 0 4px;
    font-size: 9px;
    color: #666;
    cursor: pointer;
    vertical-align: middle;
    line-height: 16px;
  }
  .d2ext-lib-expand-btn:hover {
    background: #eee;
    border-color: #4a90d9;
    color: #4a90d9;
  }
  .d2ext-lib-children {
    margin-top: 6px;
    padding-left: 4px;
    border-left: 2px solid #e0e0e0;
  }
  .d2ext-lib-block-top {
    display: flex;
    gap: 8px;
  }
  .d2ext-lib-block-thumb {
    width: 80px;
    height: 60px;
    flex-shrink: 0;
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .d2ext-lib-block-thumb svg {
    max-width: 100%;
    max-height: 100%;
  }
  .d2ext-lib-block-thumb-ph {
    color: #ccc;
    font-size: 10px;
  }
  .d2ext-lib-block-thumb-ph svg {
    animation: d2ext-spin 1s linear infinite;
  }
  .d2ext-lib-block-info {
    flex: 1;
    min-width: 0;
  }
  .d2ext-lib-block-name {
    font-weight: 600;
    font-size: 12px;
    color: #333;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d2ext-lib-block-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .d2ext-lib-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
    background: #e8eef5;
    color: #4a6785;
  }
  .d2ext-lib-badge-cat {
    background: #e8f5e9;
    color: #2e7d32;
  }
  .d2ext-lib-block-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    margin-top: 6px;
  }

  /* Read-only viewer */
  .d2ext-lib-viewer {
    border-top: 1px solid #e0e0e0;
    height: 200px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .d2ext-lib-viewer .cm-editor {
    height: 100%;
  }

  /* Macro options panel */
  .d2ext-options-pane {
    width: 240px;
    min-width: 220px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #e0e0e0;
    background: #fafafa;
    overflow-y: auto;
  }

  .d2ext-options-title {
    padding: 10px 12px;
    font-weight: 600;
    font-size: 12px;
    color: #333;
    border-bottom: 1px solid #e0e0e0;
    flex-shrink: 0;
  }

  .d2ext-options-form {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .d2ext-opt-label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    font-weight: 500;
    color: #555;
  }

  .d2ext-opt-input {
    padding: 4px 6px;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    background: #fff;
    outline: none;
  }

  .d2ext-opt-input:focus {
    border-color: #4a90d9;
  }

  /* Toast notification */
  .d2ext-toast {
    position: absolute;
    top: 56px;
    right: 16px;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    pointer-events: none;
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.25s, transform 0.25s;
    z-index: 10;
  }
  .d2ext-toast-show {
    opacity: 1;
    transform: translateY(0);
  }
  .d2ext-toast-success {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }
  .d2ext-toast-error {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  /* Export dropdown */
  .d2ext-export-wrap {
    position: relative;
    display: inline-flex;
  }
  .d2ext-export-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: #fff;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    z-index: 100;
    min-width: 140px;
    overflow: hidden;
  }
  .d2ext-export-option {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    text-align: left;
    font-size: 12px;
    font-family: inherit;
    color: #333;
    cursor: pointer;
  }
  .d2ext-export-option:hover {
    background: #f0f4ff;
    color: #4a90d9;
  }

  @media (max-width: 900px) {
    .d2ext-btn-label {
      display: none;
    }
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

import type { MacroInfo, MacroParams, PageMeta } from '../shared/types';
import { DEFAULT_PARAMS } from '../shared/types';
import { readPageMeta, fetchPageStorage, parseStorageMacros } from '../shared/confluence-api';
import { extractServerUrl } from '../shared/d2-server';

/** Detected macros on the current page */
let detectedMacros: MacroInfo[] = [];
let pageMeta: PageMeta | null = null;

/** Get detected macros (used by other content scripts) */
export function getMacros(): MacroInfo[] {
  return detectedMacros;
}

export function getPageMeta(): PageMeta | null {
  return pageMeta;
}

/** Detect D2 macros in view mode */
function detectViewModeMacros(): Array<{ element: Element; code: string; params: MacroParams }> {
  const macros: Array<{ element: Element; code: string; params: MacroParams }> = [];
  const elements = document.querySelectorAll('div.d2-macro');

  elements.forEach((el) => {
    const codeDiv = el.querySelector('.d2-code');
    if (!codeDiv) return;

    // Decode HTML entities in the code
    const code = (codeDiv.textContent ?? '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');

    const serverUrl = extractServerUrl(el);

    // Extract params from the status div
    const params: MacroParams = { ...DEFAULT_PARAMS, server: serverUrl };
    const statusDiv = el.querySelector('.d2-status');
    if (statusDiv) {
      const text = statusDiv.textContent ?? '';
      const extract = (key: string) => {
        const m = text.match(new RegExp(`${key}:\\s*([^|]+)`));
        return m ? m[1].trim() : '';
      };
      params.theme = extract('Theme') || params.theme;
      params.layout = extract('Layout') || params.layout;
      params.direction = extract('Direction') || params.direction;
      params.sketch = extract('Sketch') || params.sketch;
      params.scale = extract('Scale') || params.scale;
    }

    macros.push({ element: el, code, params });
  });

  return macros;
}

/** Detect D2 macros in edit mode (TinyMCE) */
function detectEditModeMacros(): Array<{ element: Element; code: string; params: MacroParams }> {
  const macros: Array<{ element: Element; code: string; params: MacroParams }> = [];
  const tables = document.querySelectorAll('table.wysiwyg-macro[data-macro-name="d2"]');

  tables.forEach((table) => {
    const pre = table.querySelector('td.wysiwyg-macro-body pre');
    if (!pre) return;

    const code = (pre.textContent ?? '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');

    const paramsStr = table.getAttribute('data-macro-parameters') ?? '';
    const params: MacroParams = { ...DEFAULT_PARAMS };

    // Parse macro-parameters string (key=value|key=value)
    paramsStr.split('|').forEach((pair) => {
      const [key, val] = pair.split('=');
      if (key && val && key in params) {
        (params as unknown as Record<string, string>)[key] = val;
      }
    });

    macros.push({ element: table, code, params });
  });

  return macros;
}

/** Main detection flow */
async function detect() {
  pageMeta = readPageMeta();
  if (!pageMeta) return; // Not a Confluence page

  // Detect macros from DOM
  const viewMacros = detectViewModeMacros();
  const editMacros = detectEditModeMacros();

  const domMacros = viewMacros.length > 0 ? viewMacros : editMacros;
  const mode = viewMacros.length > 0 ? 'view' : 'edit';

  if (domMacros.length === 0) return;

  // Fetch storage format to get persistent macro-ids
  let storageMacros: Array<{ macroId: string; code: string }> = [];
  try {
    const { storageValue } = await fetchPageStorage(pageMeta.pageId);
    storageMacros = parseStorageMacros(storageValue);
  } catch (e) {
    console.warn('[d2ext] Failed to fetch storage format:', e);
  }

  // Map DOM macros → storage macros by position to get macro-ids
  detectedMacros = domMacros.map((dm, index) => {
    const storageMacro = storageMacros[index];
    return {
      domIndex: index,
      macroId: storageMacro?.macroId ?? `unknown-${index}`,
      code: dm.code,
      params: dm.params,
      mode: mode as 'view' | 'edit',
    };
  });

  // Store element references for overlay buttons (on window for access by other scripts)
  (window as any).__d2ext = {
    macros: detectedMacros,
    elements: domMacros.map((m) => m.element),
    pageMeta,
  };

  // Notify service worker
  try {
    chrome.runtime?.sendMessage?.({
      type: 'macros-detected',
      macros: detectedMacros,
      pageMeta,
    });
  } catch {}

  console.log(`[d2ext] Detected ${detectedMacros.length} D2 macros (${mode} mode)`);
}

// Run detection when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detect);
} else {
  detect();
}

// Re-detect on major DOM changes (for dynamically loaded content)
const observer = new MutationObserver((mutations) => {
  const hasNewMacros = mutations.some((m) =>
    Array.from(m.addedNodes).some(
      (n) =>
        n instanceof Element &&
        (n.classList?.contains('d2-macro') ||
          n.querySelector?.('.d2-macro') ||
          (n as HTMLElement).dataset?.macroName === 'd2')
    )
  );
  if (hasNewMacros) {
    detect();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

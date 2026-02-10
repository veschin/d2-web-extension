/**
 * CodeMirror 6 editor setup for D2 editing.
 * Replaces the previous Monaco CDN-based setup.
 */

import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { lintGutter } from '@codemirror/lint';
import { d2Extensions, initD2Parser } from './d2-language';
import { d2Linter } from './d2-linter';
import type { Parser } from 'web-tree-sitter';

const fontSizeCompartment = new Compartment();

export interface EditorCallbacks {
  onSave?: () => void;
  onFormat?: () => void;
  onChange?: (code: string) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  getServerUrl?: () => string;
  readOnly?: boolean;
}

/**
 * Create a CodeMirror editor instance in the given container.
 * Attempts to load tree-sitter for AST-aware highlighting;
 * falls back to regex-based highlighting if WASM unavailable.
 */
export async function createEditor(
  container: HTMLElement,
  initialValue: string,
  callbacks: EditorCallbacks = {}
): Promise<EditorView> {
  let parser: Parser | undefined;
  try {
    parser = await initD2Parser();
  } catch {
    // Tree-sitter WASM unavailable — use fallback
  }

  const d2Exts = d2Extensions(parser);

  const lintExts = !callbacks.readOnly && callbacks.getServerUrl
    ? [d2Linter({ getServerUrl: callbacks.getServerUrl }), lintGutter()]
    : [];

  // Firefox content scripts can't access adoptedStyleSheets through Xray wrappers.
  // Hide it on our shadow root so style-mod (CodeMirror dep) falls back to <style> tags.
  const root = container.getRootNode() as ShadowRoot | Document;
  if (root !== document) {
    Object.defineProperty(root, 'adoptedStyleSheets', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  }

  const keymapExt = callbacks.readOnly ? [] : [keymap.of([
    {
      key: 'Mod-s',
      run: () => { callbacks.onSave?.(); return true; },
    },
    {
      key: 'Mod-Shift-f',
      run: () => { callbacks.onFormat?.(); return true; },
    },
    {
      key: 'Mod-=',
      run: () => { callbacks.onZoomIn?.(); return true; },
    },
    {
      key: 'Mod--',
      run: () => { callbacks.onZoomOut?.(); return true; },
    },
  ])];

  const readOnlyExt = callbacks.readOnly ? [EditorState.readOnly.of(true)] : [];

  const dropHandlerExt = callbacks.readOnly ? [] : [EditorView.domEventHandlers({
    drop(event, view) {
      const code = event.dataTransfer?.getData('application/x-d2ext-block');
      if (!code) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      view.dispatch({ changes: { from: pos, insert: '\n' + code + '\n' } });
      view.focus();
      return true;
    },
    dragover(event) {
      if (event.dataTransfer?.types.includes('application/x-d2ext-block')) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  })];

  const view = new EditorView({
    parent: container,
    root,
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        ...d2Exts,
        ...lintExts,
        ...keymapExt,
        ...readOnlyExt,
        ...dropHandlerExt,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callbacks.onChange?.(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': {
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Fira Code', monospace",
          },
        }),
        fontSizeCompartment.of(EditorView.theme({
          '.cm-content': { fontSize: '13px' },
        })),
      ],
    }),
  });

  return view;
}

/** Update editor font size at runtime using a CM Compartment (survives re-renders) */
export function setFontSize(view: EditorView, size: number) {
  view.dispatch({
    effects: fontSizeCompartment.reconfigure(
      EditorView.theme({ '.cm-content': { fontSize: `${size}px` } })
    ),
  });
}

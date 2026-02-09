/**
 * CodeMirror 6 editor setup for D2 editing.
 * Replaces the previous Monaco CDN-based setup.
 */

import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { lintGutter } from '@codemirror/lint';
import { d2Extensions, initD2Parser } from './d2-language';
import { d2Linter } from './d2-linter';
import type { Parser } from 'web-tree-sitter';

export interface EditorCallbacks {
  onSave?: () => void;
  onFormat?: () => void;
  onChange?: (code: string) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  getServerUrl?: () => string;
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

  const lintExts = callbacks.getServerUrl
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

  const view = new EditorView({
    parent: container,
    root,
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        ...d2Exts,
        ...lintExts,
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              callbacks.onSave?.();
              return true;
            },
          },
          {
            key: 'Mod-Shift-f',
            run: () => {
              callbacks.onFormat?.();
              return true;
            },
          },
          {
            key: 'Mod-=',
            run: () => {
              callbacks.onZoomIn?.();
              return true;
            },
          },
          {
            key: 'Mod--',
            run: () => {
              callbacks.onZoomOut?.();
              return true;
            },
          },
        ]),
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
            fontSize: '13px',
          },
        }),
      ],
    }),
  });

  return view;
}

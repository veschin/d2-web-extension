/**
 * D2 language support for CodeMirror 6, backed by tree-sitter.
 *
 * Uses web-tree-sitter to parse D2 code with the ravsii/tree-sitter-d2 grammar
 * and maps AST node types to CodeMirror highlight decorations.
 */

import { EditorView, Decoration, ViewPlugin, ViewUpdate, DecorationSet } from '@codemirror/view';
import { StreamLanguage, StringStream, indentUnit, indentOnInput, indentService } from '@codemirror/language';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import type { Parser, Node as TSNode } from 'web-tree-sitter';

export const D2_LANGUAGE_ID = 'd2';

// --- Tree-sitter node type → CSS class mapping ---

const NODE_CLASS: Record<string, string> = {
  comment: 'cmt',
  block_comment: 'cmt',
  connection: 'kw',
  identifier: 'var',
  identifier_chain: 'var',
  label: 'str',
  boolean: 'bool',
  integer: 'num',
  float: 'num',
  escape: 'esc',
  import: 'kw',
  variable: 'var',
  spread_variable: 'var',
  glob: 'op',
  global_glob: 'op',
  recursive_glob: 'op',
  visibility_mark: 'kw',
  codeblock_language: 'kw',
  codeblock_content: 'str',
  argument_name: 'prop',
  argument_type: 'typ',
};

// Theme for the highlight classes
export const d2HighlightTheme = EditorView.baseTheme({
  '.d2-cmt': { color: '#6a737d' },
  '.d2-kw': { color: '#d73a49' },
  '.d2-var': { color: '#24292e' },
  '.d2-str': { color: '#032f62' },
  '.d2-num': { color: '#005cc5' },
  '.d2-bool': { color: '#005cc5' },
  '.d2-esc': { color: '#22863a' },
  '.d2-op': { color: '#e36209' },
  '.d2-prop': { color: '#6f42c1' },
  '.d2-typ': { color: '#6f42c1' },
  '.d2-brk': { color: '#24292e' },
  '.d2-punc': { color: '#24292e' },
});

// Pre-build Decoration marks for each class
const MARKS: Record<string, Decoration> = {};
for (const cls of new Set(Object.values(NODE_CLASS))) {
  MARKS[cls] = Decoration.mark({ class: `d2-${cls}` });
}
MARKS['brk'] = Decoration.mark({ class: 'd2-brk' });
MARKS['punc'] = Decoration.mark({ class: 'd2-punc' });

// Unnamed token → class mapping
const UNNAMED_CLASS: Record<string, string> = {
  '{': 'brk', '}': 'brk', '[': 'brk', ']': 'brk',
  ':': 'punc', ';': 'punc', ',': 'punc',
  'true': 'bool', 'false': 'bool',
};

// --- Parser singleton ---

let parserInstance: Parser | null = null;
let parserPromise: Promise<Parser> | null = null;

/**
 * Initialize the tree-sitter parser. Safe to call multiple times —
 * returns the cached instance after first init.
 */
export async function initD2Parser(): Promise<Parser> {
  if (parserInstance) return parserInstance;
  if (parserPromise) return parserPromise;

  parserPromise = (async () => {
    const { Parser: ParserClass, Language } = await import('web-tree-sitter');
    await ParserClass.init({
      locateFile: (file: string) => {
        // In extension context, resolve via browser.runtime.getURL
        if (typeof browser !== 'undefined' && browser.runtime?.getURL) {
          return browser.runtime.getURL(`assets/${file}`);
        }
        // Fallback for dev/test
        return `assets/${file}`;
      },
    });
    const parser = new ParserClass();
    const langUrl = typeof browser !== 'undefined' && browser.runtime?.getURL
      ? browser.runtime.getURL('assets/tree-sitter-d2.wasm')
      : 'assets/tree-sitter-d2.wasm';
    const lang = await Language.load(langUrl);
    parser.setLanguage(lang);
    parserInstance = parser;
    return parser;
  })();

  return parserPromise;
}

// --- CodeMirror ViewPlugin for tree-sitter highlighting ---

function buildDecorations(view: EditorView, parser: Parser): DecorationSet {
  try {
    const doc = view.state.doc.toString();
    const tree = parser.parse(doc);
    if (!tree) return Decoration.none;
    const decorations: Array<{ from: number; to: number; deco: Decoration }> = [];

    function visit(node: TSNode) {
      const cls = node.isNamed ? NODE_CLASS[node.type] : UNNAMED_CLASS[node.type];
      if (cls && MARKS[cls]) {
        const from = node.startIndex;
        const to = node.endIndex;
        if (from < to && to <= doc.length) {
          decorations.push({ from, to, deco: MARKS[cls] });
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) visit(child);
      }
    }

    visit(tree.rootNode);

    // Sort by position (CodeMirror requires sorted decorations)
    decorations.sort((a, b) => a.from - b.from || a.to - b.to);

    return Decoration.set(decorations.map((d) => d.deco.range(d.from, d.to)));
  } catch {
    // Tree-sitter parse failed — return empty decorations to avoid corruption
    return Decoration.none;
  }
}

function treeSitterPlugin(parser: Parser) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, parser);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, parser);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// --- Fallback StreamLanguage (regex-based, used if tree-sitter WASM unavailable) ---

const D2_KEYWORDS = new Set([
  'direction', 'shape', 'style', 'label', 'icon', 'near', 'tooltip',
  'link', 'class', 'classes', 'constraint', 'width', 'height',
  'grid-columns', 'grid-rows', 'grid-gap', 'vertical-gap', 'horizontal-gap',
  'top', 'left', 'font-size', 'font-color', 'fill', 'stroke', 'stroke-width',
  'stroke-dash', 'border-radius', 'shadow', 'opacity', 'bold', 'italic',
  'underline', 'text-transform', 'double-border', 'multiple', '3d',
  'animated', 'filled', 'source-arrowhead', 'target-arrowhead',
]);

const D2_SHAPES = new Set([
  'rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder',
  'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond',
  'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'sql_table',
  'image', 'sequence_diagram', 'c4-person',
]);

const d2StreamDef = {
  token(stream: StringStream): string | null {
    // Comments
    if (stream.match(/^#.*/)) return 'comment';
    // Arrows
    if (stream.match(/^(<->|-->|<--|->|<-|--)/)) return 'keyword';
    // Strings
    if (stream.match(/^"([^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^'([^'\\]|\\.)*'/)) return 'string';
    // Numbers
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    // Booleans
    if (stream.match(/^(true|false)\b/)) return 'atom';
    // Braces/brackets/delimiters
    if (stream.match(/^[{}[\]:;]/)) return 'punctuation';
    // Identifiers / keywords
    if (stream.match(/^[a-zA-Z_][\w-]*/)) {
      const word = stream.current();
      if (D2_KEYWORDS.has(word)) return 'keyword';
      if (D2_SHAPES.has(word)) return 'typeName';
      return 'variableName';
    }
    stream.next();
    return null;
  },
};

const fallbackLanguage = StreamLanguage.define(d2StreamDef);

// --- Autocomplete ---

const D2_DIRECTIONS = ['up', 'down', 'left', 'right'];

const D2_STYLE_KEYWORDS = [
  'opacity', 'fill', 'stroke', 'stroke-width', 'stroke-dash', 'border-radius',
  'shadow', 'font-size', 'font-color', 'bold', 'italic', 'underline',
  'text-transform', 'double-border', 'multiple', '3d', 'animated', 'filled',
];

const D2_ARROWS = ['->', '<-', '<->', '--', '-->', '<--'];

function mkCompletions(items: string[], type: string, boost = 0): Completion[] {
  return items.map((label) => ({ label, type, boost }));
}

const allCompletions: Completion[] = [
  ...mkCompletions([...D2_KEYWORDS], 'keyword', 2),
  ...mkCompletions([...D2_SHAPES], 'type', 1),
  ...mkCompletions(D2_STYLE_KEYWORDS, 'property'),
  ...mkCompletions(D2_DIRECTIONS, 'enum'),
  ...mkCompletions(D2_ARROWS, 'operator'),
  ...mkCompletions(['true', 'false'], 'constant'),
];

/** All built-in words to exclude from document-word completions */
const BUILTIN_WORDS = new Set([
  ...D2_KEYWORDS,
  ...D2_SHAPES,
  ...D2_STYLE_KEYWORDS,
  ...D2_DIRECTIONS,
  'true', 'false',
]);

/** Extract unique identifiers (node names, aliases) from the document text */
function extractDocWords(doc: string, currentWord: string): Completion[] {
  const seen = new Set<string>();
  // Match word-like tokens (2+ chars, including hyphens/underscores)
  const wordRegex = /[a-zA-Z_][a-zA-Z0-9_-]{1,}/g;
  let m;
  while ((m = wordRegex.exec(doc)) !== null) {
    const w = m[0];
    // Skip the word currently being typed, and skip all built-in completions
    if (w === currentWord) continue;
    if (BUILTIN_WORDS.has(w)) continue;
    seen.add(w);
  }
  return Array.from(seen).map((label) => ({ label, type: 'variable', boost: -1 }));
}

function d2Completions(context: CompletionContext) {
  const word = context.matchBefore(/[\w-]+/);
  if (!word && !context.explicit) return null;
  const currentWord = word?.text ?? '';
  const docWords = extractDocWords(context.state.doc.toString(), currentWord);
  return {
    from: word?.from ?? context.pos,
    options: [...allCompletions, ...docWords],
    validFor: /^[\w-]*$/,
  };
}

const d2Autocompletion = autocompletion({
  override: [d2Completions],
  activateOnTyping: true,
});

// --- Auto-indent service ---

const d2IndentService = indentService.of((context, pos) => {
  const line = context.state.doc.lineAt(pos);
  let depth = 0;
  for (let i = 1; i < line.number; i++) {
    const prev = context.state.doc.line(i).text;
    for (const ch of prev) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  if (line.text.trim().startsWith('}')) depth = Math.max(0, depth - 1);
  return depth * context.unit;
});

// --- Public API ---

/**
 * Get CodeMirror extensions for D2 tree-sitter highlighting.
 * Returns [language, highlightPlugin, theme] if parser available,
 * or [language] as fallback.
 */
export function d2Extensions(parser?: Parser) {
  const indent = [indentUnit.of('  '), d2IndentService, indentOnInput()];
  if (parser) {
    return [fallbackLanguage, treeSitterPlugin(parser), d2HighlightTheme, d2Autocompletion, ...indent];
  }
  return [fallbackLanguage, d2Autocompletion, ...indent];
}

/**
 * For testing: expose internals
 */
export { D2_KEYWORDS, D2_SHAPES, NODE_CLASS, UNNAMED_CLASS, fallbackLanguage };

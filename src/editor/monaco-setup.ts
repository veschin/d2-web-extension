import { D2_LANGUAGE_ID, D2_MONARCH_TOKENIZER, D2_COMPLETION_ITEMS } from './d2-language';

const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';

/** Load Monaco Editor from CDN into the page */
export function loadMonaco(): Promise<any> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if ((window as any).monaco) {
      resolve((window as any).monaco);
      return;
    }

    // Load AMD loader
    const loaderScript = document.createElement('script');
    loaderScript.src = `${MONACO_CDN}/vs/loader.js`;
    loaderScript.onload = () => {
      const require = (window as any).require;
      require.config({ paths: { vs: `${MONACO_CDN}/vs` } });
      require(['vs/editor/editor.main'], () => {
        const monaco = (window as any).monaco;
        registerD2Language(monaco);
        resolve(monaco);
      });
    };
    loaderScript.onerror = () => reject(new Error('Failed to load Monaco Editor'));
    document.head.appendChild(loaderScript);
  });
}

/** Register D2 language in Monaco */
function registerD2Language(monaco: any) {
  // Register language
  monaco.languages.register({ id: D2_LANGUAGE_ID });

  // Set tokenizer
  monaco.languages.setMonarchTokensProvider(D2_LANGUAGE_ID, D2_MONARCH_TOKENIZER);

  // Set language config
  monaco.languages.setLanguageConfiguration(D2_LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /.*\{\s*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });

  // Register completion provider
  monaco.languages.registerCompletionItemProvider(D2_LANGUAGE_ID, {
    provideCompletionItems: (_model: any, position: any) => {
      const suggestions = D2_COMPLETION_ITEMS.map((item) => ({
        ...item,
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
      }));
      return { suggestions };
    },
  });
}

/** Create a Monaco editor instance in a container */
export function createEditor(
  monaco: any,
  container: HTMLElement,
  initialValue: string,
  theme: 'vs' | 'vs-dark' = 'vs'
): any {
  return monaco.editor.create(container, {
    value: initialValue,
    language: D2_LANGUAGE_ID,
    theme,
    minimap: { enabled: false },
    lineNumbers: 'on',
    wordWrap: 'on',
    fontSize: 13,
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Fira Code', monospace",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    bracketPairColorization: { enabled: true },
    tabSize: 2,
    insertSpaces: true,
    renderLineHighlight: 'line',
    padding: { top: 8 },
  });
}

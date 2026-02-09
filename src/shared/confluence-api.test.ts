import { describe, it, expect, beforeEach } from 'vitest';
import { readPageMeta, parseStorageMacros, replaceStorageMacroCode } from './confluence-api';

// Real storage format captured from Confluence 7.19 instance
const REAL_STORAGE = `<h2 class="auto-cursor-target">Заголовок</h2><ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="bab2a33c-c164-4ca5-a57c-dff8bce77d12"><ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter><ac:plain-text-body><![CDATA[j_a -> j_b -> py_d]]></ac:plain-text-body></ac:structured-macro><p class="auto-cursor-target"><br /></p><h2 class="auto-cursor-target">Заголовок 2</h2><ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="c1b80840-c628-45e2-b3c2-30f293495292"><ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter><ac:plain-text-body><![CDATA[a -> c]]></ac:plain-text-body></ac:structured-macro><p class="auto-cursor-target"><br /></p><h2 class="auto-cursor-target">Заголовок 3</h2><ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="b606ae98-2d63-415a-9fac-77bb5fa6ea8c"><ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter><ac:plain-text-body><![CDATA[a -> c]]></ac:plain-text-body></ac:structured-macro>`;

describe('parseStorageMacros', () => {
  it('extracts all 3 D2 macros from real storage', () => {
    const macros = parseStorageMacros(REAL_STORAGE);
    expect(macros).toHaveLength(3);
  });

  it('extracts correct macro-ids', () => {
    const macros = parseStorageMacros(REAL_STORAGE);
    expect(macros[0].macroId).toBe('bab2a33c-c164-4ca5-a57c-dff8bce77d12');
    expect(macros[1].macroId).toBe('c1b80840-c628-45e2-b3c2-30f293495292');
    expect(macros[2].macroId).toBe('b606ae98-2d63-415a-9fac-77bb5fa6ea8c');
  });

  it('extracts correct D2 code from CDATA', () => {
    const macros = parseStorageMacros(REAL_STORAGE);
    expect(macros[0].code).toBe('j_a -> j_b -> py_d');
    expect(macros[1].code).toBe('a -> c');
    expect(macros[2].code).toBe('a -> c');
  });

  it('returns empty array for page without d2 macros', () => {
    const macros = parseStorageMacros('<p>Hello world</p>');
    expect(macros).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    const macros = parseStorageMacros('');
    expect(macros).toHaveLength(0);
  });

  it('handles macro with multiline D2 code', () => {
    const storage = `<ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="test-id"><ac:plain-text-body><![CDATA[a -> b
b -> c
c -> d]]></ac:plain-text-body></ac:structured-macro>`;
    const macros = parseStorageMacros(storage);
    expect(macros).toHaveLength(1);
    expect(macros[0].code).toBe('a -> b\nb -> c\nc -> d');
    expect(macros[0].macroId).toBe('test-id');
  });

  it('handles macro with special chars in D2 code', () => {
    const storage = `<ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="sp-id"><ac:plain-text-body><![CDATA[x: {
  style.fill: "#c1d3fe"
  label: "Test & <special>"
}]]></ac:plain-text-body></ac:structured-macro>`;
    const macros = parseStorageMacros(storage);
    expect(macros).toHaveLength(1);
    expect(macros[0].code).toContain('#c1d3fe');
    expect(macros[0].code).toContain('Test & <special>');
  });

  it('ignores non-d2 structured macros', () => {
    const storage = `<ac:structured-macro ac:name="code" ac:schema-version="1" ac:macro-id="other"><ac:plain-text-body><![CDATA[hello]]></ac:plain-text-body></ac:structured-macro><ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="d2-id"><ac:plain-text-body><![CDATA[a -> b]]></ac:plain-text-body></ac:structured-macro>`;
    const macros = parseStorageMacros(storage);
    expect(macros).toHaveLength(1);
    expect(macros[0].macroId).toBe('d2-id');
  });
});

describe('replaceStorageMacroCode', () => {
  it('replaces code in first macro by macro-id', () => {
    const updated = replaceStorageMacroCode(
      REAL_STORAGE,
      'bab2a33c-c164-4ca5-a57c-dff8bce77d12',
      'test_a -> test_b'
    );
    const macros = parseStorageMacros(updated);
    expect(macros[0].code).toBe('test_a -> test_b');
    // Other macros unchanged
    expect(macros[1].code).toBe('a -> c');
    expect(macros[2].code).toBe('a -> c');
  });

  it('replaces code in second macro by macro-id', () => {
    const updated = replaceStorageMacroCode(
      REAL_STORAGE,
      'c1b80840-c628-45e2-b3c2-30f293495292',
      'x -> y -> z'
    );
    const macros = parseStorageMacros(updated);
    expect(macros[0].code).toBe('j_a -> j_b -> py_d');
    expect(macros[1].code).toBe('x -> y -> z');
    expect(macros[2].code).toBe('a -> c');
  });

  it('replaces code in third macro (same code as second)', () => {
    const updated = replaceStorageMacroCode(
      REAL_STORAGE,
      'b606ae98-2d63-415a-9fac-77bb5fa6ea8c',
      'different -> code'
    );
    const macros = parseStorageMacros(updated);
    expect(macros[0].code).toBe('j_a -> j_b -> py_d');
    expect(macros[1].code).toBe('a -> c'); // NOT changed despite same code
    expect(macros[2].code).toBe('different -> code');
  });

  it('handles multiline replacement code', () => {
    const newCode = 'a: {\n  shape: cylinder\n}\nb: {\n  shape: queue\n}\na -> b';
    const updated = replaceStorageMacroCode(
      REAL_STORAGE,
      'bab2a33c-c164-4ca5-a57c-dff8bce77d12',
      newCode
    );
    const macros = parseStorageMacros(updated);
    expect(macros[0].code).toBe(newCode);
  });

  it('returns unchanged storage for non-existent macro-id', () => {
    const updated = replaceStorageMacroCode(REAL_STORAGE, 'non-existent-id', 'new code');
    expect(updated).toBe(REAL_STORAGE);
  });

  it('preserves surrounding HTML', () => {
    const updated = replaceStorageMacroCode(
      REAL_STORAGE,
      'bab2a33c-c164-4ca5-a57c-dff8bce77d12',
      'new'
    );
    expect(updated).toContain('<h2 class="auto-cursor-target">Заголовок</h2>');
    expect(updated).toContain('<h2 class="auto-cursor-target">Заголовок 2</h2>');
    expect(updated).toContain('<h2 class="auto-cursor-target">Заголовок 3</h2>');
  });
});

describe('readPageMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('returns null when no ajs-page-id meta tag', () => {
    expect(readPageMeta()).toBeNull();
  });

  it('reads all meta tags correctly', () => {
    const metas: Record<string, string> = {
      'ajs-page-id': '462329155',
      'ajs-space-key': 'RKN',
      'ajs-page-title': 'тестовая страничка d2',
      'ajs-page-version': '5',
      'ajs-base-url': 'https://kb-liga.phoenixit.ru',
      'ajs-atl-token': 'test-token',
      'ajs-parent-page-id': '404856953',
    };

    Object.entries(metas).forEach(([name, content]) => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      meta.setAttribute('content', content);
      document.head.appendChild(meta);
    });

    const result = readPageMeta();
    expect(result).not.toBeNull();
    expect(result!.pageId).toBe('462329155');
    expect(result!.spaceKey).toBe('RKN');
    expect(result!.pageTitle).toBe('тестовая страничка d2');
    expect(result!.pageVersion).toBe('5');
    expect(result!.baseUrl).toBe('https://kb-liga.phoenixit.ru');
    expect(result!.atlToken).toBe('test-token');
    expect(result!.parentPageId).toBe('404856953');
  });

  it('returns empty strings for missing optional metas', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'ajs-page-id');
    meta.setAttribute('content', '123');
    document.head.appendChild(meta);

    const result = readPageMeta();
    expect(result).not.toBeNull();
    expect(result!.pageId).toBe('123');
    expect(result!.spaceKey).toBe('');
    expect(result!.atlToken).toBe('');
  });
});

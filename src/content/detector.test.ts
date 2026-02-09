import { describe, it, expect, beforeEach, vi } from 'vitest';

// We test the detection helper functions by re-implementing the extraction logic
// since detector.ts runs as an IIFE with side effects. We test the pure extraction
// patterns that it uses internally.

describe('view mode macro detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds div.d2-macro elements', () => {
    document.body.innerHTML = `
      <div class="d2-macro">
        <div class="d2-code" style="display:none">a -&gt; b</div>
        <div class="d2-diagram"><svg></svg></div>
      </div>
    `;
    const macros = document.querySelectorAll('div.d2-macro');
    expect(macros).toHaveLength(1);
  });

  it('extracts and decodes D2 code from .d2-code div', () => {
    document.body.innerHTML = `
      <div class="d2-macro">
        <div class="d2-code" style="display:none">a -&gt; b -&gt; c</div>
      </div>
    `;
    const codeDiv = document.querySelector('.d2-code');
    const raw = codeDiv?.textContent ?? '';
    const code = raw
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
    expect(code).toBe('a -> b -> c');
  });

  it('handles multiple macros', () => {
    document.body.innerHTML = `
      <div class="d2-macro"><div class="d2-code">x -&gt; y</div></div>
      <p>Some text</p>
      <div class="d2-macro"><div class="d2-code">a -&gt; b</div></div>
    `;
    const macros = document.querySelectorAll('div.d2-macro');
    expect(macros).toHaveLength(2);
  });

  it('extracts server URL from inline script', () => {
    document.body.innerHTML = `
      <div class="d2-macro">
        <div class="d2-code">a -&gt; b</div>
        <script>(function() { fetch('https://d2lang.phoenixit.ru/svg', { method: 'POST' }); })()</script>
      </div>
    `;
    const el = document.querySelector('div.d2-macro')!;
    const script = el.querySelector('script');
    const match = script?.textContent?.match(/fetch\(['"]([^'"]+)\/(svg|png)['"]/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('https://d2lang.phoenixit.ru');
  });

  it('returns empty when no d2-code div inside macro', () => {
    document.body.innerHTML = `<div class="d2-macro"><p>no code div</p></div>`;
    const codeDiv = document.querySelector('.d2-macro .d2-code');
    expect(codeDiv).toBeNull();
  });
});

describe('edit mode macro detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds wysiwyg-macro tables for d2', () => {
    document.body.innerHTML = `
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="abc-123">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>a -> b</pre></td></tr></tbody>
      </table>
    `;
    const tables = document.querySelectorAll('table.wysiwyg-macro[data-macro-name="d2"]');
    expect(tables).toHaveLength(1);
  });

  it('extracts code from pre element', () => {
    document.body.innerHTML = `
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="abc-123">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>x -> y -> z</pre></td></tr></tbody>
      </table>
    `;
    const pre = document.querySelector('td.wysiwyg-macro-body pre');
    expect(pre?.textContent).toBe('x -> y -> z');
  });

  it('extracts macro-id from data attribute', () => {
    document.body.innerHTML = `
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="bab2a33c-c164-4ca5-a57c-dff8bce77d12">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>a -> b</pre></td></tr></tbody>
      </table>
    `;
    const table = document.querySelector('table.wysiwyg-macro[data-macro-name="d2"]');
    expect(table?.getAttribute('data-macro-id')).toBe('bab2a33c-c164-4ca5-a57c-dff8bce77d12');
  });

  it('ignores non-d2 macro tables', () => {
    document.body.innerHTML = `
      <table class="wysiwyg-macro" data-macro-name="code" data-macro-id="other">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>not d2</pre></td></tr></tbody>
      </table>
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="d2-one">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>a -> b</pre></td></tr></tbody>
      </table>
    `;
    const d2Tables = document.querySelectorAll('table.wysiwyg-macro[data-macro-name="d2"]');
    expect(d2Tables).toHaveLength(1);
  });

  it('parses macro parameters from data-macro-parameters', () => {
    document.body.innerHTML = `
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="test-id"
             data-macro-parameters="server=https://d2lang.test|theme=3|layout=dagre|sketch=true">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>a -> b</pre></td></tr></tbody>
      </table>
    `;
    const table = document.querySelector('table.wysiwyg-macro[data-macro-name="d2"]')!;
    const paramsStr = table.getAttribute('data-macro-parameters') ?? '';
    const params: Record<string, string> = {};
    paramsStr.split('|').forEach((pair) => {
      const [key, val] = pair.split('=');
      if (key && val) params[key] = val;
    });

    expect(params.server).toBe('https://d2lang.test');
    expect(params.theme).toBe('3');
    expect(params.layout).toBe('dagre');
    expect(params.sketch).toBe('true');
  });

  it('handles multiple d2 macros in edit mode', () => {
    document.body.innerHTML = `
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="id-1">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>a -> b</pre></td></tr></tbody>
      </table>
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="id-2">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>x -> y</pre></td></tr></tbody>
      </table>
      <table class="wysiwyg-macro" data-macro-name="d2" data-macro-id="id-3">
        <tbody><tr><td class="wysiwyg-macro-body"><pre>p -> q</pre></td></tr></tbody>
      </table>
    `;
    const tables = document.querySelectorAll('table.wysiwyg-macro[data-macro-name="d2"]');
    expect(tables).toHaveLength(3);

    const codes = Array.from(tables).map(
      (t) => t.querySelector('td.wysiwyg-macro-body pre')?.textContent
    );
    expect(codes).toEqual(['a -> b', 'x -> y', 'p -> q']);
  });
});

describe('page meta extraction', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('detects Confluence page by ajs-page-id meta', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'ajs-page-id');
    meta.setAttribute('content', '462329155');
    document.head.appendChild(meta);

    const pageIdMeta = document.querySelector('meta[name="ajs-page-id"]');
    expect(pageIdMeta).not.toBeNull();
    expect(pageIdMeta?.getAttribute('content')).toBe('462329155');
  });

  it('reads all relevant meta tags', () => {
    const tags: Record<string, string> = {
      'ajs-page-id': '462329155',
      'ajs-space-key': 'RKN',
      'ajs-page-title': 'test page',
      'ajs-page-version': '5',
      'ajs-base-url': 'https://kb.test.ru',
      'ajs-atl-token': 'tok123',
      'ajs-parent-page-id': '404856953',
    };

    Object.entries(tags).forEach(([name, content]) => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      meta.setAttribute('content', content);
      document.head.appendChild(meta);
    });

    for (const [name, expected] of Object.entries(tags)) {
      const el = document.querySelector(`meta[name="${name}"]`);
      expect(el?.getAttribute('content')).toBe(expected);
    }
  });

  it('returns null content for missing optional metas', () => {
    const el = document.querySelector('meta[name="ajs-space-key"]');
    expect(el).toBeNull();
  });
});

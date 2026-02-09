import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractServerUrl, renderSvg, formatD2 } from './d2-server';

describe('extractServerUrl', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts URL from inline script with fetch svg', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="d2-code">a -> b</div>
      <script>
        (function() {
          fetch('https://d2lang.phoenixit.ru/svg', { method: 'POST' });
        })();
      </script>
    `;
    expect(extractServerUrl(div)).toBe('https://d2lang.phoenixit.ru');
  });

  it('extracts URL from inline script with fetch png', () => {
    const div = document.createElement('div');
    div.innerHTML = `<script>fetch("https://example.com/d2/png", { method: 'POST' })</script>`;
    expect(extractServerUrl(div)).toBe('https://example.com/d2');
  });

  it('returns empty string when no script', () => {
    const div = document.createElement('div');
    div.innerHTML = `<div class="d2-code">a -> b</div>`;
    expect(extractServerUrl(div)).toBe('');
  });

  it('returns empty string when script has no fetch', () => {
    const div = document.createElement('div');
    div.innerHTML = `<script>console.log('no fetch here')</script>`;
    expect(extractServerUrl(div)).toBe('');
  });

  it('handles URL with port number', () => {
    const div = document.createElement('div');
    div.innerHTML = `<script>fetch('http://localhost:8080/svg', {})</script>`;
    expect(extractServerUrl(div)).toBe('http://localhost:8080');
  });
});

describe('renderSvg', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns svg on successful response', async () => {
    const mockSvg = '<svg><circle r="10"/></svg>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(mockSvg, { status: 200 })
    );

    const result = await renderSvg('https://d2.test', 'a -> b', {});
    expect(result.svg).toBe(mockSvg);
    expect(result.error).toBeUndefined();
  });

  it('sends d2 code in form data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<svg/>', { status: 200 })
    );

    await renderSvg('https://d2.test', 'x -> y', { theme: '3', layout: 'dagre' });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://d2.test/svg');
    expect(call[1]?.method).toBe('POST');

    const body = call[1]?.body as FormData;
    expect(body.get('d2')).toBe('x -> y');
    expect(body.get('theme')).toBe('3');
    expect(body.get('layout')).toBe('dagre');
  });

  it('skips empty optional params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<svg/>', { status: 200 })
    );

    await renderSvg('https://d2.test', 'a -> b', { theme: '', layout: undefined });

    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(body.get('d2')).toBe('a -> b');
    expect(body.get('theme')).toBeNull();
    expect(body.get('layout')).toBeNull();
  });

  it('returns error on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('compilation error: bad syntax', { status: 400 })
    );

    const result = await renderSvg('https://d2.test', 'bad code', {});
    expect(result.svg).toBeUndefined();
    expect(result.error).toBe('compilation error: bad syntax');
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await renderSvg('https://d2.test', 'a -> b', {});
    expect(result.svg).toBeUndefined();
    expect(result.error).toContain('Server unreachable');
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('formatD2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns formatted code on success', async () => {
    const formatted = 'a -> b\nb -> c\n';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(formatted, { status: 200 })
    );

    const result = await formatD2('https://d2.test', 'a->b\nb->c');
    expect(result.formatted).toBe(formatted);
    expect(result.error).toBeUndefined();
  });

  it('sends to /format endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('a -> b\n', { status: 200 })
    );

    await formatD2('https://d2.test', 'a->b');

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://d2.test/format');

    const body = call[1]?.body as FormData;
    expect(body.get('d2')).toBe('a->b');
  });

  it('returns error on server error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('parse error', { status: 400 })
    );

    const result = await formatD2('https://d2.test', '{{{bad');
    expect(result.formatted).toBeUndefined();
    expect(result.error).toBe('parse error');
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    const result = await formatD2('https://d2.test', 'a -> b');
    expect(result.error).toContain('Server unreachable');
  });
});

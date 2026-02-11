import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractServerUrl, renderSvg, formatD2, renderPng, checkServerReachable, resolveServerUrl, renderSvgWithFallback, _resetReachabilityCache } from './d2-server';

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

    const body = new URLSearchParams(call[1]?.body as string);
    expect(body.get('d2')).toBe('x -> y');
    expect(body.get('theme')).toBe('3');
    expect(body.get('layout')).toBe('dagre');
  });

  it('skips empty optional params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<svg/>', { status: 200 })
    );

    await renderSvg('https://d2.test', 'a -> b', { theme: '', layout: undefined });

    const body = new URLSearchParams(vi.mocked(fetch).mock.calls[0][1]?.body as string);
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

    const body = new URLSearchParams(call[1]?.body as string);
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

describe('renderPng', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns png blob on success', async () => {
    const blob = new Blob(['fake-png'], { type: 'image/png' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(blob, { status: 200 })
    );

    const result = await renderPng('https://d2.test', 'a -> b', {});
    expect(result.png).toBeInstanceOf(Blob);
    expect(result.error).toBeUndefined();
  });

  it('sends to /png endpoint with params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(), { status: 200 })
    );

    await renderPng('https://d2.test', 'x -> y', { theme: '3', scale: '2' });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://d2.test/png');
    const body = new URLSearchParams(call[1]?.body as string);
    expect(body.get('d2')).toBe('x -> y');
    expect(body.get('theme')).toBe('3');
    expect(body.get('scale')).toBe('2');
  });

  it('returns error on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('bad code', { status: 400 })
    );

    const result = await renderPng('https://d2.test', 'bad', {});
    expect(result.png).toBeUndefined();
    expect(result.error).toBe('bad code');
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await renderPng('https://d2.test', 'a -> b', {});
    expect(result.png).toBeUndefined();
    expect(result.error).toContain('Server unreachable');
  });
});

describe('checkServerReachable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetReachabilityCache();
  });

  it('returns false for empty URL', async () => {
    const ok = await checkServerReachable('');
    expect(ok).toBe(false);
  });

  it('returns true when server responds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );

    const ok = await checkServerReachable('https://d2.test');
    expect(ok).toBe(true);
  });

  it('returns false on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const ok = await checkServerReachable('https://d2.test');
    expect(ok).toBe(false);
  });

  it('caches result for subsequent calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );

    await checkServerReachable('https://d2.test');
    await checkServerReachable('https://d2.test');
    // Only one fetch call — second was cached
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns true even on 400 status (server is reachable)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 400 })
    );

    const ok = await checkServerReachable('https://d2.test');
    expect(ok).toBe(true);
  });
});

describe('resolveServerUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetReachabilityCache();
  });

  it('returns user server when reachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );

    const url = await resolveServerUrl('https://user.test', 'https://macro.test');
    expect(url).toBe('https://user.test');
  });

  it('falls back to macro server when user server unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'));

    const url = await resolveServerUrl('https://user.test', 'https://macro.test');
    expect(url).toBe('https://macro.test');
  });

  it('returns macro server when no user server', async () => {
    const url = await resolveServerUrl('', 'https://macro.test');
    expect(url).toBe('https://macro.test');
  });

  it('returns empty when both are empty', async () => {
    const url = await resolveServerUrl('', '');
    expect(url).toBe('');
  });
});

describe('renderSvgWithFallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetReachabilityCache();
  });

  it('uses user server when it succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<svg>user</svg>', { status: 200 })
    );

    const result = await renderSvgWithFallback('https://user.test', 'https://macro.test', 'a -> b', {});
    expect(result.svg).toBe('<svg>user</svg>');
    expect(result.usedServer).toBe('https://user.test');
  });

  it('falls back to macro server when user server fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('user.test')) {
        return new Response('error', { status: 500 });
      }
      return new Response('<svg>macro</svg>', { status: 200 });
    });

    const result = await renderSvgWithFallback('https://user.test', 'https://macro.test', 'a -> b', {});
    expect(result.svg).toBe('<svg>macro</svg>');
    expect(result.usedServer).toBe('https://macro.test');
  });

  it('does not fall back when user and macro servers are the same', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 500 })
    );

    const result = await renderSvgWithFallback('https://same.test', 'https://same.test', 'a -> b', {});
    expect(result.error).toBe('error');
    expect(result.usedServer).toBe('https://same.test');
  });

  it('uses macro server when no user server configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<svg>m</svg>', { status: 200 })
    );

    const result = await renderSvgWithFallback('', 'https://macro.test', 'a -> b', {});
    expect(result.svg).toBe('<svg>m</svg>');
    expect(result.usedServer).toBe('https://macro.test');
  });

  it('returns error when no servers configured', async () => {
    const result = await renderSvgWithFallback('', '', 'a -> b', {});
    expect(result.error).toBe('No server URL configured');
    expect(result.usedServer).toBe('');
  });
});

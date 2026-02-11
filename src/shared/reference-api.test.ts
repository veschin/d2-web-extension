import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getReferenceSources,
  setReferenceSources,
  fetchReferences,
  fetchReferenceMacros,
} from './reference-api';

let storage: Record<string, unknown> = {};

const SOURCES_KEY = 'd2ext-ref-sources';
const CACHE_KEY = 'd2ext-ref-cache';

beforeEach(() => {
  storage = {};
  vi.restoreAllMocks();

  (globalThis as any).browser = {
    ...((globalThis as any).browser),
    runtime: {
      sendMessage: vi.fn(async () => ({})),
      onMessage: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
      getURL: (path: string) => `chrome-extension://test-id/${path}`,
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(storage, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  };

  // Suppress logger output
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const STORAGE_WITH_D2 = JSON.stringify({
  results: [{
    title: 'Ref Page',
    version: { number: 5 },
    body: {
      storage: {
        value: `<ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="m1"><ac:plain-text-body><![CDATA[server {
  shape: rectangle
}

client {
  shape: oval
}

server -> client]]></ac:plain-text-body></ac:structured-macro>`,
      },
    },
  }],
});

describe('getReferenceSources / setReferenceSources', () => {
  it('returns empty array when nothing stored', async () => {
    const sources = await getReferenceSources();
    expect(sources).toEqual([]);
  });

  it('round-trips sources correctly', async () => {
    const sources = [{ spaceKey: 'RKN', pageTitle: 'D2 Ref' }];
    await setReferenceSources(sources);
    const loaded = await getReferenceSources();
    expect(loaded).toEqual(sources);
  });

  it('returns empty array when storage throws', async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValue(new Error('fail'));
    const sources = await getReferenceSources();
    expect(sources).toEqual([]);
  });
});

describe('fetchReferences', () => {
  it('returns empty when no source configured for space', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'OTHER', pageTitle: 'Page' }];
    const blocks = await fetchReferences('RKN');
    expect(blocks).toEqual([]);
  });

  it('returns cached blocks when cache is fresh', async () => {
    const cachedBlocks = [
      { name: 'server', code: 'server {}', sourcePageTitle: 'Ref', sourceSpaceKey: 'RKN', blockIndex: 0, macroIndex: 0 },
    ];
    storage[CACHE_KEY] = {
      'RKN': { spaceKey: 'RKN', blocks: cachedBlocks, fetchedAt: Date.now(), pageVersion: 5 },
    };
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const blocks = await fetchReferences('RKN');
    expect(blocks).toEqual(cachedBlocks);
    // Fetch should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores stale cache', async () => {
    storage[CACHE_KEY] = {
      'RKN': { spaceKey: 'RKN', blocks: [], fetchedAt: Date.now() - 6 * 60 * 1000, pageVersion: 5 },
    };
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(STORAGE_WITH_D2, { status: 200 })
    );

    const blocks = await fetchReferences('RKN');
    expect(blocks.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bypasses cache when forceRefresh is true', async () => {
    storage[CACHE_KEY] = {
      'RKN': { spaceKey: 'RKN', blocks: [{ name: 'old' }], fetchedAt: Date.now(), pageVersion: 5 },
    };
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(STORAGE_WITH_D2, { status: 200 })
    );

    const blocks = await fetchReferences('RKN', true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(blocks.some(b => b.name === 'server')).toBe(true);
  });

  it('fetches and parses D2 blocks from Confluence page', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(STORAGE_WITH_D2, { status: 200 })
    );

    const blocks = await fetchReferences('RKN');
    expect(blocks.length).toBe(3); // server, client, server -> client
    expect(blocks[0].name).toBe('server');
    expect(blocks[0].sourcePageTitle).toBe('Ref Page');
    expect(blocks[0].sourceSpaceKey).toBe('RKN');
    expect(blocks[0].macroIndex).toBe(0);
  });

  it('writes fetched results to cache', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(STORAGE_WITH_D2, { status: 200 })
    );

    await fetchReferences('RKN');
    const cache = (storage[CACHE_KEY] as Record<string, any>)?.['RKN'];
    expect(cache).toBeDefined();
    expect(cache.spaceKey).toBe('RKN');
    expect(cache.blocks.length).toBe(3);
    expect(cache.pageVersion).toBe(5);
  });

  it('returns empty array on fetch failure', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 })
    );

    const blocks = await fetchReferences('RKN');
    expect(blocks).toEqual([]);
  });

  it('returns empty array when page not found in results', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    );

    const blocks = await fetchReferences('RKN');
    expect(blocks).toEqual([]);
  });

  it('filters by macroIndices when configured', async () => {
    const storageWith2Macros = JSON.stringify({
      results: [{
        title: 'Ref Page',
        version: { number: 1 },
        body: {
          storage: {
            value:
              '<ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="m1"><ac:plain-text-body><![CDATA[a -> b]]></ac:plain-text-body></ac:structured-macro>' +
              '<ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="m2"><ac:plain-text-body><![CDATA[x -> y]]></ac:plain-text-body></ac:structured-macro>',
          },
        },
      }],
    });
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page', macroIndices: [1] }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(storageWith2Macros, { status: 200 })
    );

    const blocks = await fetchReferences('RKN');
    // Only macro at index 1 should be included
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('x -> y');
    expect(blocks[0].macroIndex).toBe(1);
  });
});

describe('fetchReferenceMacros', () => {
  it('returns grouped macros with blocks', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(STORAGE_WITH_D2, { status: 200 })
    );

    const result = await fetchReferenceMacros('RKN');
    expect(result.pageTitle).toBe('Ref Page');
    expect(result.macros).toHaveLength(1);
    expect(result.macros[0].index).toBe(0);
    expect(result.macros[0].blocks.length).toBe(3);
  });

  it('returns empty when no source configured', async () => {
    const result = await fetchReferenceMacros('NOSUCH');
    expect(result.macros).toEqual([]);
    expect(result.pageTitle).toBe('');
  });

  it('returns empty on fetch failure', async () => {
    storage[SOURCES_KEY] = [{ spaceKey: 'RKN', pageTitle: 'Ref Page' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 500 })
    );

    const result = await fetchReferenceMacros('RKN');
    expect(result.macros).toEqual([]);
  });
});

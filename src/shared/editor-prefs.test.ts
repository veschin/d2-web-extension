import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadEditorPrefs,
  saveEditorPrefs,
  saveDraft,
  loadDraft,
  clearDraft,
  listStandaloneDrafts,
  loadStandaloneDraft,
  saveStandaloneDraft,
  deleteStandaloneDraft,
  type StandaloneDraft,
} from './editor-prefs';
import type { MacroParams } from './types';

// In-memory storage mock
let storage: Record<string, unknown> = {};

beforeEach(() => {
  storage = {};
  vi.restoreAllMocks();

  (globalThis as any).browser = {
    ...((globalThis as any).browser),
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
});

describe('loadEditorPrefs', () => {
  it('returns defaults when nothing stored', async () => {
    const prefs = await loadEditorPrefs();
    expect(prefs).toEqual({ fontSize: 13 });
  });

  it('merges stored values with defaults', async () => {
    storage['d2ext-editor-prefs'] = { fontSize: 18 };
    const prefs = await loadEditorPrefs();
    expect(prefs.fontSize).toBe(18);
  });

  it('returns defaults when storage throws', async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValue(new Error('fail'));
    const prefs = await loadEditorPrefs();
    expect(prefs).toEqual({ fontSize: 13 });
  });
});

describe('saveEditorPrefs', () => {
  it('persists preferences to storage', async () => {
    await saveEditorPrefs({ fontSize: 20 });
    expect(storage['d2ext-editor-prefs']).toEqual({ fontSize: 20 });
  });

  it('does not throw when storage fails', async () => {
    vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('fail'));
    await expect(saveEditorPrefs({ fontSize: 20 })).resolves.not.toThrow();
  });
});

describe('saveDraft / loadDraft', () => {
  it('saves and loads a draft by macroId', async () => {
    await saveDraft('macro-1', 'a -> b');
    const code = await loadDraft('macro-1');
    expect(code).toBe('a -> b');
  });

  it('returns null for non-existent draft', async () => {
    const code = await loadDraft('no-such-macro');
    expect(code).toBeNull();
  });

  it('expires drafts older than 24h', async () => {
    const oldTs = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    storage['d2ext-drafts'] = { 'macro-1': { code: 'old', ts: oldTs } };
    const code = await loadDraft('macro-1');
    expect(code).toBeNull();
    // Verify the expired draft was cleaned up
    const drafts = storage['d2ext-drafts'] as Record<string, unknown>;
    expect(drafts['macro-1']).toBeUndefined();
  });

  it('returns draft that is within 24h', async () => {
    const recentTs = Date.now() - 23 * 60 * 60 * 1000; // 23 hours ago
    storage['d2ext-drafts'] = { 'macro-1': { code: 'recent', ts: recentTs } };
    const code = await loadDraft('macro-1');
    expect(code).toBe('recent');
  });

  it('evicts oldest drafts when exceeding 50', async () => {
    // Pre-fill with 50 drafts
    const drafts: Record<string, { code: string; ts: number }> = {};
    for (let i = 0; i < 50; i++) {
      drafts[`macro-${i}`] = { code: `code-${i}`, ts: 1000 + i };
    }
    storage['d2ext-drafts'] = drafts;

    // Save one more — should evict the oldest (macro-0)
    await saveDraft('macro-new', 'new code');
    const result = storage['d2ext-drafts'] as Record<string, { code: string; ts: number }>;
    expect(Object.keys(result)).toHaveLength(50);
    expect(result['macro-0']).toBeUndefined();
    expect(result['macro-new']).toBeDefined();
    expect(result['macro-new'].code).toBe('new code');
  });
});

describe('clearDraft', () => {
  it('removes a specific draft', async () => {
    storage['d2ext-drafts'] = {
      'macro-1': { code: 'a', ts: Date.now() },
      'macro-2': { code: 'b', ts: Date.now() },
    };
    await clearDraft('macro-1');
    const drafts = storage['d2ext-drafts'] as Record<string, unknown>;
    expect(drafts['macro-1']).toBeUndefined();
    expect(drafts['macro-2']).toBeDefined();
  });

  it('does nothing for non-existent draft', async () => {
    storage['d2ext-drafts'] = { 'macro-1': { code: 'a', ts: Date.now() } };
    await clearDraft('no-such');
    const drafts = storage['d2ext-drafts'] as Record<string, unknown>;
    expect(drafts['macro-1']).toBeDefined();
  });
});

describe('standalone drafts', () => {
  const emptyParams: MacroParams = {
    theme: '', layout: '', scale: '', sketch: '',
    direction: '', preset: '', server: '', format: '',
  };

  const makeDraft = (name: string, updatedAt: number): StandaloneDraft => ({
    name,
    code: `code for ${name}`,
    params: emptyParams,
    createdAt: 1000,
    updatedAt,
  });

  describe('saveStandaloneDraft / loadStandaloneDraft', () => {
    it('saves and loads a standalone draft', async () => {
      const draft = makeDraft('Test', 5000);
      await saveStandaloneDraft('draft-1', draft);
      const loaded = await loadStandaloneDraft('draft-1');
      expect(loaded).toEqual(draft);
    });

    it('returns null for non-existent draft', async () => {
      const loaded = await loadStandaloneDraft('no-such');
      expect(loaded).toBeNull();
    });

    it('evicts oldest drafts when exceeding 200', async () => {
      const drafts: Record<string, ReturnType<typeof makeDraft>> = {};
      for (let i = 0; i < 200; i++) {
        drafts[`d-${i}`] = makeDraft(`Draft ${i}`, 1000 + i);
      }
      storage['d2ext-standalone-drafts'] = drafts;

      await saveStandaloneDraft('d-new', makeDraft('New', 9999));
      const result = storage['d2ext-standalone-drafts'] as Record<string, unknown>;
      expect(Object.keys(result)).toHaveLength(200);
      expect(result['d-0']).toBeUndefined(); // oldest evicted
      expect(result['d-new']).toBeDefined();
    });
  });

  describe('listStandaloneDrafts', () => {
    it('returns empty array when nothing stored', async () => {
      const list = await listStandaloneDrafts();
      expect(list).toEqual([]);
    });

    it('returns drafts sorted by updatedAt descending', async () => {
      storage['d2ext-standalone-drafts'] = {
        'a': makeDraft('Old', 1000),
        'b': makeDraft('New', 3000),
        'c': makeDraft('Mid', 2000),
      };
      const list = await listStandaloneDrafts();
      expect(list).toHaveLength(3);
      expect(list[0].id).toBe('b');
      expect(list[1].id).toBe('c');
      expect(list[2].id).toBe('a');
    });

    it('returns empty array when storage throws', async () => {
      vi.mocked(browser.storage.local.get).mockRejectedValue(new Error('fail'));
      const list = await listStandaloneDrafts();
      expect(list).toEqual([]);
    });
  });

  describe('deleteStandaloneDraft', () => {
    it('removes a specific standalone draft', async () => {
      storage['d2ext-standalone-drafts'] = {
        'a': makeDraft('A', 1000),
        'b': makeDraft('B', 2000),
      };
      await deleteStandaloneDraft('a');
      const result = storage['d2ext-standalone-drafts'] as Record<string, unknown>;
      expect(result['a']).toBeUndefined();
      expect(result['b']).toBeDefined();
    });
  });
});

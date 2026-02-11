/**
 * Storage diagnostics — reads all d2ext storage keys and returns summary info.
 */

export interface StorageInfo {
  version: string;
  storedVersion: string;
  settings: { serverUrl: string } | null;
  editorPrefs: { fontSize: number } | null;
  referenceSources: number;
  referenceCache: { spaces: number; totalBlocks: number; oldestAge: number | null };
  macroDrafts: number;
  standaloneDrafts: number;
  svgCacheEntries: number;
}

const ALL_KEYS = [
  'd2ext-settings',
  'd2ext-editor-prefs',
  'd2ext-drafts',
  'd2ext-standalone-drafts',
  'd2ext-ref-sources',
  'd2ext-ref-cache',
  'd2ext-svg-cache',
  'd2ext-meta',
];

const META_KEY = 'd2ext-meta';

/** Stamp the current extension version into storage (call on SW startup) */
export async function stampVersion(): Promise<void> {
  try {
    const version = browser.runtime.getManifest().version;
    await browser.storage.local.set({ [META_KEY]: { version, updatedAt: Date.now() } });
  } catch {
    // storage unavailable
  }
}

/** Quick write-then-read test to verify storage.local works */
export async function testStorageAccess(): Promise<{ ok: boolean; error?: string }> {
  const testKey = 'd2ext-test';
  try {
    await browser.storage.local.set({ [testKey]: 'ok' });
    const result = await browser.storage.local.get(testKey);
    await browser.storage.local.remove(testKey);
    return { ok: result[testKey] === 'ok' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Read all d2ext storage keys and return a summary */
export async function getStorageInfo(): Promise<StorageInfo> {
  const version = browser.runtime.getManifest().version;
  let storedVersion = '';

  try {
    const result = await browser.storage.local.get(ALL_KEYS);

    // Meta
    const meta = result[META_KEY] as { version: string } | undefined;
    storedVersion = meta?.version ?? '';

    // Settings
    const settings = result['d2ext-settings'] as { serverUrl: string } | undefined;

    // Editor prefs
    const editorPrefs = result['d2ext-editor-prefs'] as { fontSize: number } | undefined;

    // Reference sources
    const refSources = (result['d2ext-ref-sources'] as unknown[]) ?? [];

    // Reference cache
    const refCache = (result['d2ext-ref-cache'] as Record<string, { blocks: unknown[]; fetchedAt: number }>) ?? {};
    const cacheEntries = Object.values(refCache);
    const totalBlocks = cacheEntries.reduce((sum, c) => sum + (c.blocks?.length ?? 0), 0);
    const oldestAge = cacheEntries.length > 0
      ? Math.min(...cacheEntries.map((c) => c.fetchedAt))
      : null;

    // Macro drafts
    const drafts = (result['d2ext-drafts'] as Record<string, unknown>) ?? {};
    const macroDrafts = Object.keys(drafts).length;

    // Standalone drafts
    const standaloneDrafts = (result['d2ext-standalone-drafts'] as Record<string, unknown>) ?? {};
    const standaloneDraftCount = Object.keys(standaloneDrafts).length;

    // SVG cache
    const svgCache = (result['d2ext-svg-cache'] as Record<string, unknown>) ?? {};
    const svgCacheEntries = Object.keys(svgCache).length;

    return {
      version,
      storedVersion,
      settings: settings ?? null,
      editorPrefs: editorPrefs ?? null,
      referenceSources: refSources.length,
      referenceCache: { spaces: cacheEntries.length, totalBlocks, oldestAge },
      macroDrafts,
      standaloneDrafts: standaloneDraftCount,
      svgCacheEntries,
    };
  } catch {
    return {
      version,
      storedVersion,
      settings: null,
      editorPrefs: null,
      referenceSources: 0,
      referenceCache: { spaces: 0, totalBlocks: 0, oldestAge: null },
      macroDrafts: 0,
      standaloneDrafts: 0,
      svgCacheEntries: 0,
    };
  }
}

/** Clear all d2ext data from local storage, optionally preserving settings */
export async function clearAllData(preserveSettings = false): Promise<void> {
  const keysToRemove = ALL_KEYS.filter((k) => {
    if (preserveSettings && (k === 'd2ext-settings' || k === 'd2ext-editor-prefs')) return false;
    if (k === 'd2ext-meta') return false;
    return true;
  });
  await browser.storage.local.remove(keysToRemove);
}

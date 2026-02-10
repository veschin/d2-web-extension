/**
 * Reference library API — fetches D2 blocks from configured reference pages.
 * Runs in the service worker context (has access to Confluence cookies).
 */

import type { ReferenceSource, ReferenceBlock, ReferenceCache, ReferenceMacro } from './types';
import { extractD2Blocks } from './d2-parser';
import { logInfo, logError, logTimed } from './logger';

const CACHE_KEY = 'd2ext-ref-cache';
const SOURCES_KEY = 'd2ext-ref-sources';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Get configured reference sources */
export async function getReferenceSources(): Promise<ReferenceSource[]> {
  try {
    const result = await browser.storage.local.get(SOURCES_KEY);
    return (result[SOURCES_KEY] as ReferenceSource[]) ?? [];
  } catch {
    return [];
  }
}

/** Save reference sources */
export async function setReferenceSources(sources: ReferenceSource[]): Promise<void> {
  await browser.storage.local.set({ [SOURCES_KEY]: sources });
}

/** Get cached references for a space, or null if stale/missing */
async function getCachedReferences(spaceKey: string): Promise<ReferenceCache | null> {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const allCaches = (result[CACHE_KEY] as Record<string, ReferenceCache>) ?? {};
    const cache = allCaches[spaceKey];
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache;
    }
  } catch {}
  return null;
}

/** Save references to cache */
async function setCachedReferences(spaceKey: string, cache: ReferenceCache): Promise<void> {
  try {
    const result = await browser.storage.local.get(CACHE_KEY);
    const allCaches = (result[CACHE_KEY] as Record<string, ReferenceCache>) ?? {};
    allCaches[spaceKey] = cache;
    await browser.storage.local.set({ [CACHE_KEY]: allCaches });
  } catch {}
}

/**
 * Fetch reference blocks for a given space.
 * Uses cache if available and fresh; otherwise fetches from Confluence.
 */
export async function fetchReferences(
  spaceKey: string,
  forceRefresh = false
): Promise<ReferenceBlock[]> {
  if (!forceRefresh) {
    const cached = await getCachedReferences(spaceKey);
    if (cached) {
      logInfo('system', `References cache hit for space ${spaceKey}`, { blocks: cached.blocks.length });
      return cached.blocks;
    }
  }

  const sources = await getReferenceSources();
  const source = sources.find((s) => s.spaceKey === spaceKey);
  if (!source) {
    logInfo('system', `No reference source configured for space ${spaceKey}`);
    return [];
  }

  return logTimed('api', `Fetch references for space ${spaceKey}`, async () => {
    // Search for the reference page by title in the space
    const searchUrl = `/rest/api/content?spaceKey=${encodeURIComponent(source.spaceKey)}&title=${encodeURIComponent(source.pageTitle)}&expand=body.storage,version`;

    const res = await fetch(searchUrl, { credentials: 'same-origin' });
    if (!res.ok) {
      logError('api', `Failed to fetch reference page: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const page = data.results?.[0];
    if (!page) {
      logError('api', `Reference page "${source.pageTitle}" not found in space ${source.spaceKey}`);
      return [];
    }

    const storageValue: string = page.body.storage.value;
    const pageVersion: number = page.version.number;

    // Extract D2 macros from the page storage
    const macroRegex =
      /<ac:structured-macro[^>]*ac:name="d2"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
    let match;
    const blocks: ReferenceBlock[] = [];
    let macroIndex = 0;

    while ((match = macroRegex.exec(storageValue)) !== null) {
      // Check if this macro index should be included
      if (source.macroIndices && source.macroIndices.length > 0 && !source.macroIndices.includes(macroIndex)) {
        macroIndex++;
        continue;
      }

      const inner = match[1];
      const cdataMatch = inner.match(
        /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/
      );
      const code = cdataMatch ? cdataMatch[1] : '';

      if (code.trim()) {
        // Extract individual blocks from the D2 code
        const d2Blocks = extractD2Blocks(code);
        for (let bi = 0; bi < d2Blocks.length; bi++) {
          blocks.push({
            name: d2Blocks[bi].name,
            code: d2Blocks[bi].code,
            sourcePageTitle: source.pageTitle,
            sourceSpaceKey: source.spaceKey,
            blockIndex: bi,
            macroIndex,
          });
        }
      }
      macroIndex++;
    }

    // Cache the results
    await setCachedReferences(spaceKey, {
      spaceKey,
      blocks,
      fetchedAt: Date.now(),
      pageVersion,
    });

    logInfo('system', `Fetched ${blocks.length} reference blocks for space ${spaceKey}`);
    return blocks;
  });
}

/**
 * Fetch reference macros grouped by macro index (preserves hierarchy for UI).
 * Returns macros with their parsed blocks, plus the source page title.
 */
export async function fetchReferenceMacros(
  spaceKey: string,
  forceRefresh = false
): Promise<{ macros: ReferenceMacro[]; pageTitle: string }> {
  const sources = await getReferenceSources();
  const source = sources.find((s) => s.spaceKey === spaceKey);
  if (!source) {
    logInfo('system', `No reference source configured for space ${spaceKey}`);
    return { macros: [], pageTitle: '' };
  }

  return logTimed('api', `Fetch reference macros for space ${spaceKey}`, async () => {
    const searchUrl = `/rest/api/content?spaceKey=${encodeURIComponent(source.spaceKey)}&title=${encodeURIComponent(source.pageTitle)}&expand=body.storage,version`;

    const res = await fetch(searchUrl, { credentials: 'same-origin' });
    if (!res.ok) {
      logError('api', `Failed to fetch reference page: HTTP ${res.status}`);
      return { macros: [], pageTitle: source.pageTitle };
    }

    const data = await res.json();
    const page = data.results?.[0];
    if (!page) {
      logError('api', `Reference page "${source.pageTitle}" not found in space ${source.spaceKey}`);
      return { macros: [], pageTitle: source.pageTitle };
    }

    const storageValue: string = page.body.storage.value;
    const pageVersion: number = page.version.number;

    const macroRegex =
      /<ac:structured-macro[^>]*ac:name="d2"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
    let match;
    const macros: ReferenceMacro[] = [];
    const allBlocks: ReferenceBlock[] = [];
    let macroIndex = 0;

    while ((match = macroRegex.exec(storageValue)) !== null) {
      if (source.macroIndices && source.macroIndices.length > 0 && !source.macroIndices.includes(macroIndex)) {
        macroIndex++;
        continue;
      }

      const inner = match[1];
      const cdataMatch = inner.match(
        /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/
      );
      const code = cdataMatch ? cdataMatch[1] : '';

      if (code.trim()) {
        const d2Blocks = extractD2Blocks(code);
        const blocks: ReferenceBlock[] = d2Blocks.map((b, bi) => ({
          name: b.name,
          code: b.code,
          sourcePageTitle: source.pageTitle,
          sourceSpaceKey: source.spaceKey,
          blockIndex: bi,
          macroIndex,
        }));
        macros.push({ index: macroIndex, code, blocks });
        allBlocks.push(...blocks);
      }
      macroIndex++;
    }

    // Update the flat cache too so fetchReferences() stays consistent
    await setCachedReferences(spaceKey, {
      spaceKey,
      blocks: allBlocks,
      fetchedAt: Date.now(),
      pageVersion,
    });

    logInfo('system', `Fetched ${macros.length} macros (${allBlocks.length} blocks) for space ${spaceKey}`);
    return { macros, pageTitle: page.title };
  });
}

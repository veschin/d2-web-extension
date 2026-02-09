export interface EditorPreferences {
  fontSize: number;
}

const STORAGE_KEY = 'd2ext-editor-prefs';

const DEFAULTS: EditorPreferences = {
  fontSize: 13,
};

export async function loadEditorPrefs(): Promise<EditorPreferences> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      return { ...DEFAULTS, ...stored };
    }
  } catch {
    // storage unavailable
  }
  return { ...DEFAULTS };
}

export async function saveEditorPrefs(prefs: EditorPreferences): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: prefs });
  } catch {
    // storage unavailable
  }
}

// --- Draft persistence ---

const DRAFT_KEY = 'd2ext-drafts';

interface DraftEntry {
  code: string;
  ts: number;
}

type DraftMap = Record<string, DraftEntry>;

export async function saveDraft(macroId: string, code: string): Promise<void> {
  try {
    const result = await browser.storage.local.get(DRAFT_KEY);
    const drafts: DraftMap = (result[DRAFT_KEY] as DraftMap) ?? {};
    drafts[macroId] = { code, ts: Date.now() };
    // Keep max 50 drafts, evict oldest
    const entries = Object.entries(drafts);
    if (entries.length > 50) {
      entries.sort((a, b) => a[1].ts - b[1].ts);
      const toRemove = entries.slice(0, entries.length - 50);
      for (const [key] of toRemove) delete drafts[key];
    }
    await browser.storage.local.set({ [DRAFT_KEY]: drafts });
  } catch {
    // storage unavailable
  }
}

export async function loadDraft(macroId: string): Promise<string | null> {
  try {
    const result = await browser.storage.local.get(DRAFT_KEY);
    const drafts: DraftMap = (result[DRAFT_KEY] as DraftMap) ?? {};
    const entry = drafts[macroId];
    if (!entry) return null;
    // Expire drafts older than 24h
    if (Date.now() - entry.ts > 24 * 60 * 60 * 1000) {
      delete drafts[macroId];
      await browser.storage.local.set({ [DRAFT_KEY]: drafts });
      return null;
    }
    return entry.code;
  } catch {
    return null;
  }
}

export async function clearDraft(macroId: string): Promise<void> {
  try {
    const result = await browser.storage.local.get(DRAFT_KEY);
    const drafts: DraftMap = (result[DRAFT_KEY] as DraftMap) ?? {};
    delete drafts[macroId];
    await browser.storage.local.set({ [DRAFT_KEY]: drafts });
  } catch {
    // storage unavailable
  }
}

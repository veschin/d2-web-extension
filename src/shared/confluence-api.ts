import type { PageMeta } from './types';

/** Read page metadata from DOM meta tags */
export function readPageMeta(): PageMeta | null {
  const get = (name: string) =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? '';

  const pageId = get('ajs-page-id');
  if (!pageId) return null;

  return {
    pageId,
    spaceKey: get('ajs-space-key'),
    pageTitle: get('ajs-page-title'),
    pageVersion: get('ajs-page-version'),
    baseUrl: get('ajs-base-url'),
    atlToken: get('ajs-atl-token'),
    parentPageId: get('ajs-parent-page-id'),
  };
}

/** Fetch page storage body via REST API */
export async function fetchPageStorage(
  pageId: string
): Promise<{ storageValue: string; version: number; title: string }> {
  const res = await fetch(
    `/rest/api/content/${pageId}?expand=body.storage,version`,
    { credentials: 'same-origin' }
  );
  if (!res.ok) throw new Error(`GET /rest/api/content/${pageId} → ${res.status}`);
  const data = await res.json();
  return {
    storageValue: data.body.storage.value,
    version: data.version.number,
    title: data.title,
  };
}

/** Parse storage XHTML to extract D2 macro-ids and CDATA bodies */
export function parseStorageMacros(
  storageValue: string
): Array<{ macroId: string; code: string; paramString: string }> {
  const macros: Array<{ macroId: string; code: string; paramString: string }> = [];
  // Match each d2 structured-macro block
  const macroRegex =
    /<ac:structured-macro[^>]*ac:name="d2"[^>]*ac:macro-id="([^"]*)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
  let match;
  while ((match = macroRegex.exec(storageValue)) !== null) {
    const macroId = match[1];
    const inner = match[2];
    // Extract CDATA content
    const cdataMatch = inner.match(
      /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/
    );
    const code = cdataMatch ? cdataMatch[1] : '';
    // Extract parameters string for reference
    const paramString = inner;
    macros.push({ macroId, code, paramString });
  }
  return macros;
}

/** Replace a specific macro's CDATA body in storage XHTML by macro-id */
export function replaceStorageMacroCode(
  storageValue: string,
  macroId: string,
  newCode: string
): string {
  // Find the specific macro by its macro-id and replace its CDATA
  const macroRegex = new RegExp(
    `(<ac:structured-macro[^>]*ac:macro-id="${macroId}"[^>]*>[\\s\\S]*?<ac:plain-text-body><!\\[CDATA\\[)[\\s\\S]*?(\\]\\]><\\/ac:plain-text-body>)`,
    ''
  );
  return storageValue.replace(macroRegex, `$1${newCode}$2`);
}

/** Save updated page content via REST API */
export async function savePage(
  pageId: string,
  title: string,
  currentVersion: number,
  newStorageValue: string
): Promise<{ success: boolean; newVersion?: number; error?: string }> {
  const res = await fetch(`/rest/api/content/${pageId}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'page',
      title,
      version: { number: currentVersion + 1, minorEdit: true },
      body: {
        storage: {
          value: newStorageValue,
          representation: 'storage',
        },
      },
    }),
  });

  if (res.ok) {
    const data = await res.json();
    return { success: true, newVersion: data.version.number };
  }

  const errText = await res.text();
  return { success: false, error: `HTTP ${res.status}: ${errText}` };
}

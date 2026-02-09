import type { MacroInfo, PageMeta } from '../shared/types';
import { logInfo, logWarn, logError, logTimed } from '../shared/logger';
import { fetchReferences, getReferenceSources, setReferenceSources } from '../shared/reference-api';

const STATE_KEY = 'd2ext-sw-state';

interface SWState {
  tabs: Record<number, { macros: MacroInfo[]; pageMeta: PageMeta | null }>;
}

async function getState(): Promise<SWState> {
  try {
    const result = await browser.storage.session.get(STATE_KEY);
    return (result[STATE_KEY] as SWState) ?? { tabs: {} };
  } catch {
    return { tabs: {} };
  }
}

async function setState(state: SWState) {
  try {
    await browser.storage.session.set({ [STATE_KEY]: state });
  } catch {
    // Storage unavailable
  }
}

/** Handle messages from content script and popup */
browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case 'macros-detected': {
      const tabId = sender.tab?.id;
      if (!tabId) return;
      return getState().then((state) => {
        state.tabs[tabId] = { macros: message.macros, pageMeta: message.pageMeta };
        setState(state);
        const count = message.macros.length;
        browser.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
        browser.action.setBadgeBackgroundColor({ color: '#4a90d9', tabId });
        logInfo('system', `SW: macros-detected from tab ${tabId}`, { count });
      });
    }

    case 'get-macros': {
      // Popup asks for macros of the currently active tab
      return browser.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          const tabId = tabs[0]?.id;
          if (!tabId) return { macros: [], pageMeta: null };
          return getState().then((state) => {
            const tabData = state.tabs[tabId];
            return { macros: tabData?.macros ?? [], pageMeta: tabData?.pageMeta ?? null };
          });
        });
    }

    case 'open-editor': {
      // Forward to content script of active tab
      return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) {
          browser.tabs.sendMessage(tabs[0].id, message);
        }
      });
    }

    case 'proxy-fetch': {
      // Generic fetch proxy (D2 server, etc.) — bypass CORS from content script
      const { method: pfMethod, url: pfUrl, body: pfBody, contentType: pfCt } = message;
      logInfo('api', `SW: proxy-fetch ${pfMethod} ${pfUrl}`);
      return logTimed('api', `proxy-fetch ${pfMethod}`, () =>
        fetch(pfUrl, {
          method: pfMethod,
          headers: pfCt ? { 'Content-Type': pfCt } : undefined,
          body: pfBody ?? undefined,
        }).then(async (res) => {
          const data = await res.text();
          return { status: res.status, data };
        })
      ).catch((e) => {
        logError('api', `proxy-fetch failed: ${(e as Error).message}`);
        return { status: 0, data: (e as Error).message };
      });
    }

    case 'confluence-api': {
      // Proxy Confluence REST API calls (bypass CORS from content script)
      const { method, url, body } = message;
      logInfo('api', `SW: proxying ${method} ${url}`);
      return logTimed('api', `Confluence API ${method}`, () =>
        fetch(url, {
          method,
          credentials: 'same-origin',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ?? undefined,
        }).then(async (res) => {
          const data = await res.text();
          return { type: 'confluence-api-result', status: res.status, data };
        })
      ).catch((e) => {
        logError('api', `Confluence API failed: ${(e as Error).message}`);
        return {
          type: 'confluence-api-result',
          status: 0,
          data: (e as Error).message,
        };
      });
    }

    case 'fetch-url-macros': {
      // Fetch D2 macros from a Confluence page URL
      const { url: pageUrl } = message;
      logInfo('api', `SW: fetch-url-macros from ${pageUrl}`);
      return (async () => {
        try {
          // Extract pageId from URL
          let pageId = '';
          try {
            const parsed = new URL(pageUrl);
            pageId = parsed.searchParams.get('pageId') ?? '';
            if (!pageId) {
              // Try /pages/{id}/ or /spaces/.../pages/{id}/ patterns
              const idMatch = parsed.pathname.match(/\/pages\/(\d+)/);
              if (idMatch) pageId = idMatch[1];
            }
          } catch {
            // Not a valid URL — try as a page ID directly
            if (/^\d+$/.test(pageUrl.trim())) pageId = pageUrl.trim();
          }

          if (!pageId) {
            return { macros: [], error: 'Could not extract page ID from URL. Use a link like /pages/viewpage.action?pageId=123' };
          }

          const res = await fetch(
            `${pageUrl.startsWith('http') ? new URL(pageUrl).origin : ''}/rest/api/content/${pageId}?expand=body.storage,version,title`,
            { credentials: 'same-origin' }
          );
          if (!res.ok) {
            return { macros: [], error: `Failed to fetch page: HTTP ${res.status}` };
          }

          const data = await res.json();
          const storageValue: string = data.body.storage.value;
          const pageTitle: string = data.title;

          // Parse D2 macros
          const macroRegex =
            /<ac:structured-macro[^>]*ac:name="d2"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g;
          let m;
          const macros: Array<{ index: number; code: string; firstLine: string }> = [];
          let idx = 0;

          while ((m = macroRegex.exec(storageValue)) !== null) {
            const inner = m[1];
            const cdataMatch = inner.match(
              /<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/
            );
            const code = cdataMatch ? cdataMatch[1] : '';
            if (code.trim()) {
              macros.push({
                index: idx,
                code,
                firstLine: code.split('\n')[0].substring(0, 60),
              });
            }
            idx++;
          }

          logInfo('api', `Found ${macros.length} D2 macros on page "${pageTitle}"`);
          return { macros, pageTitle, pageId };
        } catch (e) {
          logError('api', `fetch-url-macros failed: ${(e as Error).message}`);
          return { macros: [], error: (e as Error).message };
        }
      })();
    }

    case 'get-references': {
      const { spaceKey } = message;
      logInfo('system', `SW: get-references for space ${spaceKey}`);
      return fetchReferences(spaceKey).then((blocks) => ({ blocks }))
        .catch((e) => {
          logError('system', `get-references failed: ${(e as Error).message}`);
          return { blocks: [], error: (e as Error).message };
        });
    }

    case 'refresh-references': {
      const { spaceKey } = message;
      logInfo('system', `SW: refresh-references for space ${spaceKey}`);
      return fetchReferences(spaceKey, true).then((blocks) => ({ blocks }))
        .catch((e) => {
          logError('system', `refresh-references failed: ${(e as Error).message}`);
          return { blocks: [], error: (e as Error).message };
        });
    }

    case 'get-reference-sources': {
      return getReferenceSources().then((sources) => ({ sources }));
    }

    case 'set-reference-sources': {
      return setReferenceSources(message.sources).then(() => ({ success: true }));
    }
  }
});

// Clean up state when a tab is closed
browser.tabs.onRemoved?.addListener((tabId) => {
  getState().then((state) => {
    if (state.tabs[tabId]) {
      delete state.tabs[tabId];
      setState(state);
      logInfo('system', `SW: cleaned up state for closed tab ${tabId}`);
    }
  });
});

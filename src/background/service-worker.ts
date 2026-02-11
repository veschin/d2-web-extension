import type { MacroInfo, PageMeta } from '../shared/types';
import { logInfo, logWarn, logError, logTimed } from '../shared/logger';
import { fetchReferences, fetchReferenceMacros, getReferenceSources, setReferenceSources } from '../shared/reference-api';

// Chrome MV3: allow content scripts to access storage.session (no-op on Firefox)
if (typeof chrome !== 'undefined' && chrome.storage?.session?.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
}

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
          credentials: 'include',
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

    case 'get-reference-macros': {
      const { spaceKey, forceRefresh } = message;
      logInfo('system', `SW: get-reference-macros for space ${spaceKey}`);
      return fetchReferenceMacros(spaceKey, forceRefresh)
        .then((result) => result)
        .catch((e) => {
          logError('system', `get-reference-macros failed: ${(e as Error).message}`);
          return { macros: [], pageTitle: '', error: (e as Error).message };
        });
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

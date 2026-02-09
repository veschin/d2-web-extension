import type { MacroInfo, PageMeta } from '../shared/types';

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

    case 'confluence-api': {
      // Proxy Confluence REST API calls (bypass CORS from content script)
      const { method, url, body } = message;
      return fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ?? undefined,
      })
        .then(async (res) => {
          const data = await res.text();
          return { type: 'confluence-api-result', status: res.status, data };
        })
        .catch((e) => ({
          type: 'confluence-api-result',
          status: 0,
          data: (e as Error).message,
        }));
    }
  }
});

// Clean up state when a tab is closed
browser.tabs.onRemoved?.addListener((tabId) => {
  getState().then((state) => {
    if (state.tabs[tabId]) {
      delete state.tabs[tabId];
      setState(state);
    }
  });
});

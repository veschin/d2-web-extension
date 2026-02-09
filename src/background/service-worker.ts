import type { MacroInfo, PageMeta } from '../shared/types';

/** In-memory state for the current tab */
let currentTabMacros: MacroInfo[] = [];
let currentPageMeta: PageMeta | null = null;

/** Handle messages from content script and popup */
browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case 'macros-detected': {
      currentTabMacros = message.macros;
      currentPageMeta = message.pageMeta;
      // Update badge
      const count = message.macros.length;
      const tabId = sender.tab?.id;
      if (tabId) {
        browser.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
        browser.action.setBadgeBackgroundColor({ color: '#4a90d9', tabId });
      }
      return;
    }

    case 'get-macros': {
      return Promise.resolve({ macros: currentTabMacros, pageMeta: currentPageMeta });
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
      // Proxy Confluence REST API calls
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

// Reset state when tab changes
browser.tabs.onActivated?.addListener(() => {
  currentTabMacros = [];
  currentPageMeta = null;
});

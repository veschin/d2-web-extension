import type { MacroInfo, PageMeta } from '../shared/types';

/** In-memory state for the current tab */
let currentTabMacros: MacroInfo[] = [];
let currentPageMeta: PageMeta | null = null;

/** Handle messages from content script and popup */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'macros-detected': {
      currentTabMacros = message.macros;
      currentPageMeta = message.pageMeta;
      // Update badge
      const count = message.macros.length;
      const tabId = sender.tab?.id;
      if (tabId) {
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#4a90d9', tabId });
      }
      break;
    }

    case 'get-macros': {
      sendResponse({ macros: currentTabMacros, pageMeta: currentPageMeta });
      return true; // async response
    }

    case 'open-editor': {
      // Forward to content script of active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, message);
        }
      });
      break;
    }

    case 'confluence-api': {
      // Proxy Confluence REST API calls
      const { method, url, body } = message;
      fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ?? undefined,
      })
        .then(async (res) => {
          const data = await res.text();
          sendResponse({ type: 'confluence-api-result', status: res.status, data });
        })
        .catch((e) => {
          sendResponse({
            type: 'confluence-api-result',
            status: 0,
            data: (e as Error).message,
          });
        });
      return true; // async response
    }
  }
});

// Reset state when tab changes
chrome.tabs.onActivated?.addListener(() => {
  currentTabMacros = [];
  currentPageMeta = null;
});

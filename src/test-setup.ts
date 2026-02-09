/**
 * Vitest setup file — provides global `browser` mock for tests.
 */

const noop = () => {};
const noopPromise = () => Promise.resolve();
const noopObj = () => Promise.resolve({});

const browserMock = {
  runtime: {
    sendMessage: noopObj,
    onMessage: { addListener: noop, removeListener: noop, hasListener: () => false },
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
  },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage: noopPromise,
    onRemoved: { addListener: noop, removeListener: noop },
  },
  action: {
    setBadgeText: noopPromise,
    setBadgeBackgroundColor: noopPromise,
  },
  storage: {
    session: {
      get: noopObj,
      set: noopPromise,
      remove: noopPromise,
    },
    local: {
      get: noopObj,
      set: noopPromise,
      remove: noopPromise,
    },
  },
};

(globalThis as any).browser = browserMock;
(globalThis as any).chrome = browserMock;

/**
 * The `browser` global is available natively in Firefox MV3.
 * For Chrome MV3, a build-time polyfill (esbuild banner) aliases
 * `globalThis.browser = chrome`, so all code can use `browser.*` uniformly.
 * Type shape comes from @types/chrome.
 */
declare const browser: typeof chrome;

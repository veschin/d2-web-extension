/**
 * Chrome 144+ and Firefox both expose a Promise-based `browser.*` namespace.
 * We reuse the @types/chrome definitions for the type shape.
 */
declare const browser: typeof chrome;

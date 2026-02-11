# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

D2 Diagram Editor for Confluence — a browser extension (Chrome MV3 + Firefox WebExtensions) that lets users edit D2 diagrams directly on Confluence pages without opening the page editor. Single codebase targets both browsers via a `browser.*` → `chrome.*` polyfill.

## Commands

```bash
# Build
npm run build              # Chrome (default target)
npm run build:chrome       # Chrome explicitly
npm run build:firefox      # Firefox

# Dev (watch mode)
npm run dev:chrome         # Rebuild on change
npm run dev:firefox        # Rebuild + launch Firefox via web-ext

# Test
npm test                   # Vitest single run
npm run test:watch         # Vitest watch mode
npm run typecheck          # tsc --noEmit

# Package & lint
npm run package:chrome     # zip dist-chrome/
npm run package:firefox    # web-ext build
npm run lint:firefox       # web-ext lint
npm run clean              # rm dist-chrome/ dist-firefox/
```

Makefile shortcuts: `make firefox`, `make chrome`, `make dev`, `make lint`, `make package`, `make clean`.

## Architecture

### Extension Components

The extension follows the standard WebExtension architecture with five isolated contexts that communicate via `browser.runtime.sendMessage`:

- **Content Script** (`src/content/`) — Injected into Confluence pages. Detects D2 macros in both view and edit modes, renders overlay edit buttons, and hosts the editor modal inside a Shadow DOM for style isolation. Built as IIFE (Firefox requires classic script loading). Entry point `main.ts` imports three side-effect modules: `detector.ts` (macro discovery + storage API fetch), `overlay-buttons.ts` (pencil button injection), and `editor-modal.ts` (the full editor UI — largest file in the codebase).
- **Service Worker** (`src/background/service-worker.ts`) — Message router and proxy. Handles CORS bypass via `proxy-fetch`, Confluence REST API proxying with `credentials: 'include'`, reference library caching, and per-tab macro state in `browser.storage.session`.
- **Popup** (`src/popup/`) — Three tabs: Macros (detected on current page with SVG thumbnails), Settings (server URL, font size), Debug (log viewer with filters). Also provides "New diagram" button and standalone draft management.
- **Options Page** (`src/options/`) — Reference source configuration (Confluence pages containing reusable D2 blocks).
- **Standalone Editor** (`src/standalone/`) — Full-featured D2 editor in a separate browser tab (opened via popup's "New diagram" button), not tied to any Confluence page. Own draft storage (`d2ext-standalone-drafts`, 200-draft soft limit), URL parameter support (`?draft=<id>`), preview zoom/pan, and SVG/PNG export.

### Editor Stack

CodeMirror 6 with D2 language support powered by **web-tree-sitter** (WASM). Tree-sitter initialization is async and cached in a singleton; if WASM loading fails, `d2-parser.ts` falls back to regex-based block extraction. The tree-sitter AST drives syntax highlighting (mapped to CodeMirror CSS classes in `d2-language.ts`) and autocomplete (D2 keywords, shape types, style properties, plus user-defined identifiers extracted from the document). Live linting via `d2-linter.ts` sends code to the server's `/svg` endpoint (1500ms debounce) and maps D2 error responses to CodeMirror diagnostics. The editor factory is in `src/editor/editor-setup.ts` and uses compartment-based dynamic font sizing. Custom drag-n-drop handler accepts `application/x-d2ext-block` MIME type from the reference library panel.

Editor modules in `src/editor/`: `editor-setup.ts` (factory + compartments), `d2-language.ts` (syntax highlighting + autocomplete), `d2-linter.ts` (live error diagnostics), `d2-analyzer.ts` (block metadata enrichment).

### Reference Library

Three-level navigation: Sources → Macros → Blocks. Reference sources are Confluence pages containing reusable D2 blocks. `src/editor/d2-analyzer.ts` enriches blocks with metadata (shape/connection counts, nesting depth, category classification). Library data is cached with 5-minute TTL via `reference-api.ts`. SVG thumbnails lazy-load via IntersectionObserver. A viewer mode shows read-only CodeMirror instances for block inspection.

### Key Data Flows

**Save in view mode**: Fetch page storage via REST API → parse XHTML to find macro by `macro-id` → replace CDATA content → PUT with incremented version (retries on 409 conflict).

**Save in edit mode**: Locate macro's `<table>` in TinyMCE DOM → update `<pre>` textContent → fire input/change events to trigger TinyMCE dirty flag. User must click Publish.

**Live preview**: Code changes debounced 2000ms (500ms for parameter changes) → POST to d2server `/svg` endpoint via `proxy-fetch` → render SVG in preview pane.

### Draft System

Two-tier draft persistence in `editor-prefs.ts`:
- **Confluence macro drafts** — keyed by `macro-id`, 24h TTL, max 50 drafts, 2s debounce auto-save
- **Standalone drafts** — separate storage key (`d2ext-standalone-drafts`), 200-draft soft limit, supports naming and parameter editing

### Shared Modules (`src/shared/`)

- `types.ts` — `MacroInfo`, `MacroParams`, `ExtMessage` (message union type), `PageMeta`, `ReferenceBlock`, `EnrichedBlock`, `BlockMetadata`
- `confluence-api.ts` — REST API wrappers (read/save page storage, parse XHTML macros)
- `d2-server.ts` — D2 server client (`/svg` rendering, `/format` formatting, `/png` export, `checkServerReachable` with 30s cache)
- `d2-parser.ts` — Splits D2 source into top-level blocks (tree-sitter AST primary, regex fallback)
- `d2-keywords.ts` — D2 directive set (used to filter non-shape identifiers in autocomplete/analysis)
- `reference-api.ts` — Reference library fetch/cache (5-minute TTL)
- `extension-settings.ts` — User-configurable D2 server URL
- `logger.ts` — Structured logging with sources, in-memory buffer (500 entries), flush to `browser.storage.session` with 1s debounce, merge strategy to prevent SW/content script overwrites
- `editor-prefs.ts` — Font size, draft persistence (Confluence + standalone)

### Build System

esbuild (`esbuild.config.mjs`) with `BUILD_TARGET` env var (`chrome`/`firefox`). Content script → IIFE, everything else → ESM. WASM files and static assets are copied to `dist-{target}/`. Manifest requires `wasm-unsafe-eval` in CSP for tree-sitter WASM.

## Testing

Vitest with jsdom environment. Tests in `src/**/*.test.ts`. Global `browser` mock in `src/test-setup.ts` stubs all WebExtension APIs. Run a single test file with `npx vitest run src/path/to/file.test.ts`.

## Confluence Page Interaction Pitfalls

### HTML Entity Encoding

Confluence stores macro bodies as CDATA in XHTML storage format. When rendered to DOM, entities go through multiple encoding layers:

- **DOM `textContent`** decodes one layer of entities, but Confluence may double-encode (`&amp;quot;` in storage → `&quot;` in textContent instead of `"`)
- **Always prefer CDATA storage code** over DOM textContent — the detector fetches storage via REST API and uses `storageMacro?.code ?? dm.code` (storage first, DOM fallback)
- **For DOM fallback**, use `decodeHtmlEntities()` in `detector.ts` — it uses the browser's built-in parser (`textarea.innerHTML` → `.value`) which handles ALL entities. Never use manual `.replace()` chains for entity decoding.

### Fetch Credentials & CORS

- **Content script `fetch`** with `credentials: 'include'` works for Confluence REST API — the content script runs on the Confluence page origin, so cookies are sent.
- **Service worker `fetch`** with `credentials: 'same-origin'` does NOT send cookies to Confluence — the service worker runs on `moz-extension://` / `chrome-extension://` origin. Use `proxy-fetch` or `confluence-api` message handlers in the SW for API calls that need auth.
- **`fetchPageMacrosByUrl`** must be called from the content script, not via service worker message, because it needs Confluence session cookies.

### Macro Detection & Index Mapping

- View mode macros: `div.d2-macro` elements with `.d2-code` (code) and `.d2-diagram` (SVG)
- Edit mode macros: `table.wysiwyg-macro[data-macro-name="d2"]` with `pre` in `td.wysiwyg-macro-body`
- DOM macros are mapped to storage macros **by position** (index) to get persistent `macro-id`s
- Empty macros (no code) are kept during mapping to preserve index alignment, then filtered out for the public list

## Browser Compatibility Pitfalls

### Polyfill Pattern

The `browser.*` global is provided via esbuild banner injection (not an imported library). On Chrome, `globalThis.browser = chrome` is injected at bundle time. The type declaration is in `src/shared/globals.d.ts`. Never use `chrome.*` directly in source code.

### Firefox Shadow DOM / Xray Wrappers

Firefox's Xray security wrappers can interfere with `adoptedStyleSheets` on Shadow DOM roots. The workaround is in `editor-setup.ts` — be aware of this when modifying Shadow DOM style injection.

## Key Conventions

- All browser API calls use `browser.*` (never `chrome.*` directly) — see Browser Compatibility Pitfalls above
- Content script ↔ service worker communication uses typed `ExtMessage` union (`src/shared/types.ts`). Note: `proxy-fetch` messages are handled by the service worker but not part of the `ExtMessage` union type
- The editor modal uses Shadow DOM to isolate styles from the host Confluence page
- WASM files (`tree-sitter.wasm`, `tree-sitter-d2.wasm`) live in `assets/` and are declared as web-accessible resources in the manifest
- Tree-sitter initialization is async with regex fallback — see Editor Stack above

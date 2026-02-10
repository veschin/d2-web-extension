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

The extension follows the standard WebExtension architecture with four isolated contexts that communicate via `browser.runtime.sendMessage`:

- **Content Script** (`src/content/`) — Injected into Confluence pages. Detects D2 macros in both view and edit modes, renders overlay edit buttons, and hosts the editor modal inside a Shadow DOM for style isolation. Built as IIFE (Firefox requires classic script loading).
- **Service Worker** (`src/background/service-worker.ts`) — Message router and proxy. Handles CORS bypass via `proxy-fetch`, Confluence REST API proxying with `credentials: 'include'`, reference library caching, and per-tab macro state in `browser.storage.session`.
- **Popup** (`src/popup/`) — Lists detected macros on the current page with SVG thumbnails and parameter badges. Click to open editor.
- **Options Page** (`src/options/`) — Reference source configuration (Confluence pages containing reusable D2 blocks).

### Editor Stack

CodeMirror 6 with D2 language support powered by **web-tree-sitter** (WASM). The tree-sitter AST drives syntax highlighting (mapped to CodeMirror CSS classes in `d2-language.ts`) and autocomplete (D2 keywords, shape types, style properties, plus user-defined identifiers extracted from the document).

### Key Data Flows

**Save in view mode**: Fetch page storage via REST API → parse XHTML to find macro by `macro-id` → replace CDATA content → PUT with incremented version (retries on 409 conflict).

**Save in edit mode**: Locate macro's `<table>` in TinyMCE DOM → update `<pre>` textContent → fire input/change events to trigger TinyMCE dirty flag. User must click Publish.

**Live preview**: Code changes debounced 500ms → POST to d2server `/svg` endpoint via `proxy-fetch` → render SVG in preview pane.

### Shared Modules (`src/shared/`)

- `types.ts` — `MacroInfo`, `MacroParams`, `ExtMessage` (message union type), `PageMeta`, `ReferenceBlock`
- `confluence-api.ts` — REST API wrappers (read/save page storage, parse XHTML macros)
- `d2-server.ts` — D2 server client (`/svg` rendering, `/format` formatting)
- `d2-parser.ts` — Splits D2 source into top-level blocks (for reference library)
- `logger.ts` — Structured logging with sources, in-memory buffer (500 entries), performance timing
- `editor-prefs.ts` — Font size, draft persistence (auto-save, 24h TTL, max 50 drafts)

### Build System

esbuild (`esbuild.config.mjs`) with `BUILD_TARGET` env var (`chrome`/`firefox`). Content script → IIFE, everything else → ESM. WASM files and static assets are copied to `dist-{target}/`.

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

## Key Conventions

- All browser API calls use `browser.*` (never `chrome.*` directly) — the polyfill in `esbuild.config.mjs` handles the alias
- Content script ↔ service worker communication uses typed `ExtMessage` union (`src/shared/types.ts`)
- The editor modal uses Shadow DOM to isolate styles from the host Confluence page
- WASM files (`tree-sitter.wasm`, `tree-sitter-d2.wasm`) live in `assets/` and are declared as web-accessible resources in the manifest

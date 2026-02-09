# d2ext - D2 Diagram Editor for Confluence

## What You Get

- Edit any D2 diagram on a Confluence page without opening the page editor
- Live SVG preview powered by your own d2server, right in the extension modal
- Monaco-based code editor with D2 syntax highlighting and autocomplete
- One-click code formatting via d2server `/format`
- Save directly to Confluence (view mode: REST API, edit mode: TinyMCE DOM
  injection)
- Component library: point to a "reference" page per Confluence space, browse
  reusable D2 blocks as rendered thumbnails, click to copy or insert into editor
- Works in both Chrome and Firefox/Zen simultaneously
- All state cached client-side in the browser; Confluence is the source of truth
- D2 server URL auto-detected from macro parameters, zero config for most cases
- D2 compilation errors shown inline in the editor

---

## How It Works

### The Existing System (cannot be changed)

The Confluence macro (`macro.vtl`) renders D2 diagrams like this:

**View mode DOM:**

```
div.d2-macro
  div.d2-code[style="display:none"]   ← HTML-encoded D2 source
  div.d2-diagram                      ← rendered SVG/PNG
  div.d2-controls                     ← zoom/download buttons
  <script> (IIFE)                     ← client-side rendering logic
```

**Edit mode DOM (TinyMCE):**

```
table.wysiwyg-macro[data-macro-name="d2"]
  [data-macro-id="uuid"]
  [data-macro-body-type="PLAIN_TEXT"]
  tbody > tr > td.wysiwyg-macro-body > pre  ← D2 source
```

**Confluence storage format (XHTML):**

```xml
<ac:structured-macro ac:name="d2" ac:schema-version="1" ac:macro-id="uuid">
  <ac:parameter ac:name="server">https://d2lang.phoenixit.ru</ac:parameter>
  <ac:parameter ac:name="theme">1</ac:parameter>
  <ac:parameter ac:name="layout">elk</ac:parameter>
  ...
  <ac:plain-text-body><![CDATA[a -> b]]></ac:plain-text-body>
</ac:structured-macro>
```

**D2 server API** (CORS enabled, `multipart/form-data`):

- `POST /svg` — render SVG (params: d2, theme, layout, sketch, scale, preset)
- `POST /png` — render PNG
- `POST /format` — format D2 code

**Confluence 7.19.19 REST API** (JSESSIONID cookie, same-origin):

- `GET /rest/api/content/{id}?expand=body.storage,version,ancestors,space` —
  read page
- `PUT /rest/api/content/{id}` — update page (storage representation)
- `GET /rest/api/content/search?cql=...` — search pages by space/title

**Page metadata available from DOM** (verified, no API call needed):

| Meta tag             | Example value                  | Use                                |
| -------------------- | ------------------------------ | ---------------------------------- |
| `ajs-page-id`        | `462329155`                    | Page ID for API calls              |
| `ajs-space-key`      | `RKN`                          | Space key                          |
| `ajs-page-title`     | `тестовая страничка d2`        | Page title (required for PUT)      |
| `ajs-page-version`   | `5`                            | Current version number             |
| `ajs-parent-page-id` | `404856953`                    | Direct parent page                 |
| `ajs-base-url`       | `https://kb-liga.phoenixit.ru` | Base URL for API                   |
| `ajs-atl-token`      | `797b4ea...`                   | CSRF token (may be needed for PUT) |
| `ajs-draft-id`       | `462329160`                    | Draft ID                           |
| `ajs-edit-mode`      | `collaborative`                | Synchrony is active                |

**GET body.storage** (verified from real instance):

```xml
<ac:structured-macro ac:name="d2" ac:schema-version="1"
    ac:macro-id="bab2a33c-c164-4ca5-a57c-dff8bce77d12">
  <ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter>
  <ac:plain-text-body><![CDATA[j_a -> j_b -> py_d]]></ac:plain-text-body>
</ac:structured-macro>
```

- `ac:macro-id` is **persistent** — same ID in both editor and storage formats
- D2 code is in `<![CDATA[...]]>` — no HTML escaping needed
- Macro params (theme, layout, etc.) are `<ac:parameter>` elements

**GET version object** (verified — NO `syncRev` in response):

```json
{
  "number": 5,
  "minorEdit": false,
  "hidden": false,
  "when": "2026-02-09T11:40:30.640+03:00"
}
```

`syncRev` from the captured curl is a Synchrony client-side value, not from REST
API. Extension doesn't need it.

**Note**: Confluence UI uses `body.editor` representation with `syncRev` for
saving. Our extension uses `body.storage` instead — simpler, documented, and
avoids Synchrony dependency. Needs verification via test PUT (see Phase 7.5).

### The Extension Architecture

```
Browser Extension
├── Content Script (injected into Confluence pages)
│   ├── Macro Detector — finds all div.d2-macro (view) / table[data-macro-name=d2] (edit)
│   ├── Overlay Buttons — adds pencil icon near each macro
│   └── Editor Modal — Monaco editor + SVG preview injected into page DOM
│
├── Service Worker (background)
│   ├── Confluence API proxy — handles REST calls with session cookies
│   ├── State cache — chrome.storage.local (page states, preferences, references)
│   └── Badge — shows macro count on extension icon
│
├── Popup (browser action)
│   ├── Macro list — all D2 macros on current page, click to open editor
│   └── Reference library — browse/search/copy reusable components
│
└── Options Page
    ├── D2 server URL (auto-detected, overridable)
    ├── Confluence URL patterns
    ├── Reference sources config (per space: page title + macro index)
    └── Editor preferences
```

### Key Technical Decisions

| Decision             | Choice                                                               | Rationale                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor               | Monaco Editor                                                        | Same as official D2 Playground; rich API for tokenizer, completions, error markers                                                                                                                         |
| D2 syntax            | Custom Monarch tokenizer + tree-sitter grammar (D2 has official one) | Monarch for highlighting, tree-sitter for AST-based features like block extraction                                                                                                                         |
| Preview rendering    | d2server (not WASM)                                                  | Lighter extension, server already deployed, CORS enabled                                                                                                                                                   |
| Cross-browser        | webextension-polyfill                                                | Single codebase, Manifest V3 Chrome + WebExtensions Firefox                                                                                                                                                |
| Save (view mode)     | Confluence REST API with editor representation                       | GET body.editor → parse TinyMCE HTML → find `<table data-macro-name="d2">` by index → update `<pre>` → PUT with `representation: "editor"`                                                                 |
| Save (edit mode)     | Direct TinyMCE DOM manipulation                                      | Modify `<pre>` in macro body → trigger change event → user clicks Publish                                                                                                                                  |
| Macro identification | Persistent `macro-id` from API + user selection from list            | `macro-id` (e.g., `bab2a33c-...`) is persistent across both editor and storage formats in GET responses. View mode DOM lacks IDs, so match by position → then use macro-id from API for reliable targeting |
| Reference parsing    | D2 text parser (top-level block extraction)                          | Split by top-level entities using brace counting; tree-sitter for post-MVP                                                                                                                                 |
| Caching              | chrome.storage.local                                                 | Page states, reference library data, user preferences; Confluence as source of truth                                                                                                                       |

### Feasibility Notes

**Proven feasible:**

- Macro detection in both DOM modes (selectors confirmed from example HTML)
- D2 code extraction from `.d2-code` textContent / `pre` textContent
- d2server rendering via fetch (CORS `*` enabled)
- Confluence REST API from extension (same-origin cookies)
- Monaco Editor in content script injected modal

**Risks with mitigations:**

- **View mode save race condition**: if someone else edits simultaneously,
  version conflict (409). Mitigation: refetch + retry with conflict
  notification.
- **Storage format PUT verified**: tested on real instance (PUT 200, version
  5→6). Minimal payload works: `type` + `title` + `version.number` +
  `body.storage`. No `syncRev`, no `ancestors`, no CSRF header needed.
- **Macro-id reliability**: verified that `ac:macro-id` is persistent across
  editor/storage formats and GET requests. Risk: macro-id might change if macro
  is deleted and re-inserted. Mitigation: validate CDATA content before saving.
- **Monaco bundle size (~2MB)**: acceptable for power-user developer tool.
- **No ready-made D2 Monaco language**: must build custom Monarch tokenizer. D2
  has an official tree-sitter grammar (`tree-sitter-d2`) which can be used for
  proper parsing.
- **CSRF protection**: `ajs-atl-token` available in DOM. May need
  `X-Atlassian-Token: nocheck` header for PUT. Needs testing.

**Out of scope for MVP:**

- Real-time collaboration
- Client-side WASM rendering (deferred; use d2server)
- SVG element → D2 source line mapping (deferred; use block-level references)
- Modifying the macro.vtl

---

## Implementation Plan

### Phase 0: Project Scaffold

- [ ] Initialize npm project with TypeScript (strict mode)
- [ ] Configure esbuild bundler for extension output
- [ ] Set up webextension-polyfill
- [ ] Create `manifest.json` (Chrome MV3) and `manifest.firefox.json`
- [ ] Build script outputs `dist-chrome/` and `dist-firefox/`
- [ ] Git init, `.gitignore`
- [ ] Project structure:

```
d2ext/
  src/
    content/detector.ts          # Macro detection
    content/editor-modal.ts      # Monaco editor modal
    content/overlay-buttons.ts   # Edit buttons on macros
    background/service-worker.ts # API proxy, cache, state
    popup/popup.html + popup.ts  # Macro list, ref library
    options/options.html + .ts   # Settings
    shared/confluence-api.ts     # REST API wrapper
    shared/d2-parser.ts          # D2 block parser
    shared/d2-server.ts          # D2 server wrapper
    shared/storage.ts            # chrome.storage helpers
    shared/types.ts              # TypeScript interfaces
    editor/monaco-setup.ts       # Monaco config
    editor/d2-language.ts        # D2 Monarch tokenizer + completions
  assets/icons/                  # 16, 48, 128px
  assets/editor.css              # Modal styles
```

### Phase 1: Macro Detection & Overlay

- [ ] Content script activates on configured Confluence URL patterns
- [ ] Scan DOM for `div.d2-macro` (view mode) and
      `table.wysiwyg-macro[data-macro-name="d2"]` (edit mode)
- [ ] Extract D2 source: `.d2-code` textContent (view) /
      `td.wysiwyg-macro-body pre` textContent (edit)
- [ ] Extract d2server URL from macro's inline `<script>` (regex for
      `fetch('URL/svg'`) or from `data-macro-parameters`
- [ ] Extract params: theme, layout, scale, sketch, direction, preset
- [ ] On first detection: `GET /rest/api/content/{pageId}?expand=body.storage`
      to read persistent `ac:macro-id` for each D2 macro
- [ ] Map DOM macros (by position) → storage macros (by position) → extract
      `ac:macro-id` for each
- [ ] Store mapping: `{ domIndex, macroId, code, params }` per macro
- [ ] Inject subtle pencil icon button near each detected macro
- [ ] MutationObserver for dynamically loaded macros
- [ ] Send detected macros with macro-ids to service worker for state tracking

### Phase 2: Extension Popup (Macro List)

- [ ] Show list of all D2 macros on current active tab
- [ ] Each item: index number, first line preview, param badges (theme, layout)
- [ ] Click item → send message to content script → open editor modal
- [ ] Settings gear → open options page
- [ ] "No macros found" empty state

### Phase 3: Editor Modal (Core)

- [ ] Inject modal overlay into page DOM from content script
- [ ] Split pane: left = Monaco Editor (60%), right = SVG preview (40%)
- [ ] Monaco setup:
  - [ ] Register D2 language with Monarch tokenizer (keywords: shape, style,
        class, classes, direction, label, icon, near, tooltip, link, constraint,
        width, height, grid-columns, grid-rows, grid-gap)
  - [ ] Register completion provider: D2 keywords, shape types (rectangle,
        cylinder, queue, document, c4-person, step, etc.), style properties,
        direction values
  - [ ] Dark/light theme
  - [ ] Line numbers, bracket matching, auto-indent
- [ ] Load selected macro's D2 code into editor
- [ ] Preview: POST to d2server `/svg` → render SVG in preview pane
- [ ] Auto-preview on 500ms debounced input change
- [ ] Format button: POST to `/format` → replace editor content
- [ ] Error display: show d2server compilation errors below preview pane (red
      text)
- [ ] Macro params panel: display current theme/layout/scale, allow editing
- [ ] Save button (triggers Phase 4 logic)
- [ ] Cancel button with unsaved changes confirmation
- [ ] Keyboard: Ctrl+S save, Ctrl+Shift+F format, Escape close
- [ ] Modal draggable via header, resizable via edges

### Phase 4: Save Mechanism

**Edit mode path:**

- [ ] Locate macro's `<table>` element by `data-macro-id` or positional index
- [ ] Set `td.wysiwyg-macro-body pre` textContent to new D2 code
- [ ] Fire `input` and `change` events on TinyMCE iframe's document for dirty
      detection
- [ ] Show notification: "Saved to editor. Click Publish to persist."

**View mode path (storage representation):**

- [ ] Read metadata from DOM: `ajs-page-id`, `ajs-space-key`, `ajs-page-title`,
      `ajs-page-version`
- [ ] `GET /rest/api/content/{pageId}?expand=body.storage,version,ancestors,space`
      (via service worker)
- [ ] Parse `body.storage.value`: find all `<ac:structured-macro ac:name="d2">`
      with regex or DOMParser
- [ ] Match target macro by `ac:macro-id` (persistent ID, same macro-id as
      identified during detection)
- [ ] Initial macro-id mapping: match DOM `.d2-macro` elements (by position) to
      storage macros (by position), store the `ac:macro-id` for each
- [ ] Validate: compare CDATA content with original code from `.d2-code` div
- [ ] Replace `<ac:plain-text-body><![CDATA[NEW_D2_CODE]]></ac:plain-text-body>`
      (no HTML escaping needed — CDATA is raw)
- [ ] PUT `/rest/api/content/{pageId}` with body:
  ```json
  {
    "type": "page",
    "title": pageTitle,
    "version": { "number": currentVersion + 1, "minorEdit": true },
    "body": {
      "storage": {
        "value": updatedStorageXhtml,
        "representation": "storage"
      }
    }
  }
  ```
- [ ] No extra headers needed — JSESSIONID cookie is sufficient (verified)
- [ ] Handle version conflict (409): refetch, re-match by macro-id, retry once
- [ ] On success: re-render diagram by POSTing to d2server and updating
      `.d2-diagram` innerHTML
- [ ] Show success/error toast notification

### Phase 5: Options Page

- [ ] D2 server URL (text input, auto-populated from first detected macro)
- [ ] Confluence base URL (text input, auto-populated from current tab)
- [ ] URL match patterns for content script activation (list of patterns)
- [ ] Reference library sources (see Phase 7):
  - Per space: add multiple reference pages, each with selectable macros
  - Config UI: `{ spaceKey, pages: [{ pageTitle, macroIndices[], label }] }`
- [ ] Editor settings: theme toggle, font size slider, auto-preview checkbox
- [ ] Cache: "Clear all cached data" button, show cache size

### Phase 6: Service Worker (Background)

- [ ] Message handler: `{ type: 'confluence-api', method, url, body }` → fetch
      with cookies
- [ ] Message handler: `{ type: 'get-state', pageId }` → return cached page
      state
- [ ] Message handler: `{ type: 'set-state', pageId, macros }` → persist to
      chrome.storage
- [ ] Message handler: `{ type: 'get-references', spaceKey }` → return cached
      refs
- [ ] Update badge text with macro count when active tab changes
- [ ] Extension icon states: colored (macros found), gray (no macros)

### Phase 7: Reference Library

- [ ] In options: configure reference sources per Confluence space:
  - Multiple reference pages per space (e.g., "DB Components", "Service
    Templates", "Queue Patterns")
  - Each page may have multiple D2 macros; user selects which macros to include
  - Config model:
    `{ spaceKey, pages: [{ pageTitle, macroIndices: number[], label }] }`
- [ ] Fetch flow: `CQL search` → get page → parse editor HTML → extract `<pre>`
      content from selected macros
- [ ] D2 text parser (`d2-parser.ts`):
  - Split source into top-level blocks by tracking brace depth
  - Identify: standalone shapes (`name: { ... }`), connections (`a -> b`), class
    definitions (`classes: { ... }`), containers (shapes with nested children)
  - Return:
    `{ name: string, type: 'shape'|'connection'|'class'|'container', code: string }[]`
- [ ] Popup reference library tab:
  - Grid of reference blocks
  - Each block: name label + code preview (monospace, 3-4 lines) + rendered SVG
    thumbnail
  - SVG thumbnails: batch-render each block via d2server `/svg` (with preset for
    default-styles)
  - Click: copy D2 code to clipboard + visual confirmation
  - If editor modal open: "Insert at cursor" button
  - Search/filter input by block name
  - Refresh button to re-fetch from Confluence
- [ ] Cache in chrome.storage.local:
      `{ spaceKey, pages: [{ title, blocks, thumbnails(base64) }], fetchedAt }`
- [ ] Auto-refresh if cache older than 1 hour (configurable TTL)

### ~~Phase 7.5~~ DONE: Save Mechanism Verified on Real Instance

All confirmed via live test (PUT status 200, version 5→6):

- [x] `body.storage` with `representation: "storage"` works
- [x] No `syncRev` needed
- [x] No `ancestors` field needed
- [x] No `space` field needed
- [x] No `X-Atlassian-Token` header needed — JSESSIONID cookie is sufficient
- [x] `minorEdit: true` accepted
- [x] Minimal PUT payload that works:
  ```json
  {
    "type": "page",
    "title": "page title from data.title",
    "version": { "number": currentVersion + 1, "minorEdit": true },
    "body": { "storage": { "value": "updated XHTML", "representation": "storage" } }
  }
  ```
- [x] CDATA replacement works: regex replace on
      `<ac:plain-text-body><![CDATA[...]]></ac:plain-text-body>`
- [ ] Still untested: version conflict (409) handling, `minorEdit` notification
      suppression

### Phase 8: State Management

- [ ] Page state model:
      `{ pageId, url, macros: [{ index, code, params, hash, lastModified }] }`
- [ ] On page load: detect macros → compare with cached state → flag external
      changes
- [ ] "Modified externally" badge on macros whose code differs from cached
      version
- [ ] Reference cache uses content hash for efficient conditional refresh
- [ ] Preferences synced via `chrome.storage.sync` (cross-device)

### Phase 9: Polish

- [ ] Empty state: "No D2 macros on this page" with explanation
- [ ] d2server unreachable: allow code editing, show preview error, retry button
- [ ] Large diagrams: scrollable preview pane with zoom
- [ ] Session expiry (401): notification "Please log into Confluence and retry"
- [ ] Responsive modal (min 800x500, adapts to viewport)
- [ ] Keyboard navigation throughout
- [ ] First-run onboarding: prompt for Confluence URL if not detected

---

## Verification Plan

### Manual Testing

- [ ] Install in Chrome → popup appears, icon shows
- [ ] Install in Firefox/Zen → popup appears, icon shows
- [ ] Navigate to Confluence page with D2 macros → macros detected, pencil icons
      shown
- [ ] Click pencil → editor modal opens with correct D2 code
- [ ] Type code → preview auto-updates with SVG
- [ ] Click Format → code reformatted
- [ ] Introduce syntax error → error shown inline
- [ ] Save (edit mode) → `<pre>` content updated, Confluence shows unsaved
      changes
- [ ] Save (view mode) → REST API updates page, diagram re-renders
- [ ] Configure reference source → references fetched and displayed
- [ ] Click reference block → code copied to clipboard
- [ ] Insert reference into editor → code appears at cursor
- [ ] Reload page → cached state restored
- [ ] Disconnect d2server → editing works, preview shows error
- [ ] Let Confluence session expire → 401 handled with message

### Automated Tests

- [ ] `d2-parser.ts`: unit tests for block extraction (shapes, connections,
      containers, classes)
- [ ] `confluence-api.ts`: unit tests for XHTML macro parsing and CDATA
      replacement
- [ ] `detector.ts`: unit tests against sample HTML (view + edit mode fixtures
      from example files)
- [ ] Integration: content script injection on `conf-example-page.html` and
      `conf-editing-example.html`

---

## Post-MVP Roadmap

1. **tree-sitter-d2 integration** for proper AST-based autocomplete,
   go-to-definition, and reference parsing (D2 has an official tree-sitter
   grammar)
2. **`@terrastruct/d2` WASM rendering** for offline preview (no d2server
   dependency)
3. **SVG element → source mapping** via D2 AST for click-on-diagram editing
4. **Diff view** before saving (show what changed)
5. **Cross-space references** in the library
6. **D2 import statement** support across macros on same page
7. **Bulk operations**: format all macros, export all diagrams

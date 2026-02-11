# Build Instructions

## Requirements

- OS: Linux, macOS, or Windows (WSL)
- Node.js: 18+
- npm: 9+
- GNU Make

## Steps

```bash
npm ci
make firefox
```

Output is produced in `dist-firefox/` directory. The packaged extension ZIP is created in the project root as `d2_diagram_editor_for_confluence-<version>.zip`.

## What the build does

1. `npm run build:firefox` — bundles TypeScript source with esbuild, copies static assets (HTML, CSS, WASM, fonts, icons) to `dist-firefox/`
2. `npm run lint:firefox` — runs `web-ext lint` validation
3. `npm run package:firefox` — runs `web-ext build` to create the final ZIP

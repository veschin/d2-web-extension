import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const target = process.env.BUILD_TARGET || 'chrome';
const watch = process.env.WATCH === '1';
const outdir = `dist-${target}`;

const entryPoints = [
  'src/content/detector.ts',
  'src/content/overlay-buttons.ts',
  'src/content/editor-modal.ts',
  'src/content/status-bar.ts',
  'src/background/service-worker.ts',
  'src/popup/popup.ts',
];

const buildOptions = {
  entryPoints,
  bundle: true,
  outdir,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  define: {
    'process.env.BUILD_TARGET': JSON.stringify(target),
  },
  // web-tree-sitter has Node.js-only code paths behind dynamic imports.
  // Mark them as external so esbuild doesn't try to bundle them.
  external: ['fs/promises', 'module'],
};

async function build() {
  // Build JS
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log(`Watching for changes (${target})...`);
  } else {
    await esbuild.build(buildOptions);
  }

  // Copy static assets
  mkdirSync(`${outdir}/assets`, { recursive: true });

  // Unified manifest for both Chrome and Firefox
  cpSync('manifest.json', `${outdir}/manifest.json`);
  cpSync('src/popup/popup.html', `${outdir}/popup.html`);
  cpSync('src/popup/popup.css', `${outdir}/popup.css`);
  cpSync('src/content/content.css', `${outdir}/content.css`);

  // Copy icons if they exist
  try {
    cpSync('assets/icons', `${outdir}/assets/icons`, { recursive: true });
  } catch {}

  // Copy WASM files for tree-sitter
  try {
    cpSync('assets/tree-sitter.wasm', `${outdir}/assets/tree-sitter.wasm`);
    cpSync('assets/tree-sitter-d2.wasm', `${outdir}/assets/tree-sitter-d2.wasm`);
  } catch {}

  // Copy web-tree-sitter runtime WASM from node_modules
  try {
    cpSync('node_modules/web-tree-sitter/web-tree-sitter.wasm', `${outdir}/assets/web-tree-sitter.wasm`);
  } catch {}

  console.log(`Built for ${target} → ${outdir}/`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

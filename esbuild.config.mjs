import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

const target = process.env.BUILD_TARGET || 'chrome';
const watch = process.env.WATCH === '1';
const outdir = `dist-${target}`;

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  define: {
    'process.env.BUILD_TARGET': JSON.stringify(target),
  },
  external: ['fs/promises', 'module'],
};

// Content scripts — IIFE (Firefox loads them as classic scripts, not modules)
const contentBuild = {
  ...shared,
  entryPoints: ['src/content/main.ts'],
  outfile: `${outdir}/content/main.js`,
  format: 'iife',
};

// Background + popup — ESM (loaded as modules)
const pagesBuild = {
  ...shared,
  entryPoints: [
    'src/background/service-worker.ts',
    'src/popup/popup.ts',
    'src/options/options.ts',
  ],
  outdir,
  format: 'esm',
};

async function build() {
  if (watch) {
    const [ctxContent, ctxPages] = await Promise.all([
      esbuild.context(contentBuild),
      esbuild.context(pagesBuild),
    ]);
    await Promise.all([ctxContent.watch(), ctxPages.watch()]);
    console.log(`Watching for changes (${target})...`);
  } else {
    await Promise.all([
      esbuild.build(contentBuild),
      esbuild.build(pagesBuild),
    ]);
  }

  // Copy static assets
  mkdirSync(`${outdir}/assets`, { recursive: true });

  cpSync('manifest.json', `${outdir}/manifest.json`);
  cpSync('src/popup/popup.html', `${outdir}/popup.html`);
  cpSync('src/popup/popup.css', `${outdir}/popup.css`);
  cpSync('src/content/content.css', `${outdir}/content.css`);
  cpSync('src/options/options.html', `${outdir}/options.html`);
  cpSync('src/options/options.css', `${outdir}/options.css`);

  try {
    cpSync('assets/icons', `${outdir}/assets/icons`, { recursive: true });
  } catch {}

  try {
    cpSync('assets/tree-sitter.wasm', `${outdir}/assets/tree-sitter.wasm`);
    cpSync('assets/tree-sitter-d2.wasm', `${outdir}/assets/tree-sitter-d2.wasm`);
  } catch {}

  try {
    cpSync('node_modules/web-tree-sitter/web-tree-sitter.wasm', `${outdir}/assets/web-tree-sitter.wasm`);
  } catch {}

  console.log(`Built for ${target} → ${outdir}/`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

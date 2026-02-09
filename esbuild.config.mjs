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
  'src/background/service-worker.ts',
  'src/popup/popup.ts',
];

const buildOptions = {
  entryPoints,
  bundle: true,
  outdir,
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  define: {
    'process.env.BUILD_TARGET': JSON.stringify(target),
  },
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

  const manifestSrc = target === 'firefox'
    ? 'manifest.firefox.json'
    : 'manifest.json';
  cpSync(manifestSrc, `${outdir}/manifest.json`);
  cpSync('src/popup/popup.html', `${outdir}/popup.html`);
  cpSync('src/popup/popup.css', `${outdir}/popup.css`);
  cpSync('src/content/content.css', `${outdir}/content.css`);

  // Copy icons if they exist
  try {
    cpSync('assets/icons', `${outdir}/assets/icons`, { recursive: true });
  } catch {}

  console.log(`Built for ${target} → ${outdir}/`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Post-build step: copy non-TS runtime assets into dist/.
 *
 * The symbol extractor and relation extractor read `.scm` tree-sitter query
 * files via readFileSync(join(__dirname, 'queries', <file>)). At runtime
 * __dirname is dist/parser/, so we must mirror src/parser/queries/** into
 * dist/parser/queries/ or every grammar silently returns zero symbols.
 *
 * Without this step vitest still passes (tests run the .ts sources where
 * the queries ARE co-located), but `node dist/index.js` is broken.
 */
import { readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const ASSET_DIRS = [
  'src/parser/queries',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

let copied = 0;
for (const rel of ASSET_DIRS) {
  const srcDir = join(root, rel);
  const distDir = join(root, rel.replace(/^src/, 'dist'));
  for (const abs of walk(srcDir)) {
    const target = join(distDir, relative(srcDir, abs));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(abs, target);
    copied += 1;
  }
}
process.stdout.write(`[copy-assets] copied ${copied} asset file(s)\n`);

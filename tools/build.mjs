/**
 * Build the static site for a deployment.
 *
 * The repo's pages are the pages that ship — that has been true since step 1
 * and stays true. This does two things to them and nothing else:
 *
 *   stamps the API base into a <meta> tag, so config.js does not have to guess
 *   removes the demo backend from a live build
 *
 * That second one matters. demo-data.js and demo-backend.js are 195 KB of a
 * fictional school. In a live deployment they are never reached — api.js
 * honours the mode with no fallback — but shipping them means a school
 * downloads another school's records to never look at, and it means one bad
 * config away from showing them.
 *
 *   node tools/build.mjs                       # live, same-origin /api
 *   node tools/build.mjs --api https://api.example.com/api
 *   node tools/build.mjs --demo                # the marketing demo
 *   node tools/build.mjs --out dist
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ONLY_SCRIPTS } from './shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};

const OUT   = String(flag('--out', 'dist'));
const DEMO  = argv.includes('--demo');
const API   = flag('--api', process.env.SHULE_API_BASE || null);

/** Everything that ships. Tooling, tests and dev scripts do not. */
const INCLUDE_DIRS  = ['assets', 'app'];
const SKIP_DIRS     = new Set(['node_modules', '.git', 'test', 'tools', 'dev', 'docs', OUT]);
const SKIP_FILES    = new Set(['package.json', 'package-lock.json', '.gitignore']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => {
  const rel = path.relative(ROOT, f);
  if (SKIP_FILES.has(rel)) return false;
  if (rel.startsWith('.')) return false;
  const top = rel.split(path.sep)[0];
  return INCLUDE_DIRS.includes(top) || (!rel.includes(path.sep) && /\.(html|txt|ico|png|svg|webmanifest)$/.test(rel));
});

fs.rmSync(path.join(ROOT, OUT), { recursive: true, force: true });

let pages = 0, stripped = 0;
for (const src of files) {
  const rel = path.relative(ROOT, src);
  const dst = path.join(ROOT, OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });

  if (!rel.endsWith('.html')) {
    // The demo bundle itself is not copied into a live build.
    if (!DEMO && DEMO_ONLY_SCRIPTS.some((d) => rel === d.split('/').join(path.sep))) continue;
    fs.copyFileSync(src, dst);
    continue;
  }

  let html = fs.readFileSync(src, 'utf8');
  const depth = rel.split(path.sep).length - 1;

  if (!DEMO) {
    for (const demoSrc of DEMO_ONLY_SCRIPTS) {
      const withDepth = '../'.repeat(depth) + demoSrc;
      const before = html;
      html = html.replace(`<script src="${withDepth}"></script>\n`, '')
                 .replace(`<script src="${withDepth}"></script>`, '');
      if (html !== before) stripped++;
    }
  }

  const meta = [];
  if (API) meta.push(`<meta name="shule-api-base" content="${API}">`);
  if (DEMO) meta.push('<script>window.SHULE_FORCE_DEMO=true;</script>');
  if (meta.length) {
    // Before every script, so config.js sees it.
    html = html.replace(/<\/head>/i, `  ${meta.join('\n  ')}\n</head>`);
  }

  fs.writeFileSync(dst, html);
  pages++;
}

const size = walk(path.join(ROOT, OUT))
  .reduce((n, f) => n + fs.statSync(f).size, 0);

console.log(`${OUT}/  ${pages} pages · ${(size / 1024).toFixed(0)} KB` +
            (DEMO ? ' · demo build' : ` · live${API ? ' → ' + API : ', same-origin /api'}`));
if (!DEMO) console.log(`      demo bundle removed from ${stripped} script tags`);

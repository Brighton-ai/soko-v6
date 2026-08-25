/**
 * Routes that can never be reached, because an earlier route with a path
 * parameter in the same position matches them first.
 *
 * FastAPI matches in declaration order. GET /school/{school_id}/students is
 * declared before GET /school/transport/students, so a request for the second
 * is handled by the first with school_id="transport" — which answers 422
 * "Input should be a valid UUID", not 404. The route is unreachable and
 * nothing says so.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run from anywhere: these tools are called from both repos.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const routes = JSON.parse(execFileSync('python3', ['dev/routes.py', '--json'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

const seg = (p) => p.split('/').filter(Boolean);
const isParam = (s) => s.startsWith('{') && s.endsWith('}');

const shadowed = [];
routes.forEach((later, i) => {
  const ls = seg(later.path);
  for (let j = 0; j < i; j++) {
    const earlier = routes[j];
    if (earlier.method !== later.method) continue;
    const es = seg(earlier.path);
    if (es.length !== ls.length) continue;
    // earlier matches later when every earlier segment is either the same
    // literal or a parameter that would swallow the later one's literal
    let masks = false;
    for (let k = 0; k < es.length; k++) {
      if (es[k] === ls[k]) { masks = true; continue; }
      if (isParam(es[k]) && !isParam(ls[k])) { masks = true; continue; }
      masks = false; break;
    }
    if (masks && earlier.path !== later.path) {
      shadowed.push({ later, earlier });
      break;
    }
  }
});

if (!shadowed.length) { console.log('No unreachable routes.'); process.exit(0); }
console.log(`${'═'.repeat(78)}\nUNREACHABLE ROUTES  (${shadowed.length})\n${'═'.repeat(78)}`);
for (const s of shadowed) {
  console.log(`\n  ${s.later.method} ${s.later.path}`);
  console.log(`      ${s.later.file}:${s.later.func}`);
  console.log(`      swallowed by  ${s.earlier.method} ${s.earlier.path}  (${s.earlier.func}, declared earlier)`);
}
console.log(`\n${shadowed.length} route(s) can never be reached.`);
process.exit(1);

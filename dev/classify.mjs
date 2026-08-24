/** Buckets a live contract run into RULE / ROUTE / TRANSPORT. */
import fs from 'node:fs';
const txt = fs.readFileSync(process.argv[2] || '/tmp/live4.txt', 'utf8');
const tail = txt.includes('failing tests:') ? txt.split('failing tests:').pop() : txt;
const blocks = tail.split(/\n(?=✖ \[RULES)/).filter((b) => b.startsWith('✖ [RULES'));

const ROUTE = /has no route in school\.py/;
const TRANSPORT = [
  /Cannot reach the school system/, /did not answer within/,
  /Cannot read properties of undefined/, /Method Not Allowed/,
  /Field required/, /Input should be/, /is not a function/,
  /Not found\b/, /That was not accepted/,
  // a field the response simply does not carry under that name is a shape
  // mismatch in our adapter, not a rule the backend failed to enforce
  /starts at undefined/, /ends undefined/, /undefined, not 0/
];

const buckets = { RULE: [], ROUTE: [], TRANSPORT: [] };
for (const b of blocks) {
  const name = (b.match(/✖ (\[RULES row \d+\][^\n(]*)/) || [,'?'])[1].trim();
  const msg = (b.match(/(?:AssertionError \[ERR_ASSERTION\]: |Error: )([\s\S]{0,400})/) || [,''])[1]
    .split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ');
  let bucket = 'RULE';
  if (ROUTE.test(b)) bucket = 'ROUTE';
  else if (TRANSPORT.some((re) => re.test(msg))) bucket = 'TRANSPORT';
  buckets[bucket].push({ name, msg: msg.slice(0, 220) });
}
for (const k of ['RULE', 'ROUTE', 'TRANSPORT']) {
  console.log(`\n${'═'.repeat(72)}\n${k}  (${buckets[k].length})\n${'═'.repeat(72)}`);
  buckets[k].forEach((f) => console.log(`\n  ${f.name}\n      ${f.msg}`));
}
console.log(`\n\nRULE ${buckets.RULE.length} · ROUTE ${buckets.ROUTE.length} · TRANSPORT ${buckets.TRANSPORT.length}`);
fs.writeFileSync('dev/live-buckets.json', JSON.stringify(buckets, null, 2));

/**
 * A read-only window onto journal_lines, for contract runs only.
 *
 * school.py writes the general ledger and never exposes it, so rule 4 ("every
 * payment posts a balanced double entry") has nothing to read. This serves the
 * table and nothing else — no writes, no auth, bound to localhost.
 *
 *     node dev/gl-server.mjs &        # :8090
 *     SHULE_GL_URL=http://localhost:8090/gl npm run test:live
 */
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const PSQL = process.env.PSQL || '/usr/lib/postgresql/18/bin/psql';
const DB = process.env.DATABASE_URL || 'postgresql://shule@127.0.0.1:55432/sokoos';
const PORT = Number(process.env.GL_PORT) || 8090;

http.createServer((req, res) => {
  if (!req.url.startsWith('/gl')) { res.writeHead(404).end('{}'); return; }
  let rows = [];
  try {
    const out = execFileSync(PSQL, [DB, '-t', '-A', '-F', '\t', '-c',
      'SELECT COALESCE(debit,0), COALESCE(credit,0) FROM journal_lines'], { encoding: 'utf8' }).trim();
    rows = out ? out.split('\n').map((l) => {
      const [debit, credit] = l.split('\t').map(Number);
      return { debit, credit, side: debit > 0 ? 'debit' : 'credit', amount: debit > 0 ? debit : credit };
    }) : [];
  } catch (e) { /* empty ledger reads as empty, not as an error */ }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows));
}).listen(PORT, '127.0.0.1', () => console.log(`GL read-only on :${PORT}`));

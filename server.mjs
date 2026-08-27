/**
 * The static server for the deployed site.
 *
 * Serves the build produced by tools/build.mjs, and — when SHULE_API_ORIGIN is
 * set — proxies /api to the backend.
 *
 * The proxy is the point. With it, the site and the API share one origin: no
 * CORS, no second domain for a school to trust, no third-party-cookie problem,
 * and config.js's default of `location.origin + '/api'` is simply correct. On
 * Railway the backend can stay on the private network and never be exposed.
 *
 *   PORT               the port to listen on          (Railway sets this)
 *   SHULE_API_ORIGIN   e.g. http://backend.railway.internal:8000
 *   SHULE_DIR          what to serve                  (default: dist)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DIR  = path.resolve(ROOT, process.env.SHULE_DIR || 'dist');
const PORT = Number(process.env.PORT || 8080);
const API_ORIGIN = (process.env.SHULE_API_ORIGIN || '').replace(/\/$/, '');

if (!fs.existsSync(DIR)) {
  console.error(`Nothing to serve: ${DIR} does not exist. Run: node tools/build.mjs`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

/**
 * Headers every response carries.
 *
 * The CSP is deliberately tight and deliberately not 'unsafe-inline' for
 * scripts: every script this site runs is a file on disk, so an injected
 * inline <script> has no business executing. Styles keep 'unsafe-inline'
 * because the pages carry a few inline style attributes.
 */
function secure(res, isHtml) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (isHtml) {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'"
    ].join('; '));
  }
}

function proxy(req, res) {
  const target = API_ORIGIN + req.url;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['accept-encoding'];   // let node handle the body verbatim

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        redirect: 'manual'
      });
      res.statusCode = upstream.status;
      upstream.headers.forEach((v, k) => {
        if (['content-encoding', 'transfer-encoding', 'connection'].includes(k)) return;
        res.setHeader(k, v);
      });
      secure(res, false);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      // The school system being unreachable is not the browser's fault, and
      // the page has a message for exactly this shape of answer.
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        detail: 'The school system is not reachable from the web server.',
        error: 'upstream_unreachable'
      }));
      console.error('proxy failed:', req.method, req.url, e.message);
    }
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  if (url === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('ok');
  }

  if (API_ORIGIN && (url === '/api' || url.startsWith('/api/'))) return proxy(req, res);

  // No traversal above the build directory, whatever the path says.
  let rel = path.normalize(url).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(DIR, rel);
  if (!file.startsWith(DIR)) { res.statusCode = 403; return res.end('Forbidden'); }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';

  if (!fs.existsSync(file)) {
    const notFound = path.join(DIR, '404.html');
    res.statusCode = 404;
    secure(res, true);
    res.setHeader('Content-Type', TYPES['.html']);
    return res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound)
      : '<!doctype html><meta charset="utf-8"><title>Not found</title>' +
        '<p>That page does not exist. <a href="/">Go to the start</a>.</p>');
  }

  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html';
  secure(res, isHtml);
  res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
  // Assets are unhashed, so they are revalidated rather than held. HTML is
  // never cached: a stale page pointing at a changed script is how a school
  // ends up running half of one release and half of another.
  res.setHeader('Cache-Control', isHtml ? 'no-cache' : 'public, max-age=300, must-revalidate');
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Shule serving ${DIR} on :${PORT}` +
              (API_ORIGIN ? ` · /api → ${API_ORIGIN}` : ' · no API proxy (SHULE_API_ORIGIN unset)'));
});

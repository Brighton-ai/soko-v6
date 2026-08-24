'use strict';
/**
 * Contract-test harness.
 *
 * Every test in test/contract/ asserts a RULE, not a rendering, and must run
 * unchanged against either backend:
 *
 *     SHULE_BACKEND=demo npm run test:contract    (default, no server)
 *     SHULE_BACKEND=live npm run test:contract    (against a running FastAPI)
 *
 * Tests here talk to assets/js/api.js and nothing else. They never import
 * demo-backend.js and never call _store(): a test that needs the store is a
 * unit test and belongs in test/app.test.js. That restriction is the whole
 * point — it is what makes the same assertion meaningful against production.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const MODE = (process.env.SHULE_BACKEND || 'demo').toLowerCase();
const BASE_URL = process.env.SHULE_API_URL || 'http://localhost:8000/api';
const SCHOOL = process.env.SHULE_SCHOOL_ID || 'sch-riverside';

if (!['demo', 'live'].includes(MODE)) {
  throw new Error(`SHULE_BACKEND must be "demo" or "live", got "${MODE}".`);
}

/** A sessionStorage good enough for the demo store, per context. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

function loadInto(sandbox, relFile) {
  const src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
  vm.runInContext(src, sandbox, { filename: relFile });
}

/**
 * A fresh API surface. Demo mode gets a clean store every time so tests do not
 * inherit each other's writes; live mode returns a client pointed at FastAPI.
 */
function openAPI() {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Intl, Math, Date, JSON,
    structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder,
    fetch: typeof fetch === 'function' ? fetch : undefined,
    AbortController, Error, TypeError,
    SHULE_API_LATENCY: 0,
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    location: { href: BASE_URL, pathname: '/', search: '' }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  if (MODE === 'live') {
    sandbox.SHULE_API_BASE = BASE_URL;
    sandbox.SHULE_API_TOKEN = process.env.SHULE_API_TOKEN || null;
    loadInto(sandbox, 'assets/js/live-backend.js');
    sandbox.SHULE_BACKEND = sandbox.ShuleLiveBackend;
  } else {
    loadInto(sandbox, 'assets/js/data/demo-data.js');
    loadInto(sandbox, 'assets/js/demo-backend.js');
  }
  loadInto(sandbox, 'assets/js/api.js');
  return sandbox.ShuleAPI;
}

/**
 * Tags a contract test with the rule it enforces, so a live failure names the
 * rule and the line in school.py that does not enforce it.
 */
function rule(row, title, note) {
  const suffix = note ? ` — ${note}` : '';
  return `[RULES row ${row}] ${title}${suffix}`;
}

/** Appended to every contract assertion message. */
function because(row, where) {
  return `\n    Rule: docs/RULES_RECONCILED.md row ${row}` +
         (where ? `\n    Backend: ${where}` : '') +
         `\n    Backend under test: ${MODE}` +
         (MODE === 'live' ? `\n    A failure here is a production gap, not a broken test.` : '');
}

module.exports = { openAPI, MODE, BASE_URL, SCHOOL, rule, because };

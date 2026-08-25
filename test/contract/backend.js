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
const EMAIL = process.env.SEED_EMAIL || 'contract@shule.test';
const PASSWORD = process.env.SEED_PASSWORD || 'ContractTest!2026-local-only';
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
    // a token from a file goes stale in minutes; log in for each context
    sandbox.SHULE_API_TOKEN = LIVE_TOKEN || process.env.SHULE_API_TOKEN || null;
    sandbox.SHULE_GL_URL = process.env.SHULE_GL_URL || null;
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

/**
 * A fresh JWT. school.py issues short-lived access tokens, so a token captured
 * at seed time is expired by the time a long suite reaches its later files.
 * Call this once before the suite runs.
 */
let LIVE_TOKEN = null;
async function authenticate() {
  if (MODE !== 'live') return null;
  const res = await fetch(BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!res.ok) {
    throw new Error(`Contract harness could not log in as ${EMAIL}: ${res.status} ${await res.text()}\n` +
      'Run `node dev/seed-live.mjs` first, or set SEED_EMAIL / SEED_PASSWORD.');
  }
  const body = await res.json();
  LIVE_TOKEN = body.access_token || (body.data && body.data.access_token);
  if (!LIVE_TOKEN) throw new Error('Login returned no access token: ' + JSON.stringify(body).slice(0, 200));
  return LIVE_TOKEN;
}

module.exports = { openAPI, MODE, BASE_URL, SCHOOL, rule, because, authenticate };

/**
 * Fixture discovery.
 *
 * Contract tests must not hardcode demo ids — `cls-g4e` means nothing to a live
 * backend, and a test that fails on an unrecognised id is reporting a fixture
 * problem dressed up as a rule failure. Everything a test needs is discovered
 * through the API, once, and cached.
 */
let FIXTURES = null;
async function fixtures(API) {
  if (FIXTURES) return FIXTURES;
  const schoolId = SCHOOL;
  const [classes, exams, scales] = await Promise.all([
    API.listClasses(schoolId, {}).catch(() => []),
    API.listExamRows(schoolId, {}).catch(() => []),
    API.listGradingScaleRows(schoolId, {}).catch(() => [])
  ]);
  const list = (v) => (Array.isArray(v) ? v : (v && v.items) || []);
  const cls = list(classes);
  const exam = list(exams);
  let subjects = [], teachers = [], structures = [];
  try { subjects = list(await API.listSubjects(schoolId, {})); } catch (e) { subjects = []; }
  try { teachers = list(await API.listTeachers(schoolId, {})); } catch (e) { teachers = []; }
  try { structures = list(await API.listFeeStructures(schoolId, {})); } catch (e) { structures = []; }

  FIXTURES = {
    schoolId,
    classId: cls[0] && (cls[0].id),
    classId2: cls[1] && (cls[1].id),
    classes: cls,
    subjectId: subjects[0] && subjects[0].id,
    subjects,
    // prefer an exam that already has marks; otherwise the first one
    examId: (exam.filter((e) => e.result_count > 0)[0] || exam[0] || {}).id,
    exams: exam,
    scales: list(scales),
    teachers,
    teacherId: teachers[0] && teachers[0].id,
    teacherId2: (teachers[1] || teachers[0] || {}).id,
    verifierId: (teachers[teachers.length - 1] || teachers[0] || {}).id,
    structures,
    structureId: structures[0] && structures[0].id
  };
  return FIXTURES;
}
function resetFixtures() { FIXTURES = null; }

module.exports.fixtures = fixtures;
module.exports.resetFixtures = resetFixtures;

'use strict';
/**
 * Shule marketing site — structural, link, theme, accessibility and budget checks.
 *
 * Every assertion carries a message that explains what broke in plain words,
 * because whoever reads this output may not have the repo in front of them.
 */
const { test, describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

/**
 * tools/shell.mjs is ESM and this suite is CommonJS, so it comes in through a
 * dynamic import in a root before-hook. Importing it is the point: the drift
 * test generates the shell from its actual source and compares that to what is
 * stamped in every page, which comparing pages to each other never could.
 */
let SHELL_GEN = null;
before(async () => { SHELL_GEN = await import('../tools/shell.mjs'); });

const ROOT = path.resolve(__dirname, '..');

const PAGES = ['index.html', 'features.html', 'pricing.html', 'contact.html', 'login.html'];

/** Pages under app/. The shell is written into each file, not rendered by JS. */
const APP_PAGES = [
  'app/dashboard.html', 'app/students.html', 'app/student.html',
  'app/invoices.html', 'app/payments.html', 'app/defaulters.html',
  'app/waivers.html', 'app/fee-structures.html', 'app/settings.html',
  'app/grading-scales.html', 'app/attendance.html', 'app/exams.html',
  'app/results.html', 'app/report-cards.html',
  'app/teacher/dashboard.html', 'app/teacher/register.html',
  'app/teacher/marks.html', 'app/teacher/timetable.html',
  'app/parent/index.html', 'app/parent/fees.html', 'app/parent/attendance.html',
  'app/parent/results.html', 'app/parent/messages.html'
];

/** The tokenised guardian surface. No shell, no nav, no login — its own rules. */
const PORTAL_PAGE = 'portal.html';

/** Pages built by steps 3 and 4. None may still be marked as unbuilt anywhere. */
const BUILT_PAGES = [
  'students.html', 'student.html', 'invoices.html', 'payments.html',
  'defaulters.html', 'waivers.html', 'fee-structures.html',
  'grading-scales.html', 'attendance.html', 'exams.html',
  'results.html', 'report-cards.html'
];

/**
 * What an href="#" may declare. "6" is the FastAPI wiring; "later" means the
 * module is planned but not scheduled. Marking Boarding as "step 6" would
 * claim step 6 builds it, which is worse than admitting it is unscheduled.
 */
const FUTURE_STEPS = ['6', 'later'];

/** Every page in the repo, marketing and app alike. */
const ALL_PAGES = [...PAGES, ...APP_PAGES];

/** Nothing is allowed to dangle any more — app/dashboard.html exists as of step 2. */
const ALLOWED_MISSING = new Set([]);

/**
 * The fifteen palette values. Nothing outside this list may enter the CSS.
 * --green-soft is a canonical token like the rest; --green-ink, --red-soft and
 * --red-ink are the pill inks and live in STATUS_PILL_SHADES below.
 */
const PALETTE = {
  '--orange': '#F4731E',
  '--orange-600': '#DC5F0E',
  '--orange-soft': '#FDEBDD',
  '--orange-tint': '#FDF6F0',
  '--ink': '#141417',
  '--ink-2': '#33333B',
  '--body': '#63656E',
  '--body-2': '#8A8C94',
  '--line': '#EBE6E0',
  '--line-2': '#DFD9D2',
  '--paper': '#FCFAF8',
  '--cream': '#FCF6F0',
  '--green': '#2F9E6B',
  '--green-soft': '#E9F5EF',
  '--red': '#E5484D',
};

/** Black, white, and the shades that exist only inside status pills. */
const STATUS_PILL_SHADES = ['#1F7A51', '#FDECEC', '#B4373B'];
const EXTRA_ALLOWED_HEX = ['#FFFFFF', '#000000', ...STATUS_PILL_SHADES];

const MODULE_IDS = [
  'students', 'fees', 'attendance', 'exams', 'report-cards', 'grading', 'timetable',
  'teachers', 'communication', 'library', 'transport', 'boarding', 'discipline', 'transfers',
];

const CONTACT_FIELDS = [
  'school', 'name', 'role', 'email', 'phone', 'pupils', 'current-system', 'message',
];

const LOGIN_ROLES = ['admin', 'teacher', 'parent'];

// ── helpers ────────────────────────────────────────────────────────────────

const abs = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(abs(p));
const readFile = (p) => fs.readFileSync(abs(p), 'utf8');

const rawCache = new Map();
const domCache = new Map();

function raw(page) {
  if (!rawCache.has(page)) rawCache.set(page, readFile(page));
  return rawCache.get(page);
}
function load(page) {
  if (!domCache.has(page)) domCache.set(page, cheerio.load(raw(page)));
  return domCache.get(page);
}

function cssFiles() {
  const dir = abs('assets/css');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => `assets/css/${f}`);
}

/** #abc -> #AABBCC, #aabbcc -> #AABBCC. Returns null for anything else. */
function normalizeHex(h) {
  const v = h.replace('#', '').trim();
  if (v.length === 3) return '#' + v.split('').map((c) => c + c).join('').toUpperCase();
  if (v.length === 6) return '#' + v.toUpperCase();
  if (v.length === 8) return '#' + v.slice(0, 6).toUpperCase(); // #RRGGBBAA
  return null;
}

/** Resolves a page-relative reference against the directory the page lives in. */
function resolveFrom(page, ref) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(page), ref)).replace(/^\.\//, '');
}

/** Splits an href into { file, hash }, ignoring external and non-navigational schemes. */
function parseHref(href) {
  if (!href) return null;
  const h = href.trim();
  if (/^(https?:|mailto:|tel:|javascript:|data:|#$)/i.test(h) || h === '') return null;
  const i = h.indexOf('#');
  const file = i === -1 ? h : h.slice(0, i);
  const hash = i === -1 ? '' : h.slice(i + 1);
  return { file, hash, raw: h };
}

/** Every href on a page, with the element's text for a legible failure message. */
function hrefsOf(page) {
  const $ = load(page);
  const out = [];
  $('a[href]').each((_, el) => {
    const parsed = parseHref($(el).attr('href'));
    if (parsed) out.push({ ...parsed, text: $(el).text().trim().slice(0, 40) || '(no text)' });
  });
  return out;
}

/** Pulls one shell region out of a page as raw markup. */
function shellOf(page, selector) {
  const $ = load(page);
  const el = $(selector).first();
  return el.length ? $.html(el) : '';
}

/** Strips per-page state so drift means real drift, not the current-page marker. */
function normaliseShell(markup) {
  return markup
    .replace(/\s*aria-current="[^"]*"/g, '')
    .replace(/\s*class="([^"]*)"/g, (m, cls) => {
      const kept = cls.split(/\s+/).filter((c) => c && c !== 'is-on').join(' ');
      return kept ? ` class="${kept}"` : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where two shells first diverge, so the failure message is actionable. */
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i >= a.length && i >= b.length) return '';
  return ` — first difference at character ${i}: expected "…${a.slice(Math.max(0, i - 30), i + 40)}…" but found "…${b.slice(Math.max(0, i - 30), i + 40)}…"`;
}

/** Source with comments removed, so a scan does not match a file's own prose. */
function codeOf(file) {
  return readFile(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** Reads one role's group list straight out of shell.js. */
function roleGroups(source, role) {
  const m = source.match(new RegExp(`${role}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function headingRanks(page) {
  const $ = load(page);
  const out = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    out.push({ level: Number(el.tagName[1]), text: $(el).text().trim().replace(/\s+/g, ' ').slice(0, 48) });
  });
  return out;
}

// ── suites ─────────────────────────────────────────────────────────────────

describe('Structure', () => {
  for (const page of PAGES) {
    describe(page, () => {
      it('exists in the repo root', () => {
        assert.ok(exists(page), `${page} is missing from the repo root — the site is expected to ship all of: ${PAGES.join(', ')}`);
      });

      it('has exactly one <h1>', () => {
        const n = load(page)('h1').length;
        assert.equal(n, 1, `${page} has ${n} <h1> elements; a page must have exactly one so screen readers and search engines get a single page title. Found: ${headingRanks(page).filter((h) => h.level === 1).map((h) => `"${h.text}"`).join(', ') || 'none'}`);
      });

      it('has a non-empty <title>', () => {
        const t = load(page)('title').first().text().trim();
        assert.ok(t.length > 0, `${page} has no <title>, or it is empty — the browser tab and every search result will be blank.`);
      });

      it('has a meta description of 50–160 characters', () => {
        const d = load(page)('meta[name="description"]').attr('content');
        assert.ok(d !== undefined, `${page} has no <meta name="description"> tag.`);
        const len = d.trim().length;
        assert.ok(len >= 50 && len <= 160, `${page} meta description is ${len} characters; it must be 50–160 so search engines show it whole. Current text: "${d.trim()}"`);
      });

      it('declares lang="en" on <html>', () => {
        const lang = load(page)('html').attr('lang');
        assert.equal(lang, 'en', `${page} has lang="${lang ?? 'unset'}" on <html>; it must be "en" so assistive technology picks the right pronunciation.`);
      });
    });
  }
});

describe('Links', () => {
  /**
   * Hrefs are resolved relative to the page that carries them, so a link from
   * app/dashboard.html to ../index.html lands on index.html and not on a file
   * that never existed. The fragment is split off and checked against the
   * TARGET page, which is what catches features.html#exams going stale.
   */
  it('every .html link points at a file that exists', () => {
    const broken = [];
    for (const page of ALL_PAGES) {
      for (const link of hrefsOf(page)) {
        if (!link.file || !link.file.endsWith('.html')) continue;
        const target = resolveFrom(page, link.file);
        if (ALLOWED_MISSING.has(target)) continue;
        if (!exists(target)) broken.push(`${page}: "${link.text}" -> ${link.raw} (resolves to ${target}, which does not exist)`);
      }
    }
    assert.deepEqual(broken, [], `Broken page links found:\n  ${broken.join('\n  ')}`);
  });

  it('every in-page #anchor resolves to an element on that same page', () => {
    const broken = [];
    for (const page of ALL_PAGES) {
      const $ = load(page);
      for (const link of hrefsOf(page)) {
        if (link.file !== '' || !link.hash) continue;
        if ($(`#${CSS_ESCAPE(link.hash)}`).length === 0) {
          broken.push(`${page}: "${link.text}" -> #${link.hash} (no element with that id on ${page})`);
        }
      }
    }
    assert.deepEqual(broken, [], `In-page anchors pointing at nothing:\n  ${broken.join('\n  ')}`);
  });

  it('every cross-page #anchor resolves to an element on the target page', () => {
    const broken = [];
    for (const page of ALL_PAGES) {
      for (const link of hrefsOf(page)) {
        if (!link.file || !link.hash || !link.file.endsWith('.html')) continue;
        const target = resolveFrom(page, link.file);
        if (ALLOWED_MISSING.has(target) || !exists(target)) continue;
        const $t = load(target);
        if ($t(`#${CSS_ESCAPE(link.hash)}`).length === 0) {
          broken.push(`${page}: "${link.text}" -> ${link.raw} (${target} has no element with id="${link.hash}")`);
        }
      }
    }
    assert.deepEqual(broken, [], `Cross-page anchors pointing at nothing:\n  ${broken.join('\n  ')}`);
  });

  it('every stylesheet and script src resolves to a file that exists', () => {
    const broken = [];
    for (const page of ALL_PAGES) {
      const $ = load(page);
      $('link[rel="stylesheet"], script[src]').each((_, el) => {
        const ref = $(el).attr('href') || $(el).attr('src');
        if (!ref || /^(https?:|data:|\/\/)/i.test(ref)) return;
        const target = resolveFrom(page, ref);
        if (!exists(target)) broken.push(`${page}: ${ref} (resolves to ${target}, which does not exist)`);
      });
    }
    assert.deepEqual(broken, [], `Asset references pointing at nothing:\n  ${broken.join('\n  ')}`);
  });

  it('login.html hands off to the app shell, and the app shell now exists', () => {
    assert.ok(raw('login.html').includes('app/dashboard.html'),
      'login.html no longer references app/dashboard.html — a successful sign-in should hand off to the app shell.');
    assert.ok(exists('app/dashboard.html'),
      'app/dashboard.html is missing. Step 1 allowed this link to dangle; as of step 2 the page is built and the exception is gone.');
    assert.equal(ALLOWED_MISSING.size, 0,
      `Nothing should be exempt from the link check any more, but the allow-list still holds: ${[...ALLOWED_MISSING].join(', ')}`);
  });

  it('every unbuilt destination names a future step rather than being silently dead', () => {
    const bad = [];
    for (const page of ALL_PAGES) {
      const $ = load(page);
      $('a[href="#"]').each((_, el) => {
        const step = $(el).attr('data-step');
        const label = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 40) || '(no text)';
        if (!FUTURE_STEPS.includes(step)) {
          bad.push(`${page}: "${label}" has href="#" but data-step="${step ?? 'unset'}" — an unbuilt link must declare when it arrives (${FUTURE_STEPS.join(' or ')})`);
        }
      });
    }
    assert.deepEqual(bad, [], `Dead links that do not declare themselves:\n  ${bad.join('\n  ')}`);
  });

  it('nothing is still marked for a step that has already shipped', () => {
    const stale = [];
    for (const page of ALL_PAGES) {
      const $ = load(page);
      $('[data-step="3"], [data-step="4"], [data-step="5"]').each((_, el) => {
        const step = $(el).attr('data-step');
        stale.push(`${page}: "${$(el).text().trim().replace(/\s+/g, ' ').slice(0, 40)}" is still marked data-step="${step}"`);
      });
    }
    assert.deepEqual(stale, [], `These items point at a step that is already done:\n  ${stale.join('\n  ')}`);
  });

  it('every built page is reachable from the sidebar', () => {
    const $ = load('app/dashboard.html');
    const hrefs = $('.side .navg a').toArray().map((el) => $(el).attr('href'));
    // student.html is reached from a row on students.html, not from the nav
    const navPages = BUILT_PAGES.filter((p) => p !== 'student.html');
    const missing = navPages.filter((p) => !hrefs.includes(p));
    assert.deepEqual(missing, [], `Built pages with no sidebar link: ${missing.join(', ')}. Sidebar has: ${hrefs.filter(Boolean).join(', ')}`);
  });

  it('every live sidebar link points at a page that exists, and the rest declare a step', () => {
    const $ = load('app/dashboard.html');
    const links = $('.side .navg a').toArray().map((el) => ({
      text: $(el).text().replace(/step\s*\d/i, '').trim(),
      href: $(el).attr('href'),
      step: $(el).attr('data-step')
    }));
    const live = links.filter((l) => l.href !== '#');
    assert.ok(live.length >= 12, `The sidebar has ${live.length} live destinations; steps 3 and 4 should have opened up at least twelve.`);
    const dangling = live.filter((l) => !exists(`app/${l.href}`)).map((l) => `${l.text} -> ${l.href}`);
    assert.deepEqual(dangling, [], `Sidebar links pointing at pages that do not exist: ${dangling.join(', ')}`);
    const unmarked = links.filter((l) => l.href === '#' && !FUTURE_STEPS.includes(l.step)).map((l) => l.text);
    assert.deepEqual(unmarked, [], `Sidebar items with no future-step marker: ${unmarked.join(', ')}`);
  });
});

// cheerio's selector engine wants ids escaped when they contain punctuation
function CSS_ESCAPE(id) {
  return id.replace(/([^\w-])/g, '\\$1');
}

describe('Theme integrity', () => {
  it('assets/css/theme.css exists', () => {
    assert.ok(exists('assets/css/theme.css'), 'assets/css/theme.css is missing — the shared theme was supposed to be extracted out of index.html.');
  });

  it('defines all fifteen palette custom properties with the exact values', () => {
    const css = readFile('assets/css/theme.css');
    const wrong = [];
    for (const [prop, value] of Object.entries(PALETTE)) {
      const m = css.match(new RegExp(`${prop}\\s*:\\s*([^;}]+)`));
      if (!m) { wrong.push(`${prop} is not defined at all`); continue; }
      const got = m[1].trim();
      if (normalizeHex(got) !== normalizeHex(value)) wrong.push(`${prop} is "${got}", expected ${value}`);
    }
    assert.deepEqual(wrong, [], `theme.css palette does not match the fixed palette:\n  ${wrong.join('\n  ')}`);
  });

  it('contains no hex colour outside the palette, #fff, #000 and the status-pill inks', () => {
    const allowed = new Set([
      ...Object.values(PALETTE).map(normalizeHex),
      ...EXTRA_ALLOWED_HEX.map(normalizeHex),
    ]);
    const offenders = [];
    for (const file of cssFiles()) {
      const css = readFile(file);
      css.split('\n').forEach((line, i) => {
        const found = line.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        for (const hex of found) {
          const norm = normalizeHex(hex);
          if (norm && !allowed.has(norm)) {
            offenders.push(`${file}:${i + 1} uses ${hex} — not in the palette. Line: ${line.trim().slice(0, 90)}`);
          }
        }
      });
    }
    assert.deepEqual(offenders, [], `Off-palette colours found in CSS. Orange is the only accent; green and red are for status pills only.\n  ${offenders.join('\n  ')}`);
  });

  it('routes the status-pill shades through the pill classes only', () => {
    const css = readFile('assets/css/theme.css');
    for (const shade of STATUS_PILL_SHADES) {
      assert.ok(new RegExp(shade, 'i').test(css), `Status-pill shade ${shade} is no longer defined in theme.css — the pill styles depend on it.`);
    }
  });
});

describe('Shared shell', () => {
  for (const page of PAGES) {
    describe(page, () => {
      it('links assets/css/theme.css', () => {
        const found = load(page)('link[rel="stylesheet"]').toArray().map((el) => load(page)(el).attr('href'));
        assert.ok(found.includes('assets/css/theme.css'), `${page} does not link assets/css/theme.css. Stylesheets found: ${found.join(', ') || 'none'}`);
      });

      it('loads assets/js/site.js', () => {
        const found = load(page)('script[src]').toArray().map((el) => load(page)(el).attr('src'));
        assert.ok(found.includes('assets/js/site.js'), `${page} does not load assets/js/site.js, so the sticky nav, mobile drawer and reveal animations will not run. Scripts found: ${found.join(', ') || 'none'}`);
      });

      it('has no inline <style> block', () => {
        const blocks = load(page)('style').toArray().map((el) => load(page)(el).html().trim());
        const total = blocks.reduce((n, b) => n + b.length, 0);
        assert.equal(total, 0, `${page} carries ${blocks.length} inline <style> block(s) totalling ${total} characters. All CSS belongs in assets/css/ so the palette stays enforceable.`);
      });

      it('carries the logo mark', () => {
        const $ = load(page);
        assert.ok($('.logo').length >= 1, `${page} has no element with class "logo" — the Shule wordmark is part of the shared shell on every page.`);
        assert.ok($('.logo .logo__m svg').length >= 1, `${page} has a .logo but no .logo__m svg inside it — the orange graduation-cap mark is missing.`);
      });

      it('carries the primary nav with a link to every top-level page', () => {
        const $ = load(page);
        const nav = $('header.nav .nav__links');
        assert.equal(nav.length, 1, `${page} has ${nav.length} "header.nav .nav__links" elements; the shared header must appear exactly once.`);
        const hrefs = nav.find('a').toArray().map((el) => $(el).attr('href'));
        for (const target of ['index.html', 'features.html', 'pricing.html', 'contact.html']) {
          assert.ok(hrefs.includes(target), `${page} nav is missing a link to ${target}. Nav links found: ${hrefs.join(', ') || 'none'}`);
        }
      });

      it('marks the current page in the nav', () => {
        const $ = load(page);
        // The drawer mirrors the nav on mobile, so only the desktop bar is counted here.
        const current = $('header.nav .nav__links a[aria-current="page"], header.nav .nav__right a[aria-current="page"]');
        assert.equal(current.length, 1, `${page} has ${current.length} links in the header bar marked aria-current="page"; exactly one should be flagged as the page you are on.`);
        assert.equal(current.attr('href'), page, `${page} marks "${current.attr('href')}" as the current nav item, but the current page is ${page}.`);
      });

      it('mirrors the current page in the mobile drawer', () => {
        const $ = load(page);
        const inDrawer = $('#drawer a[aria-current="page"]');
        const inNav = $('header.nav .nav__links a[href="' + page + '"]').length > 0;
        if (inNav) {
          assert.equal(inDrawer.length, 1, `${page} nav marks the current page but the mobile drawer does not — the drawer should mirror the desktop bar.`);
        }
      });

      it('carries the mobile drawer and its burger button', () => {
        const $ = load(page);
        assert.equal($('#burger').length, 1, `${page} is missing the #burger button, so the mobile menu cannot be opened.`);
        assert.equal($('#drawer').length, 1, `${page} is missing the #drawer element that the burger button toggles.`);
      });

      it('carries the ticker bar', () => {
        assert.equal(load(page)('.ticker').length, 1, `${page} is missing the .ticker announcement bar that sits above the header on every page.`);
      });

      it('carries the footer', () => {
        const $ = load(page);
        assert.equal($('footer.foot').length, 1, `${page} is missing <footer class="foot"> — the shared footer belongs on every page.`);
        assert.ok($('footer.foot a').length >= 8, `${page} footer has only ${$('footer.foot a').length} links; the shared footer carries the product, module, company and legal columns.`);
      });
    });
  }
});

describe('App shell', () => {
  it('at least one page exists under app/', () => {
    assert.ok(APP_PAGES.length >= 1, 'No pages found under app/ — step 2 builds app/dashboard.html.');
    for (const page of APP_PAGES) {
      assert.ok(exists(page), `${page} is listed as an app page but the file is missing.`);
    }
  });

  for (const page of APP_PAGES) {
    describe(page, () => {
      it('has exactly one <h1>, a title and a description', () => {
        const $ = load(page);
        assert.equal($('h1').length, 1, `${page} has ${$('h1').length} <h1> elements; exactly one is expected.`);
        assert.ok($('title').first().text().trim().length > 0, `${page} has an empty <title>.`);
        const d = ($('meta[name="description"]').attr('content') || '').trim();
        assert.ok(d.length >= 50 && d.length <= 160, `${page} meta description is ${d.length} characters; it must be 50–160.`);
        assert.equal($('html').attr('lang'), 'en', `${page} must declare lang="en".`);
      });

      it('links theme.css and app.css and loads the data layer in order', () => {
        const $ = load(page);
        // pages nested under app/ climb further; the prefix is derived, not assumed
        const up = '../'.repeat(page.split('/').length - 1);
        const css = $('link[rel="stylesheet"]').toArray().map((el) => $(el).attr('href'));
        for (const want of [`${up}assets/css/theme.css`, `${up}assets/css/app.css`]) {
          assert.ok(css.includes(want), `${page} does not link ${want}. Stylesheets found: ${css.join(', ') || 'none'}`);
        }
        const js = $('script[src]').toArray().map((el) => $(el).attr('src'));
        for (const want of [`${up}assets/js/data/demo-data.js`, `${up}assets/js/demo-backend.js`,
                            `${up}assets/js/api.js`, `${up}assets/js/shell.js`]) {
          assert.ok(js.includes(want), `${page} does not load ${want}. Scripts found: ${js.join(', ') || 'none'}`);
        }
        assert.ok(js.indexOf(`${up}assets/js/data/demo-data.js`) < js.indexOf(`${up}assets/js/demo-backend.js`),
          `${page} loads demo-backend.js before demo-data.js; the backend throws if the seed is not there yet.`);
        assert.ok(js.indexOf(`${up}assets/js/demo-backend.js`) < js.indexOf(`${up}assets/js/api.js`),
          `${page} loads api.js before demo-backend.js; api.js resolves its adapter at load time.`);
        assert.ok(js.indexOf(`${up}assets/js/api.js`) < js.indexOf(`${up}assets/js/shell.js`),
          `${page} loads shell.js before api.js; the shell reads the school name through the API.`);
      });

      it('has no inline <style> or inline <script> block', () => {
        const $ = load(page);
        const styles = $('style').toArray().reduce((n, el) => n + $(el).html().trim().length, 0);
        assert.equal(styles, 0, `${page} carries ${styles} characters of inline CSS. All CSS belongs in assets/css/ so the palette stays enforceable.`);
        const inline = $('script:not([src])').toArray().reduce((n, el) => n + $(el).html().trim().length, 0);
        assert.equal(inline, 0, `${page} carries ${inline} characters of inline JS. All behaviour belongs in assets/js/.`);
      });

      it('writes the shell into the markup rather than rendering it with JS', () => {
        const $ = load(page);
        assert.equal($('aside.side').length, 1, `${page} has no <aside class="side"> in the served HTML — the sidebar must be static markup, not JS-rendered.`);
        assert.equal($('header.top').length, 1, `${page} has no <header class="top"> in the served HTML — the topbar must be static markup.`);
        // each role's nav is its own list, so the count is read from that role's map
        const role = $('#sidenav').attr('data-nav-role');
        assert.ok(role, `${page} does not declare data-nav-role on #sidenav, so nothing says which nav was stamped.`);
        const expected = SHELL_GEN.ROLE_NAV[role].length;
        assert.equal($('.side .navg[data-group]').length, expected,
          `${page} stamps ${$('.side .navg[data-group]').length} nav groups but ROLE_NAV.${role} has ${expected}.`);
      });

      it('declares a role on <body>', () => {
        const role = load(page)('body').attr('data-role');
        assert.ok(role, `${page} <body> has no data-role attribute; the shell needs it to gate the sidebar.`);
      });

      it('carries the full topbar', () => {
        const $ = load(page);
        assert.equal($('#sidetoggle').length, 1, `${page} is missing the mobile menu button (#sidetoggle).`);
        assert.equal($('[data-bind="school-name"]').length >= 1, true, `${page} topbar does not show the school name.`);
        assert.equal($('#app-search').length, 1, `${page} topbar has no search input.`);
        assert.equal($('#notifs').length, 1, `${page} topbar has no notification button.`);
        assert.equal($('#notif-dot').length, 1, `${page} notification button has no unread dot.`);
        assert.equal($('#usermenu').length, 1, `${page} topbar has no user menu.`);
        assert.ok($('#usermenu [data-bind="user-name"]').length >= 1, `${page} user menu does not show a name.`);
        assert.ok($('#usermenu [data-bind="user-role"]').length >= 1, `${page} user menu does not show a role.`);
      });

      it('carries the toast host and the sidebar scrim', () => {
        const $ = load(page);
        assert.equal($('#toasts').length, 1, `${page} has no #toasts host, so nothing can report the result of an action.`);
        assert.equal($('#toasts').attr('aria-live'), 'polite', `${page} #toasts is not an aria-live region; toasts would be silent to a screen reader.`);
        assert.equal($('#sidescrim').length, 1, `${page} has no #sidescrim backdrop for the mobile drawer.`);
      });
    });
  }

  /**
   * The shell is duplicated into every page under app/, and there is no build
   * step. Two things can go wrong, and this covers both:
   *
   *   1. pages diverge from each other — a hand edit to one of them;
   *   2. every page stays identical while all of them drift from the generator
   *      — someone edits tools/shell.mjs and forgets to restamp.
   *
   * Comparing pages to each other catches (1) and is blind to (2), which is why
   * the generator is imported and run here rather than trusted.
   */
  it('every page matches the shell tools/shell.mjs generates for it', () => {
    const drifted = [];
    for (const page of APP_PAGES) {
      const rel = page.replace(/^app\//, '');
      const html = raw(page);
      const { changed } = SHELL_GEN.restamp(rel, html);
      if (changed) drifted.push(rel);
    }
    assert.deepEqual(drifted, [],
      `These pages do not match tools/shell.mjs:\n  ${drifted.join('\n  ')}\n` +
      'Run `node tools/shell.mjs` to restamp them, or `--check` to see it in CI.');
  });

  it('the generator knows about every page that exists under app/', () => {
    const onDisk = SHELL_GEN.appPages().map((p) => `app/${p}`).sort();
    const listed = APP_PAGES.slice().sort();
    assert.deepEqual(onDisk, listed,
      `The generator walks [${onDisk.join(', ')}] but the test list is [${listed.join(', ')}]. ` +
      'A page missing from either side is a page nothing checks.');
  });

  it('the sidebar is byte-identical across pages built for the same role', () => {
    const byRole = {};
    for (const page of APP_PAGES) {
      const $ = load(page);
      const role = $('#sidenav').attr('data-nav-role') || 'admin';
      (byRole[role] = byRole[role] || []).push({ page, markup: normaliseShell(shellOf(page, 'aside.side')) });
    }
    const drifted = [];
    for (const [role, pages] of Object.entries(byRole)) {
      const first = pages[0];
      for (const p of pages.slice(1)) {
        if (p.markup !== first.markup) {
          drifted.push(`${p.page} differs from ${first.page} (both ${role})${firstDiff(first.markup, p.markup)}`);
        }
      }
    }
    assert.deepEqual(drifted, [], `The sidebar has drifted within a role:\n  ${drifted.join('\n  ')}`);
  });

  it('the topbar is identical across every page in app/, allowing for depth', () => {
    // A link out of app/teacher/ has to climb one more level than the same
    // link in app/, so the hrefs legitimately differ by their ../ prefix and
    // nothing else. Those prefixes are collapsed before comparing, which keeps
    // the drift protection: any other difference still fails.
    const depthless = (m) => m.replace(/(?:\.\.\/)+/g, '');
    const shells = APP_PAGES.map((p) => ({
      page: p, markup: depthless(normaliseShell(shellOf(p, 'header.top')))
    }));
    const first = shells[0];
    const drifted = shells.slice(1)
      .filter((s) => s.markup !== first.markup)
      .map((s) => `${s.page} differs from ${first.page}${firstDiff(first.markup, s.markup)}`);
    assert.deepEqual(drifted, [], `The topbar has drifted between pages in app/:\n  ${drifted.join('\n  ')}`);
  });

  it('every page in app/ links to settings at the right depth', () => {
    const wrong = [];
    for (const p of APP_PAGES) {
      const depth = p.split('/').length - 2;       // app/x.html -> 0, app/a/x.html -> 1
      const want = '../'.repeat(depth) + 'settings.html';
      const href = (shellOf(p, 'header.top').match(/href="([^"]*settings\.html)"/) || [])[1];
      if (href !== want) wrong.push(`${p} links to "${href}", expected "${want}"`);
    }
    assert.deepEqual(wrong, [],
      `A settings link that does not climb the right number of levels is a 404:\n  ${wrong.join('\n  ')}`);
  });

  it('the drift check is actually comparing something', () => {
    const markup = normaliseShell(shellOf(APP_PAGES[0], 'aside.side'));
    assert.ok(markup.length > 500, `The extracted sidebar markup is only ${markup.length} characters; the drift test would be comparing nothing.`);
    assert.ok(!/aria-current|is-on/.test(markup), 'Per-page state (aria-current / is-on) survived normalisation, so the drift test would fail on the current page marker rather than on real drift.');
  });
});

describe('Role navigation map', () => {
  const shellSource = readFile('assets/js/shell.js');

  it('shell.js exports ROLE_NAV so the map has one home', () => {
    assert.ok(/ROLE_NAV\s*:\s*ROLE_NAV/.test(shellSource),
      'assets/js/shell.js does not export ROLE_NAV on window.ShuleShell; the tests and the app must read the same map.');
  });

  it('defines a full navigation for each of the three roles', () => {
    for (const role of ['admin', 'teacher', 'parent']) {
      assert.ok(new RegExp(`\\b${role}\\s*:\\s*\\[`).test(shellSource),
        `ROLE_NAV has no entry for "${role}".`);
    }
  });

  it('each role\'s nav is its own list, not a filter over admin\'s', () => {
    assert.ok(!/ROLE_GROUPS/.test(shellSource),
      'shell.js still refers to ROLE_GROUPS. The filter-over-admin model was replaced by three independent nav definitions.');
    assert.ok(/My children|My fees/.test(shellSource),
      'The parent nav has no parent-shaped destinations. A parent needs "My children" and "My fees", not a reduced bursar console — which is the whole reason the filter model was dropped.');
    assert.ok(/My register|My classes|My pupils/.test(shellSource),
      'The teacher nav has no teacher-shaped destinations, so it is still just admin with items removed.');
  });

  it('the teacher and parent navs point at pages that exist', () => {
    const teacher = shellSource.slice(shellSource.indexOf('teacher: ['), shellSource.indexOf('parent: ['));
    const parent = shellSource.slice(shellSource.indexOf('parent: ['), shellSource.indexOf('};', shellSource.indexOf('parent: [')));
    for (const [name, body] of [['teacher', teacher], ['parent', parent]]) {
      const hrefs = [...body.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
      assert.ok(hrefs.length >= 3, `The ${name} nav has ${hrefs.length} live destinations; step 5 built more than that.`);
      const missing = hrefs.filter((h) => !exists(`app/${h}`));
      assert.deepEqual(missing, [], `The ${name} nav points at pages that do not exist: ${missing.join(', ')}`);
      const wrongDir = hrefs.filter((h) => !h.startsWith(`${name}/`));
      assert.deepEqual(wrongDir, [], `The ${name} nav links outside app/${name}/: ${wrongDir.join(', ')}`);
    }
  });

  it('the served sidebar matches ROLE_NAV for each role', () => {
    const BOUNDS = { admin: ['admin: [', 'teacher: ['], teacher: ['teacher: [', 'parent: ['], parent: ['parent: [', '\n  };'] };
    const SAMPLE = { admin: 'app/dashboard.html', teacher: 'app/teacher/dashboard.html', parent: 'app/parent/index.html' };
    for (const [role, page] of Object.entries(SAMPLE)) {
      const $ = load(page);
      const inMarkup = $('.side .navg[data-group]').toArray().map((el) => $(el).attr('data-group'));
      const [from, to] = BOUNDS[role];
      const body = shellSource.slice(shellSource.indexOf(from), shellSource.indexOf(to, shellSource.indexOf(from)));
      const inMap = (body.match(/group:\s*'([\w-]+)'/g) || []).map((m) => m.split("'")[1]);
      assert.deepEqual(inMarkup, inMap,
        `The ${role} sidebar stamped into ${page} is [${inMarkup.join(', ')}] but ROLE_NAV.${role} is [${inMap.join(', ')}].`);
    }
  });

  it('shell.js and tools/shell.mjs carry the same three navs', () => {
    const gen = readFile('tools/shell.mjs');
    for (const role of ['admin', 'teacher', 'parent']) {
      // slice from this role's key to the next one, so formatting cannot matter
      const ORDER = ['admin', 'teacher', 'parent'];
      const grab = (src) => {
        const at = src.indexOf(`${role}: [`);
        const next = ORDER.slice(ORDER.indexOf(role) + 1)
          .map((r) => src.indexOf(`${r}: [`, at))
          .filter((i) => i > at);
        const body = src.slice(at, next.length ? Math.min(...next) : src.indexOf('\n  };', at));
        return [...body.matchAll(/group:\s*'([\w-]+)'/g)].map((m) => m[1]);
      };
      const inShell = grab(shellSource), inGen = grab(gen);
      assert.deepEqual(inShell, inGen,
        `ROLE_NAV.${role} differs between assets/js/shell.js [${inShell.join(', ')}] and tools/shell.mjs [${inGen.join(', ')}]. ` +
        'The browser re-renders from one and the pages are stamped from the other; they cannot disagree.');
    }
  });
});

describe('Accessibility', () => {
  for (const page of ALL_PAGES) {
    describe(page, () => {
      it('every <img> has an alt attribute', () => {
        const $ = load(page);
        const bad = $('img').toArray().filter((el) => $(el).attr('alt') === undefined)
          .map((el) => $.html(el).slice(0, 80));
        assert.deepEqual(bad, [], `${page} has <img> elements with no alt attribute (use alt="" if decorative):\n  ${bad.join('\n  ')}`);
      });

      it('every <svg role="img"> has an aria-label', () => {
        const $ = load(page);
        const bad = $('svg[role="img"]').toArray()
          .filter((el) => !($(el).attr('aria-label') || '').trim())
          .map((el) => $.html(el).slice(0, 80));
        assert.deepEqual(bad, [], `${page} has <svg role="img"> elements with no aria-label; an image role with no name is announced as "image" and nothing else:\n  ${bad.join('\n  ')}`);
      });

      it('every input, select and textarea has an accessible name', () => {
        const $ = load(page);
        const labelled = new Set($('label[for]').toArray().map((el) => $(el).attr('for')));
        const bad = [];
        $('input, select, textarea').each((_, el) => {
          const $el = $(el);
          if (($el.attr('type') || '').toLowerCase() === 'hidden') return;
          // a <label for> is the default; aria-label / aria-labelledby also name a control
          if (($el.attr('aria-label') || '').trim()) return;
          const by = $el.attr('aria-labelledby');
          if (by && by.split(/\s+/).every((ref) => $(`#${CSS_ESCAPE(ref)}`).length > 0)) return;
          const id = $el.attr('id');
          if (!id) { bad.push(`<${el.tagName} name="${$el.attr('name') ?? '?'}"> has no id, no aria-label and no aria-labelledby`); return; }
          if (!labelled.has(id)) bad.push(`<${el.tagName} id="${id}"> has no <label for="${id}">, no aria-label and no aria-labelledby`);
        });
        assert.deepEqual(bad, [], `${page} has form controls with no accessible name:\n  ${bad.join('\n  ')}`);
      });

      it('every <button> has text or an aria-label', () => {
        const $ = load(page);
        const bad = $('button').toArray().filter((el) => {
          const $el = $(el);
          return !$el.text().trim() && !($el.attr('aria-label') || '').trim();
        }).map((el) => $.html(el).slice(0, 90));
        assert.deepEqual(bad, [], `${page} has buttons with no accessible name — they will be announced as just "button":\n  ${bad.join('\n  ')}`);
      });

      it('heading levels never skip a rank going down the page', () => {
        const heads = headingRanks(page);
        const skips = [];
        for (let i = 1; i < heads.length; i++) {
          const prev = heads[i - 1], cur = heads[i];
          if (cur.level > prev.level + 1) {
            skips.push(`h${prev.level} "${prev.text}" is followed by h${cur.level} "${cur.text}" — h${prev.level + 1} was skipped`);
          }
        }
        assert.deepEqual(skips, [], `${page} skips heading ranks, which breaks document outline navigation:\n  ${skips.join('\n  ')}`);
      });
    });
  }
});

describe('Content', () => {
  it('features.html has a section for all fourteen modules', () => {
    const $ = load('features.html');
    const missing = MODULE_IDS.filter((id) => $(`#${CSS_ESCAPE(id)}`).length === 0);
    assert.deepEqual(missing, [], `features.html is missing sections with these module ids: ${missing.join(', ')}. Every module named on index.html must appear here.`);
  });

  it('features.html gives each module a heading and a capability list', () => {
    const $ = load('features.html');
    const thin = [];
    for (const id of MODULE_IDS) {
      const sec = $(`#${CSS_ESCAPE(id)}`);
      if (sec.length === 0) continue;
      if (sec.find('h2').length === 0) thin.push(`#${id} has no <h2> heading`);
      const paras = sec.find('p').filter((_, el) => $(el).text().trim().length > 80).length;
      if (paras < 2) thin.push(`#${id} has ${paras} substantial paragraph(s); each module needs two or three`);
      const caps = sec.find('ul.caps li').length;
      if (caps < 4) thin.push(`#${id} has ${caps} capability bullets; each module needs a real list`);
    }
    assert.deepEqual(thin, [], `features.html module sections are underweight:\n  ${thin.join('\n  ')}`);
  });

  it('features.html has a table of contents linking every module', () => {
    const $ = load('features.html');
    const toc = $('#toc');
    assert.equal(toc.length, 1, 'features.html has no #toc element — the sticky in-page contents rail is missing.');
    const hrefs = toc.find('a[href^="#"]').toArray().map((el) => $(el).attr('href').slice(1));
    const missing = MODULE_IDS.filter((id) => !hrefs.includes(id));
    assert.deepEqual(missing, [], `features.html contents rail does not link these modules: ${missing.join(', ')}`);
  });

  it('pricing.html names both published prices', () => {
    const text = load('pricing.html')('body').text();
    for (const price of ['KES 90', 'KES 150']) {
      assert.ok(text.includes(price), `pricing.html does not contain the string "${price}" — the Starter plan is KES 90 and the School plan is KES 150 per pupil per term.`);
    }
  });

  it('pricing.html carries the three plans, the add-on rows and the FAQ', () => {
    const $ = load('pricing.html');
    const text = $('body').text();
    for (const plan of ['Starter', 'School', 'Group']) {
      assert.ok(text.includes(plan), `pricing.html does not mention the ${plan} plan.`);
    }
    assert.ok($('.addon-t tbody tr').length >= 4, `pricing.html has ${$('.addon-t tbody tr').length} add-on rows; boarding, transport, library and extra SMS are all expected.`);
    assert.ok($('#faq details').length >= 6, `pricing.html FAQ has ${$('#faq details').length} entries; the FAQ block from index.html has six.`);
  });

  it('pricing.html has a working fee-recovery calculator wired to three inputs', () => {
    const $ = load('pricing.html');
    assert.equal($('#calculator').length, 1, 'pricing.html has no #calculator section.');
    for (const id of ['calc-pupils', 'calc-fee', 'calc-arrears']) {
      assert.equal($(`#${id}`).length, 1, `pricing.html calculator is missing the #${id} input (pupil count, termly fee and arrears percentage are all required).`);
    }
    for (const id of ['out-arrears', 'out-cost']) {
      assert.equal($(`#${id}`).length, 1, `pricing.html calculator has no #${id} output — it must show the annual value of arrears and what the subscription costs against it.`);
    }
    assert.equal($('#demo-form, form[action]', '#calculator').length, 0, 'The calculator must not submit anywhere — it updates on input, in pure JS.');
    assert.ok(exists('assets/js/pricing.js'), 'assets/js/pricing.js is missing, so the calculator has no logic behind it.');
  });

  it('contact.html has all eight named form fields', () => {
    const $ = load('contact.html');
    const names = $('#demo-form').find('input, select, textarea').toArray().map((el) => $(el).attr('name'));
    const missing = CONTACT_FIELDS.filter((n) => !names.includes(n));
    assert.deepEqual(missing, [], `contact.html demo form is missing these fields: ${missing.join(', ')}. Found: ${names.join(', ') || 'none'}`);
  });

  it('contact.html wires aria-invalid and aria-describedby for inline errors', () => {
    const $ = load('contact.html');
    const bad = [];
    $('#demo-form').find('input, select, textarea').each((_, el) => {
      const $el = $(el);
      const id = $el.attr('id');
      const desc = $el.attr('aria-describedby');
      if (!desc) { bad.push(`#${id} has no aria-describedby pointing at its error message`); return; }
      if ($(`#${CSS_ESCAPE(desc)}`).length === 0) bad.push(`#${id} points aria-describedby at "${desc}", which does not exist`);
    });
    assert.deepEqual(bad, [], `contact.html error wiring is incomplete:\n  ${bad.join('\n  ')}`);
    assert.ok(readFile('assets/js/contact.js').includes('aria-invalid') || readFile('assets/js/site.js').includes('aria-invalid'),
      'Nothing in the contact page JS sets aria-invalid, so invalid fields will not be announced.');
  });

  it('contact.html shows the ways to reach a person', () => {
    const text = load('contact.html')('body').text();
    for (const [what, needle] of [['a phone number', '+254'], ['an email address', '@shule.co.ke'], ['a Nairobi address', 'Nairobi'], ['a response-time expectation', 'working day']]) {
      assert.ok(text.includes(needle), `contact.html does not show ${what} (looked for "${needle}").`);
    }
  });

  it('contact.html has a confirmation panel that starts hidden', () => {
    const $ = load('contact.html');
    const done = $('#done-panel');
    assert.equal(done.length, 1, 'contact.html has no #done-panel — a successful submit must show a confirmation.');
    assert.ok(done.attr('hidden') !== undefined, 'contact.html #done-panel is not hidden on load; the confirmation should only appear after a valid submit.');
  });

  it('login.html has all three role toggle values', () => {
    const $ = load('login.html');
    const values = $('input[name="role"]').toArray().map((el) => $(el).attr('value'));
    const missing = LOGIN_ROLES.filter((r) => !values.includes(r));
    assert.deepEqual(missing, [], `login.html role toggle is missing: ${missing.join(', ')}. Found: ${values.join(', ') || 'none'}`);
    const labels = $('body').text();
    for (const label of ['School admin', 'Teacher', 'Parent']) {
      assert.ok(labels.includes(label), `login.html does not show the "${label}" role option.`);
    }
  });

  it('login.html is a split screen with three proof points and the full sign-in form', () => {
    const $ = load('login.html');
    assert.equal($('.split__l').length, 1, 'login.html has no left panel (.split__l) — the split screen is missing.');
    assert.equal($('.split__r').length, 1, 'login.html has no right panel (.split__r) — the split screen is missing.');
    assert.equal($('.split__l .logo').length, 1, 'login.html left panel does not carry the logo.');
    assert.equal($('.pf .pf__i').length, 3, `login.html left panel has ${$('.pf .pf__i').length} proof points; three were specified.`);
    for (const id of ['login-id', 'login-pw', 'remember']) {
      assert.equal($(`#${id}`).length, 1, `login.html is missing #${id} (identifier, password and remember-me are all required).`);
    }
    assert.ok($('a[href="contact.html"]').toArray().some((el) => /forgot/i.test($(el).text())),
      'login.html has no "Forgot password?" link.');
  });

  it('login.html lets parents sign in with a phone number', () => {
    const js = readFile('assets/js/login.js');
    assert.ok(/parent/i.test(js) && /isPhone|phone/i.test(js),
      'assets/js/login.js does not treat the parent role differently — parents must be able to enter a phone number instead of an email.');
    assert.ok(/phone/i.test(load('login.html')('body').text()),
      'login.html never mentions a phone number, so parents are not told they can use one.');
  });
});

describe('Data access discipline', () => {
  /**
   * Only api.js and demo-data.js may touch the dataset. If a page reaches
   * around the API to read window.DEMO_DATA, step 4 stops being a swap and
   * becomes a rewrite — which is exactly what this test exists to prevent.
   */
  const ALLOWED = new Set(['assets/js/demo-backend.js', 'assets/js/data/demo-data.js']);

  function sourceFiles() {
    const out = [];
    const walk = (dir) => {
      if (!fs.existsSync(abs(dir))) return;
      for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(js|html)$/.test(entry.name)) out.push(rel);
      }
    };
    walk('app');
    walk('assets/js');
    return out;
  }

  it('nothing outside api.js and demo-data.js mentions DEMO_DATA', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      if (ALLOWED.has(file)) continue;
      codeOf(file).split('\n').forEach((line, i) => {
        if (line.includes('DEMO_DATA')) offenders.push(`${file}:${i + 1} — ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(offenders, [], `These files reach past assets/js/demo-backend.js straight into the dataset:\n  ${offenders.join('\n  ')}`);
  });

  it('the scan is looking at real files', () => {
    const files = sourceFiles();
    assert.ok(files.length >= 8, `The DEMO_DATA scan only found ${files.length} source files; it is not covering app/ and assets/js/.`);
    assert.ok(files.includes('app/dashboard.html'), 'The DEMO_DATA scan is not reaching app/dashboard.html.');
    assert.ok(files.includes('assets/js/dashboard.js'), 'The DEMO_DATA scan is not reaching assets/js/dashboard.js.');
  });

  it('every api.js function names the FastAPI route it will call', () => {
    const src = readFile('assets/js/api.js');
    const exported = (src.match(/^\s{4}(\w+):\s*\w+,?$/gm) || [])
      .map((l) => l.trim().split(':')[0]);
    assert.ok(exported.length >= 14, `assets/js/api.js exports ${exported.length} functions; at least fourteen were specified.`);

    const REQUIRED = ['listStudents', 'getStudent', 'listClasses', 'listTeachers', 'listFeeStructures',
      'listFeeInvoices', 'listDefaulters', 'recordPayment', 'listAttendance', 'markAttendance',
      'listExams', 'listExamResults', 'listAnnouncements', 'getDashboardSummary'];
    const missing = REQUIRED.filter((fn) => !exported.includes(fn));
    assert.deepEqual(missing, [], `assets/js/api.js does not export: ${missing.join(', ')}`);

    const undocumented = REQUIRED.filter((fn) => {
      const at = src.indexOf(`function ${fn}(`);
      if (at === -1) return true;
      const before = src.slice(Math.max(0, at - 260), at);
      return !/\/\/\s*(GET|POST|PUT|PATCH|DELETE)\s+\/api\//.test(before);
    });
    assert.deepEqual(undocumented, [], `These api.js functions have no "// GET /api/…" route comment above them: ${undocumented.join(', ')}`);
  });

  it('every route function in api.js is async', () => {
    const src = codeOf('assets/js/api.js');
    const declared = src.match(/^\s*(async\s+)?function\s+\w+\s*\(/gm) || [];
    const notAsync = declared.filter((d) => !/async/.test(d)).map((d) => d.trim());
    assert.deepEqual(notAsync, [],
      `These functions in api.js are not async; every route must return a promise:\n  ${notAsync.join('\n  ')}`);
    assert.ok(declared.length >= 50, `api.js declares only ${declared.length} functions; 57 routes were expected.`);
  });

  /**
   * The split is the point of this test. api.js is a route map: arguments in,
   * BACKEND call out, result back. The moment arithmetic, a ledger posting or a
   * store read appears in it, step 5 stops being a swap and becomes a rewrite.
   */
  it('api.js never touches the store, the ledger or the dataset', () => {
    const src = codeOf('assets/js/api.js');
    const FORBIDDEN = [
      [/DEMO_DATA/, 'reads the seed dataset'],
      [/sessionStorage|localStorage/, 'touches browser storage'],
      [/journal_lines|postEntry|debit|credit/, 'posts to the general ledger'],
      [/\.invoices\b|\.students\b|\.guardians\b|\.attendance\b|\.exam_results\b/, 'reaches into a store collection'],
      [/\breconcile|amount_due\s*-|balance\s*=/, 'does invoice arithmetic'],
      [/\.filter\(|\.reduce\(|\.sort\(/, 'filters, sorts or aggregates — that is the backend\'s job']
    ];
    const found = FORBIDDEN.filter(([re]) => re.test(src))
      .map(([re, what]) => `api.js ${what} (matched ${re})`);
    assert.deepEqual(found, [],
      `api.js is no longer a thin route map:\n  ${found.join('\n  ')}\n` +
      'Business rules belong in assets/js/demo-backend.js, which step 5 deletes.');
  });

  it('api.js resolves its backend through one swappable reference', () => {
    const code = codeOf('assets/js/api.js');
    // One assignment of BACKEND per branch, and no second place that decides.
    const assignments = (code.match(/\bBACKEND\s*=/g) || []).length;
    assert.ok(assignments <= 4 && assignments >= 1,
      `api.js assigns BACKEND ${assignments} times. The choice belongs in one place.`);
    assert.ok(/global\.SHULE_BACKEND/.test(code),
      'api.js no longer honours window.SHULE_BACKEND; the contract harness swaps through it.');
    const calls = (code.match(/BACKEND\./g) || []).length;
    assert.ok(calls >= 55, `api.js only calls BACKEND ${calls} times; every route should go through it.`);
  });

  it('a live page never falls back to demo data', () => {
    const code = codeOf('assets/js/api.js');
    // The failure this guards against is the quiet one. An app that serves
    // seeded data when the API is unreachable shows a bursar a school that
    // does not exist, with fees nobody owes, and looks entirely normal doing
    // it. Better a page that says it cannot reach the school system.
    assert.ok(!/SHULE_BACKEND\s*\|\|\s*global\.DemoBackend/.test(code),
      'api.js falls back to DemoBackend when no backend is set. A page that cannot ' +
      'reach the API must fail visibly, not serve a fictional school.');
    assert.ok(/SHULE_CONFIG/.test(code),
      'api.js does not read the mode from config.js; the choice must be made once.');
    const liveBranch = /ShuleLiveBackend/.test(code);
    assert.ok(liveBranch, 'api.js has no live branch, so it can only ever serve demo data.');
  });

  it('config.js decides the mode before any backend loads', () => {
    const { CORE_SCRIPTS } = require('../tools/shell.mjs');
    const order = CORE_SCRIPTS.map((s) => s.split('/').pop());
    assert.equal(order[0], 'config.js',
      `config.js must load first; the order is ${order.join(' → ')}. Anything that ` +
      'loads before it has to guess which backend it is talking to.');
    assert.ok(order.indexOf('api.js') > order.indexOf('live-backend.js'),
      'api.js loads before live-backend.js, so the live client is not defined when it looks.');
  });

  it('the backend adapter owns the rules, and says it is the file that goes', () => {
    const src = readFile('assets/js/demo-backend.js');
    assert.ok(/DemoBackend\s*=/.test(src), 'assets/js/demo-backend.js does not export window.DemoBackend.');
    assert.ok(/STEP 5 DELETES THIS FILE/i.test(src),
      'demo-backend.js does not say it is the file step 5 deletes; that note is how the next person knows which half is disposable.');
    for (const rule of ['journal_lines', 'sessionStorage', 'DEMO_DATA']) {
      assert.ok(src.includes(rule), `demo-backend.js does not mention ${rule}; the rules did not move across.`);
    }
  });

  it('demo-backend.js is not referenced by any page except through the script tag', () => {
    const leaks = [];
    for (const file of sourceFiles()) {
      if (file === 'assets/js/demo-backend.js' || file === 'assets/js/api.js') continue;
      if (/\.html$/.test(file)) continue;
      if (/DemoBackend/.test(codeOf(file))) leaks.push(file);
    }
    assert.deepEqual(leaks, [],
      `These files call the demo backend directly instead of going through api.js: ${leaks.join(', ')}`);
  });

  it('demo-data.js is seeded and never reads the clock', () => {
    const src = codeOf('assets/js/data/demo-data.js');
    assert.ok(/mulberry32|seed/i.test(src), 'assets/js/data/demo-data.js does not look seeded; the dataset must be identical on every load.');
    assert.ok(!/Math\.random\(\)/.test(src), 'assets/js/data/demo-data.js calls Math.random(); use the seeded generator so two loads agree.');
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(src), 'assets/js/data/demo-data.js reads the wall clock; the dataset must not shift between runs.');
  });
});

describe('The allowSelf escape hatch', () => {
  /**
   * verifyExamResults refuses when the person verifying is the person who
   * entered the marks. `allowSelf` exists so test setup can seed verified marks
   * without inventing a second teacher for every fixture — and a control with a
   * bypass is only a control while nothing in the product uses the bypass.
   */
  it('no file outside test/ passes allowSelf', () => {
    const offenders = [];
    const walk = (dir) => {
      if (!fs.existsSync(abs(dir))) return;
      for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!/\.(js|mjs|html)$/.test(entry.name)) continue;
        codeOf(rel).split('\n').forEach((line, i) => {
          // the definition and the refusal message live in the backend; passing it does not
          if (/allowSelf\s*:/.test(line) || /allowSelf\s*=/.test(line)) {
            offenders.push(`${rel}:${i + 1} — ${line.trim().slice(0, 90)}`);
          }
        });
      }
    };
    ['app', 'assets/js', 'tools'].forEach(walk);   // test/ is deliberately excluded
    const outsideBackend = offenders.filter((o) => !o.startsWith('assets/js/demo-backend.js'));
    assert.deepEqual(outsideBackend, [],
      'These files pass allowSelf, which turns off the rule that a teacher cannot verify their own marks:\n  ' +
      outsideBackend.join('\n  '));
  });

  it('the backend only reads allowSelf, never sets it', () => {
    const src = codeOf('assets/js/demo-backend.js');
    const sets = src.split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((x) => /allowSelf\s*[:=][^=]/.test(x.line))
      .map((x) => `demo-backend.js:${x.n} — ${x.line.slice(0, 90)}`);
    assert.deepEqual(sets, [],
      'demo-backend.js assigns allowSelf rather than only reading it from the caller:\n  ' + sets.join('\n  '));
    assert.ok(/payload\.allowSelf/.test(src),
      'demo-backend.js no longer reads payload.allowSelf; the same-person check may have gone with it.');
  });

  it('the same-person check is still in place', () => {
    const src = codeOf('assets/js/demo-backend.js');
    assert.ok(/entered_by === payload\.verifiedBy/.test(src),
      'verifyExamResults no longer compares entered_by against the verifier. ' +
      'Entry and verification being separate steps is then only a naming convention.');
  });
});

describe('The guardian portal page', () => {
  it('exists and is structurally sound', () => {
    assert.ok(exists(PORTAL_PAGE), 'portal.html is missing.');
    const $ = load(PORTAL_PAGE);
    assert.equal($('h1').length, 2,
      `portal.html has ${$('h1').length} <h1> elements; one for the open state and one for the closed state.`);
    assert.equal($('html').attr('lang'), 'en', 'portal.html must declare lang="en".');
    const d = ($('meta[name="description"]').attr('content') || '').trim();
    assert.ok(d.length >= 50 && d.length <= 160, `portal.html meta description is ${d.length} characters.`);
    assert.ok(/noindex/.test($('meta[name="robots"]').attr('content') || ''),
      'portal.html is not marked noindex. A private link to one child must not be crawled.');
  });

  it('carries no shell, no navigation and no login', () => {
    const $ = load(PORTAL_PAGE);
    for (const [sel, what] of [['aside.side', 'a sidebar'], ['header.top', 'the app topbar'],
                               ['#usermenu', 'a user menu'], ['form', 'a form'],
                               ['input[type="password"]', 'a password field']]) {
      assert.equal($(sel).length, 0,
        `portal.html carries ${what}. It opens from an SMS link with no account behind it.`);
    }
    const js = $('script[src]').toArray().map((el) => $(el).attr('src'));
    assert.ok(!js.includes('assets/js/shell.js'),
      'portal.html loads the app shell. It has no shell to run.');
    assert.ok(js.includes('assets/js/portal.js'), 'portal.html does not load its own script.');
  });

  it('has an open state, a closed state and a loading state', () => {
    const $ = load(PORTAL_PAGE);
    for (const region of ['loading', 'content', 'closed']) {
      assert.equal($(`[data-region="${region}"]`).length, 1,
        `portal.html has no [data-region="${region}"] block.`);
    }
    assert.ok($('[data-region="content"]').attr('hidden') !== undefined,
      'portal.html shows its content region before a token has resolved.');
    assert.ok($('[data-region="closed"]').attr('hidden') !== undefined,
      'portal.html shows its closed region before a token has resolved.');
  });

  it('is mobile first', () => {
    const css = readFile('assets/css/portal.css');
    const media = [...css.matchAll(/@media\s*\(([^)]*)\)/g)].map((m) => m[1]);
    const desktopFirst = media.filter((q) => /max-width/.test(q) && !/reduced-motion/.test(q));
    assert.deepEqual(desktopFirst, [],
      `portal.css uses max-width queries (${desktopFirst.join('; ')}). This page opens on a phone; ` +
      'the base styles should be the phone and min-width should add to them.');
    assert.ok(/min-width/.test(css), 'portal.css has no min-width query, so nothing adapts on a wider screen.');
  });

  it('renders no pupil data in its static markup', () => {
    /*
     * Every value in the OPEN state is filled in at runtime from one scoped
     * call. The closed state is allowed its own static copy — it is what a
     * reader sees when the token is dead, and it says nothing about a pupil.
     */
    const $ = load(PORTAL_PAGE);
    const bound = $('[data-region="content"] [data-bind]').toArray().map((el) => $(el).text().trim());
    const filled = bound.filter((t) => t && t !== '—');
    assert.deepEqual(filled, [],
      `portal.html ships these values in its open state: ${filled.join(', ')}. ` +
      'Everything must come from the token call, or a stale name reaches the wrong reader.');
    assert.ok(bound.length >= 10,
      `Only ${bound.length} runtime-bound values in the open state; the page should be entirely data-driven.`);
  });
});

describe('The live backend adapter', () => {
  it('exists and exports one swappable object', () => {
    assert.ok(exists('assets/js/live-backend.js'), 'assets/js/live-backend.js is missing.');
    const src = readFile('assets/js/live-backend.js');
    assert.ok(/global\.ShuleLiveBackend = B;/.test(src),
      'live-backend.js does not export window.ShuleLiveBackend, so api.js cannot select it.');
  });

  it('mounts every path under the router prefix school.py uses', () => {
    const src = codeOf('assets/js/live-backend.js');
    assert.ok(/'\/school'/.test(src),
      "live-backend.js does not prefix its paths with /school. main.py:398 mounts school_router at /api/school.");
  });

  it('carries auth, refresh, timeouts and an offline state', () => {
    const src = codeOf('assets/js/live-backend.js');
    for (const [re, what] of [
      [/Bearer/, 'a bearer token'],
      [/refresh/, 'token refresh'],
      [/AbortController/, 'a request timeout'],
      [/data-connection/, 'a visible offline state'],
      [/status >= 500/, 'a 5xx path that does not render as empty data']
    ]) {
      assert.ok(re.test(src), `live-backend.js has no ${what}.`);
    }
  });

  /**
   * The route comment above each function in api.js is the contract. This
   * checks the adapter honours it: for every function both files know about,
   * the path segments in the comment and the path the adapter calls must
   * agree. Where they cannot, the adapter says so inline — several of our
   * names did not match the real router, and the real router wins.
   */
  it('adapter paths agree with the route comments in api.js', () => {
    const api = readFile('assets/js/api.js');
    const live = readFile('assets/js/live-backend.js');
    const mismatches = [];

    const routes = [...api.matchAll(/\/\/\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/school\/\S+)\s*\n\s*async function (\w+)/g)];
    assert.ok(routes.length >= 50, `Only ${routes.length} documented routes found in api.js.`);

    for (const [, , docPath, fn] of routes) {
      const at = live.indexOf(`B.${fn} = function`);
      if (at === -1) continue;                       // aliased or unimplemented
      // the body runs to the next top-level B.<name> assignment
      const next = live.indexOf('\n  B.', at + 1);
      const body = live.slice(at, next === -1 ? live.length : next);

      // a path is built by concatenation: '/' + schoolId + '/students'.
      // Collect every quoted fragment on the call line and join them.
      const callLines = body.split('\n').filter((l) => /\b(?:GET|POST|PUT)\(|request\('/.test(l));
      if (!callLines.length) continue;
      const called = callLines.map((l) => (l.match(/'([^']*)'/g) || []).join('').replace(/'/g, ''));
      const got = called.join(' ');

      // compare the literal path segments only: {placeholders} are interpolated
      // and ?query= is passed separately, so neither appears in the call literal
      const want = docPath.split('?')[0].replace('/api/school', '').split('/')
        .filter((seg) => seg && !seg.startsWith('{'));
      const missing = want.filter((seg) => !got.includes(seg));
      if (missing.length) {
        mismatches.push(`${fn}: comment says ${docPath}, adapter calls ${called.join(' or ')} ` +
          `(missing: ${missing.join(', ')})`);
      }
    }
    assert.deepEqual(mismatches, [],
      'These adapter paths do not match their route comment in api.js. ' +
      'The comment is the contract — fix whichever is wrong:\n  ' + mismatches.join('\n  '));
  });

  it('never reimplements a rule the backend is missing', () => {
    const src = codeOf('assets/js/live-backend.js');
    for (const [re, what] of [
      [/amount\s*>\s*\w*[Bb]alance/, 'an over-payment guard'],
      [/verified\s*===?\s*(true|false)/, 'a verification filter'],
      [/status\s*===?\s*'published'/, 'a publication filter']
    ]) {
      assert.ok(!re.test(src),
        `live-backend.js contains ${what}. A client-side guard hides the very gap ` +
        'the contract suite exists to surface — the contract test must fail instead.');
    }
    assert.ok(/does not add guards the backend is missing/i.test(readFile('assets/js/live-backend.js')),
      'live-backend.js does not say it deliberately adds no guards.');
  });

  it('names the rule when a route has no backend counterpart', () => {
    const src = readFile('assets/js/live-backend.js');
    assert.ok(/has no route in school\.py/.test(src),
      'live-backend.js does not report missing routes.');
    assert.ok(/RULES_RECONCILED\.md row/.test(src),
      'A missing route does not cite the rule it breaks.');
    const stubs = (src.match(/notInBackend\('/g) || []).length;
    assert.ok(stubs >= 20, `Only ${stubs} routes are marked missing; the audit found more.`);
  });
});

describe('The reconciliation and patch documents', () => {
  it('RULES_RECONCILED.md replaced RULES.md', () => {
    assert.ok(exists('docs/RULES_RECONCILED.md'), 'docs/RULES_RECONCILED.md is missing.');
    assert.ok(!exists('docs/RULES.md'), 'docs/RULES.md is still present; it was superseded.');
  });

  it('every rule row cites school.py or says it searched', () => {
    const md = readFile('docs/RULES_RECONCILED.md');
    const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    assert.ok(rows.length >= 35, `Only ${rows.length} rule rows.`);
    const uncited = rows.filter((l) => !/:\d+|[Aa]bsent|searched|frontend-only|no import route|Exists because|Presentation|preview|Visualises|Menu shape|Deleted when/.test(l))
      .map((l) => l.split('|')[2].trim());
    assert.deepEqual(uncited, [],
      `These rows carry neither a line reference nor an explicit "searched": ${uncited.join(', ')}`);
  });

  it('every backend gap has a patch entry', () => {
    const patches = readFile('docs/BACKEND-PATCHES.md');
    assert.ok(/^## 1\./m.test(patches) && /^## 14\./m.test(patches),
      'BACKEND-PATCHES.md does not run from 1 to 14.');
    const diffs = (patches.match(/```diff/g) || []).length;
    assert.ok(diffs >= 9, `Only ${diffs} diffs in the patch set; most entries should carry one.`);
    for (const line of ['school.py:2498', 'school.py:1254', 'school.py:1976', 'school.py:900', 'school.py:1331']) {
      assert.ok(patches.includes(line), `The patch set does not reference ${line}.`);
    }
  });
});

describe('Budget', () => {
  it('no HTML page is over 120 KB', () => {
    const over = ALL_PAGES.filter((p) => exists(p))
      .map((p) => ({ p, kb: fs.statSync(abs(p)).size / 1024 }))
      .filter((x) => x.kb > 120)
      .map((x) => `${x.p} is ${x.kb.toFixed(1)} KB`);
    assert.deepEqual(over, [], `HTML pages over the 120 KB budget:\n  ${over.join('\n  ')}`);
  });

  it('no CSS file is over 60 KB', () => {
    const over = cssFiles()
      .map((f) => ({ f, kb: fs.statSync(abs(f)).size / 1024 }))
      .filter((x) => x.kb > 60)
      .map((x) => `${x.f} is ${x.kb.toFixed(1)} KB`);
    assert.deepEqual(over, [], `CSS files over the 60 KB budget:\n  ${over.join('\n  ')}`);
  });
});

/**
 * M5 — nothing unbuilt may carry a price.
 *
 * Boarding, transport and library were each priced on three pages while none
 * of them existed. That is the one defect on the register that is a commercial
 * problem rather than a technical one: a school can pay for a module that will
 * not appear. The rule is enforced by name, because "we removed it once" is not
 * a guarantee — the price came from the design source and would come back with
 * the next copy edit.
 */
describe('Unbuilt modules carry no price', () => {
  /** Modules with no page, no route and no data model behind them. */
  const UNBUILT = ['boarding', 'transport', 'library'];

  /** A number next to a module name is a price, whatever the currency shape. */
  const PRICE = /KES\s*[\d.,]+|\b\d+\s*(?:\/|per)\s*(?:boarder|rider|pupil|student|child)\b/i;

  for (const page of PAGES) {
    it(`${page} prices nothing unbuilt`, () => {
      if (!exists(page)) return;
      const $ = load(page);
      const offenders = [];

      // A price counts against a module only when the module is the *subject*
      // of the element carrying it. A whole card is too coarse a unit: the
      // fees card mentions boarding fees in prose and quotes a fees figure,
      // and those two facts are unrelated. So rows, list items and add-on
      // lines are read whole, while a module card is read as its own heading
      // plus its own note — the name and the claim, nothing borrowed from the
      // paragraph in between.
      const claims = [];
      $('tr, li, .addons span').each((_, el) => {
        claims.push($(el).text().replace(/\s+/g, ' ').trim());
      });
      $('.mo').each((_, el) => {
        const card = $(el);
        const title = card.find('h2, h3, .mo__name').first().text().replace(/\s+/g, ' ').trim();
        card.find('.mo__note').each((__, n) => {
          claims.push(`${title} ${$(n).text().replace(/\s+/g, ' ').trim()}`);
        });
      });

      for (const text of claims) {
        if (!text) continue;
        const named = UNBUILT.find((m) => new RegExp(`\\b${m}`, 'i').test(text));
        if (!named) continue;
        const price = text.match(PRICE);
        if (price) offenders.push(`${named}: "${text.slice(0, 90)}" (${price[0]})`);
      }

      assert.deepEqual(offenders, [],
        `${page} attaches a price to a module that does not exist:\n  ${offenders.join('\n  ')}`);
    });
  }

  it('each unbuilt module is labelled as roadmap where it appears priced-adjacent', () => {
    const missing = [];
    for (const page of ['index.html', 'pricing.html', 'features.html']) {
      if (!exists(page)) continue;
      const text = load(page).root().text().toLowerCase();
      for (const m of UNBUILT) {
        if (!text.includes(m)) continue;
        if (!/roadmap|not yet built|coming later/.test(text)) {
          missing.push(`${page} mentions ${m} without saying it is unbuilt`);
        }
      }
    }
    assert.deepEqual(missing, [], missing.join('\n  '));
  });
});

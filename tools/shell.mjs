/**
 * Shule — app shell generator.
 *
 * The sidebar and topbar are duplicated into every page under app/ because the
 * tests read them out of the served HTML; there is no build step and the pages
 * in the repo are the pages that ship.
 *
 *     node tools/shell.mjs           restamp the shell into every app page
 *     node tools/shell.mjs --check   verify without writing; non-zero on drift
 *
 * This is deliberately Node rather than Python: test/static.test.js imports it,
 * generates the shell and asserts it matches what is stamped in every page. A
 * generator the tests cannot run is a generator that goes stale — pages stay
 * identical to each other while all thirteen drift away from their source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

export const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.6"/><rect x="14" y="3" width="7" height="5" rx="1.6"/><rect x="14" y="12" width="7" height="9" rx="1.6"/><rect x="3" y="16" width="7" height="5" rx="1.6"/>',
  students: '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16.5 6.4a3 3 0 0 1 0 5.6M18 14a6 6 0 0 1 3 5"/>',
  classes: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>',
  teachers: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M7 10v5c0 1.6 2.2 3 5 3s5-1.4 5-3v-5"/>',
  invoices: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  payments: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>',
  defaulters: '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
  structures: '<path d="M4 20V9M10 20V4M16 20v-8M22 20h-20"/>',
  waivers: '<path d="M20 6 9 17l-5-5"/><path d="M3 4h10"/>',
  exams: '<path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"/><path d="M4 19a2 2 0 0 0 2 2h14M8 8h8M8 12h5"/>',
  results: '<path d="M4 20V12M10 20V6M16 20v-9M22 20h-20"/><circle cx="10" cy="6" r="1.6"/>',
  reports: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 16h6M9 12h3"/>',
  grading: '<path d="m12 3 2.4 6 6.1.5-4.7 4 1.5 6L12 16.3 6.7 19.5l1.5-6-4.7-4 6.1-.5z"/>',
  attendance: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="m9 14 2 2 4-4"/>',
  timetable: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  boarding: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6M3 21h18"/>',
  transport: '<path d="M3 17V7a2 2 0 0 1 2-2h9v12H3z"/><path d="M14 9h4l3 4v4h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  library: '<path d="M4 5h6a2.6 2.6 0 0 1 2 2.6V19a2.2 2.2 0 0 0-2.2-2.2H4Z"/><path d="M20 5h-6a2.6 2.6 0 0 0-2 2.6V19a2.2 2.2 0 0 1 2.2-2.2H20Z"/>',
  announcements: '<path d="M4 4h16v13H8l-4 3z"/><path d="M8 9h8M8 13h5"/>',
  events: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M8 2v4M16 2v4M3 9h18"/>',
  analytics: '<path d="M3 3v18h18"/><path d="m7 14 3.5-4 3 3L19 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'
};

export function icon(key, size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
}

/**
 * One navigation per role. `href` is a page that exists; `step` marks a
 * destination that does not, and names when it arrives — "6" for the FastAPI
 * wiring, "later" for a module that is planned but not scheduled. Claiming a
 * step that will not build a thing is worse than admitting it is unscheduled.
 *
 * assets/js/shell.js carries the same three navs for the client-side re-render
 * that happens when the signed-in role does not match the stamped one; a test
 * compares the two so they cannot drift.
 */
export const ROLE_NAV = {
  admin: [
    { group: 'overview', label: 'Overview', items: [
      { label: 'Dashboard', icon: 'dashboard', href: 'dashboard.html' } ] },
    { group: 'people', label: 'People', items: [
      { label: 'Students', icon: 'students', href: 'students.html' },
      { label: 'Classes & streams', icon: 'classes', step: 'later' },
      { label: 'Teachers', icon: 'teachers', step: 'later' } ] },
    { group: 'fees', label: 'Fees', items: [
      { label: 'Invoices', icon: 'invoices', href: 'invoices.html' },
      { label: 'Payments', icon: 'payments', href: 'payments.html' },
      { label: 'Defaulters', icon: 'defaulters', href: 'defaulters.html' },
      { label: 'Fee structures', icon: 'structures', href: 'fee-structures.html' },
      { label: 'Waivers', icon: 'waivers', href: 'waivers.html' } ] },
    { group: 'academics', label: 'Academics', items: [
      { label: 'Exams', icon: 'exams', href: 'exams.html' },
      { label: 'Results', icon: 'results', href: 'results.html' },
      { label: 'Report cards', icon: 'reports', href: 'report-cards.html' },
      { label: 'Grading scales', icon: 'grading', href: 'grading-scales.html' } ] },
    { group: 'daily', label: 'Daily', items: [
      { label: 'Attendance', icon: 'attendance', href: 'attendance.html' },
      { label: 'Timetable', icon: 'timetable', step: 'later' } ] },
    { group: 'facilities', label: 'Facilities', items: [
      { label: 'Boarding', icon: 'boarding', step: 'later' },
      { label: 'Transport', icon: 'transport', step: 'later' },
      { label: 'Library', icon: 'library', step: 'later' } ] },
    { group: 'communication', label: 'Communication', items: [
      { label: 'Announcements', icon: 'announcements', step: 'later' },
      { label: 'Events', icon: 'events', step: 'later' } ] },
    { group: 'admin', label: 'Admin', items: [
      { label: 'Reports', icon: 'analytics', step: 'later' },
      { label: 'Settings', icon: 'settings', step: 'later' } ] }
  ],

  teacher: [
    { group: 'overview', label: 'Overview', items: [
      { label: 'My day', icon: 'dashboard', href: 'teacher/dashboard.html' } ] },
    { group: 'classes', label: 'My classes', items: [
      { label: 'My register', icon: 'attendance', href: 'teacher/register.html' },
      { label: 'My timetable', icon: 'timetable', href: 'teacher/timetable.html' } ] },
    { group: 'marks', label: 'Marks', items: [
      { label: 'Enter marks', icon: 'exams', href: 'teacher/marks.html' } ] },
    { group: 'communication', label: 'Communication', items: [
      { label: 'Announcements', icon: 'announcements', step: 'later' },
      { label: 'Message guardians', icon: 'events', step: 'later' } ] }
  ],

  parent: [
    { group: 'overview', label: 'Overview', items: [
      { label: 'My children', icon: 'students', href: 'parent/index.html' } ] },
    { group: 'money', label: 'Money', items: [
      { label: 'Fee statement', icon: 'invoices', href: 'parent/fees.html' } ] },
    { group: 'progress', label: 'Progress', items: [
      { label: 'Results', icon: 'results', href: 'parent/results.html' },
      { label: 'Attendance', icon: 'attendance', href: 'parent/attendance.html' } ] },
    { group: 'school', label: 'School', items: [
      { label: 'Messages', icon: 'announcements', href: 'parent/messages.html' } ] }
  ]
};

const LOGO_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4-9 4z"/>' +
  '<path d="M7 10v5c0 1.7 2.2 3 5 3s5-1.3 5-3v-5"/></svg>';

/** How many `../` a page needs to reach the repo root. */
export function depthOf(pageRel) {
  return pageRel.split('/').length - 1;
}
function up(depth) { return '../'.repeat(depth); }

/** Rewrites an app-root-relative href for a page nested `depth` levels down. */
function hrefFrom(target, depth) {
  // app/ is depth 1; anything deeper walks back up to app/ first
  return depth > 1 ? '../'.repeat(depth - 1) + target : target;
}

export function sidebar(role, currentAppPath, depth) {
  const nav = ROLE_NAV[role];
  if (!nav) throw new Error(`No navigation for role "${role}"`);
  const groups = nav.map((g) => {
    const items = g.items.map((it) => {
      const body = `${icon(it.icon)}<span>${it.label}</span>`;
      const a = it.step
        ? `<a href="#" data-step="${it.step}">${body}<span class="navg__soon">${
            it.step === 'later' ? 'Planned' : 'Step ' + it.step}</span></a>`
        : `<a href="${hrefFrom(it.href, depth)}"${it.href === currentAppPath ? ' aria-current="page"' : ''}>${body}</a>`;
      return `          <li>${a}</li>`;
    }).join('\n');
    return `      <div class="navg" data-group="${g.group}">\n` +
           `        <p class="navg__t">${g.label}</p>\n` +
           `        <ul>\n${items}\n        </ul>\n` +
           `      </div>`;
  }).join('\n');

  return [
    '<aside class="side" id="side">',
    '  <div class="side__top">',
    `    <a href="${up(depth)}index.html" class="logo">`,
    `      <span class="logo__m">${LOGO_SVG}</span>`,
    '      Shule<i>.</i>',
    '    </a>',
    '  </div>',
    `  <nav class="side__scroll" id="sidenav" aria-label="Sections" data-nav-role="${role}">`,
    groups,
    '  </nav>',
    '  <div class="side__end">',
    '    <div class="sidecard">',
    '      <b>Term 2 · 2026</b>',
    '      <p>Closes Friday 7 August. 240 pupils on roll.</p>',
    '      <a href="#" data-step="later" class="btn btn--ghost btn--sm btn--full">Switch term</a>',
    '    </div>',
    '  </div>',
    '</aside>'
  ].join('\n');
}

export function topbar() {
  return `<header class="top">
  <button class="top__menu" id="sidetoggle" aria-label="Open menu" aria-expanded="false" aria-controls="side"><span></span></button>
  <div class="top__school">
    <span data-bind="school-name">Riverside Academy</span>
    <small data-bind="term-name">Term 2 2026 · Nairobi</small>
  </div>
  <div class="search">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <label class="vh" for="app-search">Search students, invoices and classes</label>
    <input type="search" id="app-search" name="q" placeholder="Search pupils, invoices, classes…" autocomplete="off">
  </div>
  <button class="iconbtn" id="notifs" aria-label="Notifications, 3 unread">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
    <span class="iconbtn__dot" id="notif-dot"></span>
  </button>
  <button class="who" id="usermenu" aria-expanded="false" aria-haspopup="true" aria-controls="usermenu-panel">
    <span class="who__av" data-bind="user-initials">JW</span>
    <span class="who__n"><span data-bind="user-name">Jane Wanjiru</span><small data-bind="user-role">School admin</small></span>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </button>
  <div class="menu" id="usermenu-panel" role="menu" aria-labelledby="usermenu">
    <div class="menu__h">
      <b data-bind="user-name">Jane Wanjiru</b>
      <span data-bind="user-email">jane.wanjiru@riverside.ac.ke</span>
    </div>
    <a href="#" data-step="later" role="menuitem">Profile &amp; password</a>
    <a href="#" data-step="later" role="menuitem">School settings</a>
    <button type="button" role="menuitem" id="reset-demo">Reset demo data</button>
    <button type="button" role="menuitem" id="signout">Sign out</button>
  </div>
</header>`;
}

export const CORE_SCRIPTS = [
  'assets/js/data/demo-data.js', 'assets/js/demo-backend.js',
  'assets/js/api.js', 'assets/js/shell.js', 'assets/js/ui.js'
];

export function scripts(depth, pageJs) {
  const list = CORE_SCRIPTS.map((s) => up(depth) + s);
  if (pageJs) list.push(up(depth) + `assets/js/${pageJs}.js`);
  return list.map((s) => `<script src="${s}"></script>`).join('\n');
}

export function head(title, desc, depth, pageCss) {
  let css = `<link rel="stylesheet" href="${up(depth)}assets/css/theme.css">\n` +
            `<link rel="stylesheet" href="${up(depth)}assets/css/app.css">`;
  if (pageCss) css += `\n<link rel="stylesheet" href="${up(depth)}assets/css/${pageCss}.css">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${css}
</head>`;
}

/** `pageRel` is relative to app/, e.g. 'dashboard.html' or 'teacher/marks.html'. */
export function page({ pageRel, role = 'admin', title, desc, content, pageJs, pageCss }) {
  const depth = depthOf(pageRel) + 1;      // +1 because app/ is itself one level down
  const name = pageRel.replace(/\.html$/, '').replace(/\//g, '-');
  return [
    head(title, desc, depth, pageCss),
    `<body class="app-body" data-role="${role}" data-page="${name}">`,
    '',
    '<div class="app">',
    sidebar(role, pageRel, depth),
    '',
    '<div class="main">',
    topbar(),
    '',
    content.trim(),
    '</div>',
    '</div>',
    '',
    '<div class="sidescrim" id="sidescrim" hidden></div>',
    '<div class="toasts" id="toasts" role="status" aria-live="polite"></div>',
    '',
    scripts(depth, pageJs),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

// ── restamping ─────────────────────────────────────────────────────────────

/** Every page under app/, as paths relative to app/. */
export function appPages() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix + entry.name + '/');
      else if (entry.name.endsWith('.html')) out.push(prefix + entry.name);
    }
  };
  walk(path.join(ROOT, 'app'), '');
  return out;
}

/** The role a stamped page was built for, read back out of its markup. */
export function roleOf(html) {
  const m = html.match(/id="sidenav"[^>]*data-nav-role="(\w+)"/);
  return m ? m[1] : 'admin';
}

/** Returns { html, changed } with the shell replaced from this generator. */
export function restamp(pageRel, html) {
  const depth = depthOf(pageRel) + 1;
  const role = roleOf(html);
  let out = html;

  const a = out.indexOf('<aside class="side"');
  const b = out.indexOf('</aside>') + '</aside>'.length;
  out = out.slice(0, a) + sidebar(role, pageRel, depth) + out.slice(b);

  const c = out.indexOf('<header class="top">');
  const d = out.indexOf('</header>') + '</header>'.length;
  out = out.slice(0, c) + topbar() + out.slice(d);

  const first = out.indexOf('<script src=');
  const last = out.lastIndexOf('</script>') + '</script>'.length;
  const existing = out.slice(first, last).split('\n');
  const core = CORE_SCRIPTS.map((s) => up(depth) + s);
  const pageScripts = existing.filter((line) => {
    const m = line.match(/src="([^"]+)"/);
    return m && !core.includes(m[1]);
  });
  out = out.slice(0, first) + [...core.map((s) => `<script src="${s}"></script>`), ...pageScripts].join('\n') + out.slice(last);

  return { html: out, changed: out !== html };
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const drifted = [];
  for (const pageRel of appPages()) {
    const file = path.join(ROOT, 'app', pageRel);
    const html = fs.readFileSync(file, 'utf8');
    const { html: next, changed } = restamp(pageRel, html);
    if (changed) {
      drifted.push(pageRel);
      if (!check) fs.writeFileSync(file, next);
    }
  }
  if (check) {
    if (drifted.length) {
      console.error('Shell drift — these pages do not match tools/shell.mjs:\n  ' + drifted.join('\n  '));
      console.error('\nRun `node tools/shell.mjs` to restamp them.');
      process.exit(1);
    }
    console.log(`Shell is in step with the generator across ${appPages().length} pages.`);
  } else {
    console.log(drifted.length ? 'restamped:\n  ' + drifted.join('\n  ') : 'nothing to restamp.');
  }
}

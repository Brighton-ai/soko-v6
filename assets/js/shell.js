/**
 * Shule app shell — role gating, navigation chrome, toasts and modals.
 *
 * The shell markup itself is static HTML in each page under app/; this file
 * only wires behaviour to it. Nothing here reads the dataset directly: the
 * school name and the signed-in identity come through assets/js/api.js.
 */
(function (global) {
  'use strict';

  var doc = global.document;

  /**
   * NAVIGATION, one full definition per role.
   *
   * This used to be a filter over the admin nav — a list of which admin groups
   * each role was allowed to keep. That could only ever express "a teacher is
   * an admin with less", which is not what a teacher or a parent is. A parent
   * does not want a smaller bursar's console; they want "My children" and "My
   * fees", screens the admin nav has no entry for at all.
   *
   * So each role now owns its own list of groups and items, and none of them
   * is derived from another. Teacher and parent are placeholders whose items
   * are marked data-step="5" until step 5 builds them.
   *
   * `step` on an item means it is not built yet: it renders as href="#" with
   * data-step set, and the shell tells the user which step brings it.
   */
  var ROLE_NAV = {
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

  var ROLE_LABEL = { admin: 'School admin', teacher: 'Teacher', parent: 'Parent' };

  /** Demo identities. Step 4 replaces this with the session from the API. */
  var ROLE_USER = {
    admin:   { id: 'tch-06', name: 'Jane Wanjiru',   email: 'jane.wanjiru@riverside.ac.ke' },
    teacher: { id: 'tch-04', name: 'Samuel Kariuki', email: 'samuel.kariuki@riverside.ac.ke' },
    parent:  { id: 'per-demo-parent', name: 'Mercy Ouma', email: 'mercy.ouma@gmail.com' }
  };

  var STORAGE_KEY = 'shule.role';
  var SCHOOL_ID = 'sch-riverside';

  function readRole() {
    var role;
    try { role = global.localStorage.getItem(STORAGE_KEY); } catch (e) { role = null; }
    return ROLE_NAV[role] ? role : 'admin';
  }
  function writeRole(role) {
    try { global.localStorage.setItem(STORAGE_KEY, role); } catch (e) { /* private mode: fall back to admin */ }
  }
  function initials(name) {
    return name.split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }
  function bind(key, value) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-bind="' + key + '"]'), function (el) {
      el.textContent = value;
    });
  }

  /**
   * Icon paths, so a role's nav can be rendered rather than filtered. The
   * admin nav is already in the served markup — that is the one the static
   * tests read — and is left exactly as it is. Any other role has its nav
   * built from ROLE_NAV instead.
   */
  var ICONS = {
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

  function icon(key) {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[key] || ICONS.dashboard) + '</svg>';
  }

  /** The page's path relative to app/, e.g. 'teacher/marks.html'. */
  function currentPage() {
    var parts = global.location.pathname.split('/').filter(Boolean);
    var at = parts.lastIndexOf('app');
    var rest = at === -1 ? parts.slice(-1) : parts.slice(at + 1);
    return rest.join('/') || 'dashboard.html';
  }

  /** How many `../` this page needs to climb back to app/. */
  function upToApp() {
    var depth = currentPage().split('/').length - 1;
    return depth > 0 ? new Array(depth + 1).join('../') : '';
  }

  function renderNav(role) {
    var host = doc.getElementById('sidenav');
    if (!host) return;
    var here = currentPage(), climb = upToApp();
    host.innerHTML = (ROLE_NAV[role] || ROLE_NAV.admin).map(function (g) {
      var items = g.items.map(function (it) {
        var body = icon(it.icon) + '<span>' + it.label + '</span>';
        if (it.step) {
          return '<li><a href="#" data-step="' + it.step + '">' + body +
            '<span class="navg__soon">' +
            (it.step === 'later' ? 'Planned' : 'Step ' + it.step) + '</span></a></li>';
        }
        var cur = it.href === here ? ' aria-current="page"' : '';
        return '<li><a href="' + climb + it.href + '"' + cur + '>' + body + '</a></li>';
      }).join('');
      return '<div class="navg" data-group="' + g.group + '">' +
        '<p class="navg__t">' + g.label + '</p><ul>' + items + '</ul></div>';
    }).join('');
    host.setAttribute('data-nav-role', role);
  }

  /**
   * Applies a role's navigation. The admin nav is already in the served HTML,
   * so it is left alone; every other role has its own nav rendered in place.
   */
  function applyRole(role) {
    var known = ROLE_NAV[role] ? role : 'admin';
    doc.body.setAttribute('data-role', known);
    // The nav stamped into the page is used as-is when it already matches the
    // signed-in role. Anything else is re-rendered: navigation follows who you
    // are, not which directory the page happens to live in.
    var host = doc.getElementById('sidenav');
    var stamped = host ? host.getAttribute('data-nav-role') : null;
    if (host && stamped !== known) renderNav(known);
    var user = ROLE_USER[known] || ROLE_USER.admin;
    bind('user-name', user.name);
    bind('user-email', user.email);
    bind('user-role', ROLE_LABEL[known] || ROLE_LABEL.admin);
    bind('user-initials', initials(user.name));
    return known;
  }

  // ── toasts ────────────────────────────────────────────────────────────
  var TICK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';
  var WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';

  function toast(message, opts) {
    opts = opts || {};
    var host = doc.getElementById('toasts');
    if (!host) return null;
    var el = doc.createElement('div');
    el.className = 'toast' + (opts.tone === 'bad' ? ' toast--bad' : '');
    el.setAttribute('data-toast', '');
    el.innerHTML = (opts.tone === 'bad' ? WARN : TICK) + '<span>' + message + '</span>';
    host.appendChild(el);
    global.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, opts.ms || 4200);
    return el;
  }

  // ── modals ────────────────────────────────────────────────────────────
  var openModal = null;

  function showModal(id) {
    var scrim = doc.getElementById(id);
    if (!scrim) return null;
    closeModal();
    scrim.classList.add('is-on');
    scrim.setAttribute('data-open', 'true');
    openModal = scrim;
    var first = scrim.querySelector('input, select, textarea, button');
    if (first) first.focus();
    return scrim;
  }
  function closeModal() {
    if (!openModal) return;
    openModal.classList.remove('is-on');
    openModal.removeAttribute('data-open');
    var form = openModal.querySelector('form');
    if (form) {
      form.reset();
      Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (el) {
        el.setAttribute('aria-invalid', 'false');
      });
      Array.prototype.forEach.call(form.querySelectorAll('.err'), function (el) {
        el.textContent = ''; el.classList.remove('on');
      });
    }
    openModal = null;
  }

  function wireModals() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-modal-open]'), function (btn) {
      btn.addEventListener('click', function () { showModal(btn.getAttribute('data-modal-open')); });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-modal-close]'), function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); closeModal(); });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.scrim'), function (scrim) {
      scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closeModal(); });
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  // ── chrome ────────────────────────────────────────────────────────────
  function wireChrome() {
    var side = doc.getElementById('side'),
        toggle = doc.getElementById('sidetoggle'),
        scrim = doc.getElementById('sidescrim');

    function setDrawer(on) {
      if (!side) return;
      side.classList.toggle('is-on', on);
      if (scrim) { scrim.classList.toggle('is-on', on); scrim.hidden = !on; }
      if (toggle) toggle.setAttribute('aria-expanded', String(on));
    }
    if (toggle) toggle.addEventListener('click', function () { setDrawer(!side.classList.contains('is-on')); });
    if (scrim) scrim.addEventListener('click', function () { setDrawer(false); });

    var userBtn = doc.getElementById('usermenu'),
        panel = doc.getElementById('usermenu-panel');
    if (userBtn && panel) {
      userBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var on = panel.classList.toggle('is-on');
        userBtn.setAttribute('aria-expanded', String(on));
      });
      doc.addEventListener('click', function () {
        panel.classList.remove('is-on');
        userBtn.setAttribute('aria-expanded', 'false');
      });
      panel.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    var notifs = doc.getElementById('notifs'), dot = doc.getElementById('notif-dot');
    if (notifs) {
      notifs.addEventListener('click', function () {
        if (dot) dot.remove();
        notifs.setAttribute('aria-label', 'Notifications, none unread');
        toast('Nothing new since you last looked.');
      });
    }

    var signout = doc.getElementById('signout');
    if (signout) {
      signout.addEventListener('click', function () {
        try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* nothing to clear */ }
        global.location.href = '../login.html';
      });
    }

    var search = doc.getElementById('app-search');
    if (search) {
      search.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var q = search.value.trim();
        if (!q) return;
        toast('Search lands in step 3 — you looked for <b>' + q.replace(/[<>&]/g, '') + '</b>.');
      });
    }

    // Every unbuilt destination says so rather than silently doing nothing.
    doc.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[data-step]') : null;
      if (!a) return;
      e.preventDefault();
      var step = a.getAttribute('data-step');
      var label = (a.textContent || '').replace(/step\s*\d/i, '').trim();
      toast('<b>' + label + '</b> arrives in step ' + step + '.');
    });

    var reset = doc.getElementById('reset-demo');
    if (reset) {
      reset.addEventListener('click', function () {
        if (global.ShuleAPI) global.ShuleAPI.resetStore();
        else { try { global.sessionStorage.removeItem('shule.store'); } catch (err) { /* nothing to clear */ } }
        toast('Demo data reset. Reloading…');
        global.setTimeout(function () { global.location.reload(); }, 350);
      });
    }
  }

  function boot() {
    var role = applyRole(readRole());
    wireChrome();
    wireModals();
    if (global.ShuleAPI) {
      global.ShuleAPI.getDashboardSummary(SCHOOL_ID, {}).then(function (s) {
        bind('school-name', s.school_name);
        bind('term-name', s.term_name + ' · Nairobi');
      }).catch(function () { /* the topbar keeps its static fallback text */ });
    }
    doc.body.setAttribute('data-shell', 'ready');
    return role;
  }

  global.ShuleShell = {
    SCHOOL_ID: SCHOOL_ID,
    STORAGE_KEY: STORAGE_KEY,
    ROLE_NAV: ROLE_NAV,
    ROLE_USER: ROLE_USER,
    renderNav: renderNav,
    currentPage: currentPage,
    ROLE_LABEL: ROLE_LABEL,
    readRole: readRole,
    writeRole: writeRole,
    applyRole: applyRole,
    toast: toast,
    showModal: showModal,
    closeModal: closeModal
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);

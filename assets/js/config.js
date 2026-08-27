/*
 * Which backend this page talks to, and where it lives.
 *
 * This file must load before api.js. It decides one thing — live or demo — and
 * nothing else in the app is allowed to decide it again.
 *
 * Live is the default. The demo is opt-in, because the failure that matters is
 * the quiet one: an app that falls back to seeded data when the API is
 * unreachable shows a bursar a school that does not exist, with fees nobody
 * owes, and looks entirely normal doing it.
 */
(function (global) {
  'use strict';

  function param(name) {
    try {
      return new global.URLSearchParams(global.location.search).get(name);
    } catch (e) { return null; }
  }

  function stored(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  /* The API base.
   *
   *  1. window.SHULE_API_BASE, if a deployment stamped one in.
   *  2. <meta name="shule-api-base"> — how the build stamps it.
   *  3. Same origin + /api, which is right when the static site and the API sit
   *     behind one domain. On Railway that is the usual arrangement.
   */
  function apiBase() {
    if (global.SHULE_API_BASE) return String(global.SHULE_API_BASE).replace(/\/$/, '');
    var meta = global.document && global.document.querySelector('meta[name="shule-api-base"]');
    if (meta && meta.content) return meta.content.replace(/\/$/, '');
    if (global.location && /^https?:/.test(global.location.protocol)) {
      return global.location.origin + '/api';
    }
    return 'http://localhost:8000/api';
  }

  /* Demo mode is deliberate, never accidental:
   *   ?demo=1 in the URL, or
   *   a build that stamped SHULE_FORCE_DEMO (the marketing deployment), or
   *   the page was opened from a file:// path, where there is no API to reach
   *     and the alternative is a blank screen.
   */
  function demoWanted() {
    if (param('demo') === '1') return true;
    if (param('demo') === '0') return false;
    if (global.SHULE_FORCE_DEMO === true) return true;
    if (stored('shule.demo') === '1') return true;
    if (global.location && global.location.protocol === 'file:') return true;
    return false;
  }

  var mode = demoWanted() ? 'demo' : 'live';

  global.SHULE_CONFIG = {
    mode: mode,
    apiBase: apiBase(),
    // Where a signed-out visitor is sent. Kept here so the shell, the adapter
    // and the login page agree on one answer.
    loginPage: 'login.html'
  };
  global.SHULE_API_BASE = global.SHULE_CONFIG.apiBase;

  // A page can be opened in demo mode on purpose and stay there while the
  // visitor clicks around, without ?demo=1 on every link.
  if (param('demo') === '1') { try { global.localStorage.setItem('shule.demo', '1'); } catch (e) {} }
  if (param('demo') === '0') { try { global.localStorage.removeItem('shule.demo'); } catch (e) {} }
})(typeof window !== 'undefined' ? window : globalThis);

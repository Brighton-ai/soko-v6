/**
 * portal.html — the tokenised guardian surface.
 *
 * One token, one child, no login. Everything the page shows comes from a single
 * call; if that call returns anything other than state "ok" the page renders the
 * closed state and never touches a pupil record. There is no client-side filter
 * doing that work — the backend decides, and this file only draws.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, U = global.UI;

  var CLOSED_ICON = {
    expired: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    revoked: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 8.5 7 7"/></svg>',
    unknown: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 17h.01"/></svg>'
  };
  var CLOSED_TITLE = {
    expired: 'This link has expired',
    revoked: 'This link has been withdrawn',
    unknown: 'We do not recognise this link'
  };

  function show(region) {
    ['loading', 'content', 'closed'].forEach(function (r) {
      var el = doc.querySelector('[data-region="' + r + '"]');
      if (el) el.hidden = r !== region;
    });
    doc.body.setAttribute('data-portal-state', region);
  }
  function bind(key, value) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-bind="' + key + '"]'), function (el) {
      el.textContent = value;
    });
  }

  function renderClosed(v) {
    var state = v.state || 'unknown';
    doc.getElementById('closed-ico').innerHTML = CLOSED_ICON[state] || CLOSED_ICON.unknown;
    bind('closed-title', CLOSED_TITLE[state] || CLOSED_TITLE.unknown);
    bind('closed-message', v.message || 'Ask the school office for a new link.');
    doc.body.setAttribute('data-token-state', state);
    show('closed');
    U.ready(state);
  }

  function renderOpen(v) {
    doc.body.setAttribute('data-token-state', 'ok');
    doc.body.setAttribute('data-student', v.student.id);

    bind('school-name', v.school.name);
    bind('school-name-2', v.school.name);
    bind('school-address', v.school.address);
    bind('school-phone', v.school.phone);
    bind('school-email', v.school.email);
    bind('term-name', v.term_name);
    bind('student-name', v.student.name);
    bind('admission', v.student.admission_no);
    bind('class-name', v.student.class_name);
    bind('guardian-name', v.guardian ? v.guardian.name : 'you');
    bind('expires', U.longDate(v.expires_at));
    var tel = doc.querySelector('[data-bind="school-phone-link"]');
    if (tel) tel.href = 'tel:' + String(v.school.phone).replace(/\s/g, '');
    var mail = doc.querySelector('[data-bind="school-email-link"]');
    if (mail) mail.href = 'mailto:' + v.school.email;

    // ── fees ──
    var owing = v.fees.balance > 0;
    var money = doc.querySelector('[data-bind="balance"]');
    money.textContent = U.kes(v.fees.balance);
    money.className = 'bigmoney ' + (owing ? 'owing' : 'clear');
    bind('balance-label', owing
      ? 'still owed for ' + v.term_name
      : 'nothing owed — every invoice is cleared');
    bind('invoiced', U.kes(v.fees.invoiced));
    bind('paid', U.kes(v.fees.paid));
    bind('paybill', v.school.paybill);
    bind('account-ref', v.student.admission_no);
    doc.getElementById('paybox').hidden = !owing;

    doc.getElementById('invoice-list').innerHTML = v.fees.invoices.map(function (i) {
      return '<div class="prowline" data-invoice="' + i.id + '">' +
        '<span>' + U.esc(i.term_name) + '<small>due ' + U.shortDate(i.due_date) + ' · ' +
          U.esc(U.titleCase(i.status)) + '</small></span>' +
        '<b class="' + (i.balance > 0 ? 'owing' : '') + '">' +
          (i.balance > 0 ? U.kes(i.balance) : 'Cleared') + '</b></div>';
    }).join('');

    bind('receipt-count', '(' + v.fees.payments.length + ')');
    doc.getElementById('receipt-list').innerHTML = v.fees.payments.length
      ? v.fees.payments.map(function (p) {
          return '<div class="prowline" data-payment>' +
            '<span>' + U.shortDate(p.paid_at.slice(0, 10)) +
              '<small>' + U.esc(U.METHOD_LABEL[p.method] || p.method) +
              (p.reference ? ' · ' + U.esc(p.reference) : '') + '</small></span>' +
            '<b>' + U.kes(p.amount) + '</b></div>';
        }).join('')
      : '<p class="prowline"><span>Nothing received yet.</span></p>';

    // ── attendance ──
    var pct = doc.querySelector('[data-bind="attendance-pct"]');
    pct.textContent = U.pct(v.attendance.percentage);
    bind('attendance-label', v.attendance.days + ' days marked this term');
    doc.getElementById('attendance-days').innerHTML = v.attendance.recent.map(function (d) {
      return '<i data-s="' + d.status + '" data-date="' + d.date + '" title="' +
        U.esc(U.longDate(d.date) + ' — ' + U.titleCase(d.status)) + '"></i>';
    }).join('');

    // ── results ──
    doc.getElementById('results-body').innerHTML = v.results.length
      ? v.results.map(function (c) {
          return '<div class="presult" data-card>' +
            '<div class="presult__h"><b>' + U.esc(c.exam_name) + '</b>' +
              '<span>published ' + U.longDate(String(c.published_at).slice(0, 10)) + '</span></div>' +
            '<div class="presult__s">' +
              '<div><span>Average</span><b>' + Number(c.average).toFixed(1) + '</b></div>' +
              '<div><span>Grade</span><b>' + U.esc(c.grade) + '</b></div>' +
              '<div><span>Position</span><b>' + c.position + ' / ' + c.class_size + '</b></div>' +
            '</div>' +
            '<div class="presubs">' + c.subjects.map(function (s) {
              return '<div><span>' + U.esc(s.subject_name) + '</span>' +
                '<span><em>' + U.esc(s.grade) + '</em> <small>' + s.score + '</small></span></div>';
            }).join('') + '</div>' +
            (c.teacher_comment
              ? '<p class="precomment"><b>Class teacher</b>' + U.esc(c.teacher_comment) + '</p>'
              : '') +
            '</div>';
        }).join('')
      : '<p style="font-size:13.6px;color:var(--body)">Nothing has been published yet this term. ' +
        'Results appear here once the head has signed them off — marks still being checked are not shown.</p>';

    show('content');
    U.ready();
  }

  function boot() {
    var token = U.query('token');
    show('loading');
    API.getGuardianPortal(token, {}).then(function (v) {
      if (v.state === 'ok') renderOpen(v); else renderClosed(v);
    }).catch(function (err) {
      // even an unexpected failure must not fall through to a blank page
      global.console.error(err);
      renderClosed({ state: 'unknown', message: 'Something went wrong opening this link. Please call the school office.' });
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);

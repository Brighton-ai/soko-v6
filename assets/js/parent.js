/**
 * app/parent/* — one file, five pages, dispatched on body[data-page].
 *
 * The child switcher is shared: every page shows one child at a time, chosen
 * from the children this guardian is actually a guardian of. That list comes
 * from the backend scoped to the signed-in person — this file never receives a
 * child it is not entitled to, and asking for one directly answers 404.
 *
 * Results are PUBLISHED cards and VERIFIED marks only. That filtering happens
 * in the backend too; nothing here strips a draft out of a list it was given.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;

  var ME = (SHELL.ROLE_USER.parent || {}).id;
  var PAGE = doc.body.getAttribute('data-page');
  var STORAGE_KEY = 'shule.child';

  var children = [], child = null;

  function stat(label, value, note) {
    return '<div class="kpi"><p class="kpi__l">' + U.esc(label) + '</p>' +
      '<span class="kpi__v">' + value + '</span>' +
      '<p class="kpi__d">' + (note || '') + '</p></div>';
  }
  function dterm(label, value) {
    return '<div><dt>' + U.esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  // ── the child switcher ────────────────────────────────────────────────
  function rememberedChild() {
    try { return global.sessionStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function rememberChild(id) {
    try { global.sessionStorage.setItem(STORAGE_KEY, id); } catch (e) { /* private mode */ }
  }

  function renderChildBar() {
    var host = doc.getElementById('childbar');
    if (!host) return;
    host.innerHTML = children.map(function (c) {
      var on = c.student_id === child.student_id;
      return '<button type="button" role="tab" class="childtab" data-child="' + c.student_id + '"' +
        ' aria-selected="' + on + '">' +
        '<span class="av">' + U.esc(U.initials(c.name)) + '</span>' +
        '<span class="childtab__x"><b>' + U.esc(c.name.split(' ')[0]) + '</b>' +
        '<span>' + U.esc(c.class_name) + '</span></span>' +
        (c.balance > 0 ? '<span class="childtab__dot" aria-label="Fees owing"></span>' : '') +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-child]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-child');
        if (id === child.student_id) return;
        child = children.filter(function (c) { return c.student_id === id; })[0];
        rememberChild(id);
        renderChildBar();
        loadPage();
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // My children
  // ══════════════════════════════════════════════════════════════════════
  function loadOverview() {
    doc.getElementById('child-kpis').innerHTML =
      stat('Fee balance', child.balance > 0 ? U.kes(child.balance) : 'Cleared',
        child.balance > 0 ? 'of ' + U.kes(child.invoiced) + ' invoiced' : 'nothing owed') +
      stat('Attendance', U.pct(child.attendance_percentage), 'this term') +
      stat('Report cards', U.num(child.published_cards), 'published so far') +
      stat('Class', U.esc(child.class_name), U.esc(child.admission_no));

    doc.getElementById('child-profile').innerHTML = [
      dterm('Name', U.esc(child.name)),
      dterm('Admission number', U.esc(child.admission_no)),
      dterm('Class', U.esc(child.class_name)),
      dterm('You are their', U.esc(child.relationship) +
        (child.is_primary ? ' <span class="tag tag--warn"><i></i>Primary</span>' : '')),
      dterm('Fee balance', child.balance > 0
        ? '<b style="color:var(--orange-600)">' + U.kes(child.balance) + '</b>'
        : '<span class="sub">Cleared</span>'),
      dterm('Attendance', U.pct(child.attendance_percentage))
    ].join('');
    U.show('summary', 'content');

    return API.getGuardianMessages(SCHOOL, ME).then(function (m) {
      if (!m.items.length) { U.show('notices', 'empty'); return; }
      doc.getElementById('notice-list').innerHTML = m.items.slice(0, 4).map(function (a) {
        return '<div class="stack__i" data-notice="' + a.id + '">' +
          '<span class="stack__x"><b>' + U.esc(a.title) + '</b><span>' + U.esc(a.body) + '</span></span></div>';
      }).join('');
      U.show('notices', 'content');
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Fee statement
  // ══════════════════════════════════════════════════════════════════════
  function loadFees() {
    return API.getChildFees(SCHOOL, ME, child.student_id).then(function (f) {
      doc.getElementById('fee-kpis').innerHTML =
        stat('Balance', f.balance > 0 ? U.kes(f.balance) : 'Cleared',
          f.balance > 0 ? 'owing on ' + U.esc(child.name.split(' ')[0]) : 'nothing owed') +
        stat('Invoiced', U.kes(f.invoiced), 'across all terms') +
        stat('Paid', U.kes(f.paid), U.num(f.payments.length) + ' receipts') +
        stat('Paybill', U.esc(f.paybill), 'account ' + U.esc(f.account_ref));

      if (!f.invoices.length) U.show('invoices', 'empty');
      else {
        doc.getElementById('invoice-rows').innerHTML = f.invoices.map(function (i) {
          return '<tr data-invoice="' + i.id + '">' +
            '<td class="strong">' + U.esc(i.term_name) + '</td>' +
            '<td class="r">' + U.kes(i.amount_due) + '</td>' +
            '<td class="r">' + U.kes(i.amount_paid) + '</td>' +
            '<td class="r ' + (i.balance > 0 ? 'owe' : 'sub') + '" data-cell="balance">' +
              (i.balance > 0 ? U.kes(i.balance) : '—') + '</td>' +
            '<td class="sub">' + U.shortDate(i.due_date) + '</td>' +
            '<td>' + U.tag(i.status) + '</td></tr>';
        }).join('');
        U.show('invoices', 'content');
      }

      if (!f.payments.length) U.show('receipts', 'empty');
      else {
        doc.getElementById('receipt-rows').innerHTML = f.payments.map(function (p) {
          return '<tr data-payment="' + p.id + '">' +
            '<td class="sub">' + U.shortDate(p.paid_at.slice(0, 10)) + '</td>' +
            '<td class="r strong">' + U.kes(p.amount) + '</td>' +
            '<td>' + U.esc(U.METHOD_LABEL[p.method] || p.method) + '</td>' +
            '<td class="sub">' + U.esc(p.reference || p.mpesa_code || '—') + '</td></tr>';
        }).join('');
        U.show('receipts', 'content');
      }

      doc.getElementById('pay-steps').innerHTML = [
        'Open M-Pesa, choose <b>Lipa na M-Pesa</b>, then <b>Pay Bill</b>',
        'Business number <b>' + U.esc(f.paybill) + '</b>',
        'Account number <b>' + U.esc(f.account_ref) + '</b>',
        'Amount <b>' + (f.balance > 0 ? U.kes(f.balance) : 'any amount') + '</b>',
        'Enter your M-Pesa PIN and confirm'
      ].map(function (t) { return '<li>' + t + '</li>'; }).join('');
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Attendance
  // ══════════════════════════════════════════════════════════════════════
  function loadAttendance() {
    return API.getChildAttendance(SCHOOL, ME, child.student_id, {}).then(function (a) {
      doc.getElementById('att-kpis').innerHTML =
        stat('Attendance', U.pct(a.percentage), a.days + ' days marked') +
        stat('Present', U.num(a.present), 'full days in') +
        stat('Late', U.num(a.late), 'arrived after the bell') +
        stat('Away', U.num(a.absent + a.excused), a.excused + ' of them excused');

      if (!a.items.length) { U.show('attendance', 'empty'); return; }
      doc.getElementById('calendar').innerHTML = a.items.map(function (r) {
        var t = new Date(r.date + 'T00:00:00Z');
        return '<span class="cal__d" data-status="' + r.status + '" data-date="' + r.date + '" title="' +
          U.esc(U.longDate(r.date) + ' — ' + U.titleCase(r.status) + (r.note ? ': ' + r.note : '')) + '">' +
          t.getUTCDate() + '</span>';
      }).join('');
      U.show('attendance', 'content');
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Results — published cards, verified marks
  // ══════════════════════════════════════════════════════════════════════
  function loadResults() {
    return API.getChildResults(SCHOOL, ME, child.student_id).then(function (r) {
      if (!r.total) { U.show('results', 'empty'); return; }
      doc.getElementById('results-body').innerHTML = r.cards.map(function (c) {
        return '<div class="presult" data-card="' + c.card_id + '" style="margin:16px">' +
          '<div class="presult__h"><b>' + U.esc(c.exam_name) + '</b>' +
            '<span>published ' + U.longDate(String(c.published_at).slice(0, 10)) + '</span></div>' +
          '<div class="presult__s">' +
            '<div><span>Average</span><b>' + Number(c.average).toFixed(1) + '</b></div>' +
            '<div><span>Grade</span><b>' + U.esc(c.grade) + '</b></div>' +
            '<div><span>Position</span><b data-cell="position">' + c.position + ' / ' + c.class_size + '</b></div>' +
          '</div>' +
          '<div class="presubs">' + c.results.map(function (s) {
            return '<div data-subject="' + s.subject_id + '"><span>' + U.esc(s.subject_name) + '</span>' +
              '<span><em>' + U.esc(s.grade) + '</em> <small>' + s.score + ' / ' + (s.max_score || 100) + '</small></span></div>';
          }).join('') + '</div>' +
          (c.teacher_comment
            ? '<p class="precomment"><b>Class teacher</b>' + U.esc(c.teacher_comment) + '</p>' : '') +
          (c.principal_comment
            ? '<p class="precomment"><b>Principal</b>' + U.esc(c.principal_comment) + '</p>' : '') +
          '</div>';
      }).join('');
      U.show('results', 'content');
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Messages
  // ══════════════════════════════════════════════════════════════════════
  function loadMessages() {
    return API.getGuardianMessages(SCHOOL, ME).then(function (m) {
      if (!m.items.length) U.show('messages', 'empty');
      else {
        doc.getElementById('message-list').innerHTML = m.items.map(function (a) {
          return '<div class="stack__i" data-message="' + a.id + '">' +
            '<span class="stack__x"><b>' + U.esc(a.title) + '</b><span>' + U.esc(a.body) + '</span>' +
            '<span class="sub" style="margin-top:4px;display:block">' +
              U.longDate(a.posted_at.slice(0, 10)) + '</span></span></div>';
        }).join('');
        U.show('messages', 'content');
      }

      if (!m.events.length) U.show('events', 'empty');
      else {
        doc.getElementById('event-rows').innerHTML = m.events.map(function (e) {
          return '<tr data-event="' + e.id + '">' +
            '<td class="sub">' + U.shortDate(e.starts_on) +
              (e.ends_on !== e.starts_on ? ' – ' + U.shortDate(e.ends_on) : '') + '</td>' +
            '<td class="strong">' + U.esc(e.title) + '</td>' +
            '<td><span class="tag tag--mute"><i></i>' + U.esc(U.titleCase(e.category)) + '</span></td></tr>';
        }).join('');
        U.show('events', 'content');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  function loadPage() {
    var run = {
      'parent-index': loadOverview,
      'parent-fees': loadFees,
      'parent-attendance': loadAttendance,
      'parent-results': loadResults,
      'parent-messages': loadMessages
    }[PAGE];
    if (!run) return Promise.resolve();
    return run().catch(function (e) {
      global.console.error(e);
      ['summary', 'notices', 'invoices', 'receipts', 'attendance', 'results', 'messages', 'events']
        .forEach(function (p) { if (U.panel(p)) U.failed(p, e.message); });
    });
  }

  function boot() {
    if (!ME) { U.ready('error'); return; }
    API.listMyChildren(SCHOOL, ME).then(function (rows) {
      children = rows;
      if (!children.length) { U.ready('empty'); return null; }
      var wanted = U.query('child') || rememberedChild();
      child = children.filter(function (c) { return c.student_id === wanted; })[0] || children[0];
      rememberChild(child.student_id);
      doc.body.setAttribute('data-child', child.student_id);
      renderChildBar();
      return loadPage();
    }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);

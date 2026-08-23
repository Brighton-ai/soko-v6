/** fee-structures.html — itemised charges per class and term, with a live total. */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var state = { termId: '', classId: '' };
  var classes = [], terms = [], editing = null;

  var X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function rowHTML(f) {
    return '<tr data-structure="' + f.id + '" data-class="' + f.class_id + '">' +
      '<td class="strong">' + U.esc(f.class_name) + '</td>' +
      '<td class="sub">' + U.esc(f.term_name) + '</td>' +
      '<td class="r">' + f.items.length + '</td>' +
      '<td class="r strong" data-cell="total">' + U.kes(f.total_mandatory) + '</td>' +
      '<td class="r sub">' + (f.optional_total ? U.kes(f.optional_total) : '—') + '</td>' +
      '<td class="r" data-cell="invoices">' + f.invoice_count + '</td>' +
      '<td class="r">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-edit="' + f.id + '">Edit</button> ' +
        '<button type="button" class="btn btn--ghost btn--sm" data-delete="' + f.id + '">Delete</button>' +
      '</td></tr>';
  }

  function load() {
    return Promise.all([
      API.listFeeStructures(SCHOOL, { termId: state.termId || undefined }),
      API.listInvoiceRows(SCHOOL, { pageSize: 100000 })
    ]).then(function (r) {
      var structures = r[0], invoices = r[1].items;
      var rows = structures.map(function (f) {
        var c = classes.filter(function (x) { return x.id === f.class_id; })[0];
        var t = terms.filter(function (x) { return x.id === f.term_id; })[0];
        return Object.assign({}, f, {
          class_name: c ? c.full_name : f.class_id,
          class_sort: c ? c.sort_order : 99,
          term_name: t ? t.label : f.term_id,
          invoice_count: invoices.filter(function (i) {
            return i.class_id === f.class_id && i.term_id === f.term_id;
          }).length
        });
      });
      if (state.classId) rows = rows.filter(function (f) { return f.class_id === state.classId; });
      rows.sort(function (a, b) { return a.class_sort - b.class_sort; });

      if (!rows.length) {
        U.bind('result-count', 'no structures');
        U.show('structures', 'empty');
        return;
      }
      doc.getElementById('rows').innerHTML = rows.map(rowHTML).join('');
      U.bind('result-count', rows.length + (rows.length === 1 ? ' structure' : ' structures'));
      U.show('structures', 'content');
      wireRows(structures);
    }).catch(function (e) { U.failed('structures', e.message); });
  }

  function wireRows(structures) {
    function find(id) { return structures.filter(function (f) { return f.id === id; })[0]; }
    Array.prototype.forEach.call(doc.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { openEditor(find(b.getAttribute('data-edit'))); });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-delete]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-delete');
        API.deleteFeeStructure(SCHOOL, id).then(function () {
          load();
          SHELL.toast('Fee structure deleted.');
        }).catch(function (err) {
          // blocked because invoices were raised from it — say so plainly
          SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 7000 });
        });
      });
    });
  }

  // ── the line editor ───────────────────────────────────────────────────
  function lineHTML(item, i) {
    return '<div class="line" data-line="' + i + '">' +
      '<label class="vh" for="line-name-' + i + '">Line name</label>' +
      '<input type="text" id="line-name-' + i + '" data-line-name value="' + U.esc(item.name) + '" placeholder="Tuition">' +
      '<label class="vh" for="line-amount-' + i + '">Amount</label>' +
      '<input type="number" id="line-amount-' + i + '" data-line-amount value="' + Number(item.amount) + '" min="0" step="100">' +
      '<span class="line__m"><input type="checkbox" id="line-mand-' + i + '" data-line-mandatory' +
        (item.mandatory !== false ? ' checked' : '') + '>' +
        '<label for="line-mand-' + i + '">Every pupil</label></span>' +
      '<button type="button" class="line__x" data-line-remove="' + i + '" aria-label="Remove this line">' + X + '</button>' +
      '</div>';
  }

  function renderLines(items) {
    doc.getElementById('fs-lines').innerHTML = items.map(lineHTML).join('');
    wireLines();
    recompute();
  }
  function readLines() {
    return Array.prototype.map.call(doc.querySelectorAll('#fs-lines .line'), function (row) {
      return {
        name: row.querySelector('[data-line-name]').value,
        amount: Number(row.querySelector('[data-line-amount]').value),
        mandatory: row.querySelector('[data-line-mandatory]').checked
      };
    });
  }
  function recompute() {
    var total = readLines().filter(function (i) { return i.mandatory; })
      .reduce(function (n, i) { return n + (Number(i.amount) || 0); }, 0);
    doc.getElementById('fs-total').textContent = U.kes(total);
  }
  function wireLines() {
    Array.prototype.forEach.call(doc.querySelectorAll('#fs-lines input'), function (el) {
      el.addEventListener('input', recompute);
      el.addEventListener('change', recompute);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-line-remove]'), function (b) {
      b.addEventListener('click', function () {
        var items = readLines();
        items.splice(Number(b.getAttribute('data-line-remove')), 1);
        renderLines(items.length ? items : [{ name: '', amount: 0, mandatory: true }]);
      });
    });
  }

  function openEditor(structure) {
    editing = structure || null;
    doc.getElementById('modal-structure-t').textContent = structure ? 'Edit fee structure' : 'New fee structure';
    var cls = doc.getElementById('fs-class'), term = doc.getElementById('fs-term');
    cls.value = structure ? structure.class_id : '';
    term.value = structure ? structure.term_id : (state.termId || '');
    cls.disabled = !!structure;
    term.disabled = !!structure;
    renderLines(structure ? structure.items.slice() : [
      { name: 'Tuition', amount: 16500, mandatory: true },
      { name: 'Activity', amount: 2800, mandatory: true },
      { name: 'Lunch', amount: 6000, mandatory: true },
      { name: 'Transport', amount: 5500, mandatory: false }
    ]);
    U.clearErrs(doc.getElementById('modal-structure-form'));
    SHELL.showModal('modal-structure');
  }

  U.onSubmit('modal-structure-form', function () {
    var cls = doc.getElementById('fs-class'), term = doc.getElementById('fs-term');
    var items = readLines();
    var lineErr = doc.getElementById('fs-lines-err');
    var bad = items.filter(function (i) { return !String(i.name).trim() || !(Number(i.amount) >= 0); });
    var ok = [
      U.setErr(cls, cls.value ? '' : 'Choose the class this structure belongs to.'),
      U.setErr(term, term.value ? '' : 'Choose the term this structure belongs to.')
    ].every(Boolean);
    if (bad.length) {
      lineErr.textContent = 'Every line needs a name and an amount of zero or more — ' +
        bad.length + ' line' + (bad.length === 1 ? '' : 's') + ' still incomplete.';
      lineErr.classList.add('on');
      ok = false;
    } else {
      lineErr.textContent = ''; lineErr.classList.remove('on');
    }
    if (!ok) return null;

    var call = editing
      ? API.updateFeeStructure(SCHOOL, editing.id, { items: items })
      : API.createFeeStructure(SCHOOL, { classId: cls.value, termId: term.value, items: items });
    return call.then(function (f) {
      load();
      return 'Structure saved — <b>' + U.kes(f.total_mandatory) + '</b> per pupil.';
    });
  });

  U.onSubmit('modal-clone-form', function () {
    var src = doc.getElementById('cl-source'), cls = doc.getElementById('cl-class'), term = doc.getElementById('cl-term');
    var ok = [
      U.setErr(src, src.value ? '' : 'Choose a structure to copy from.'),
      U.setErr(cls, cls.value ? '' : 'Choose the class to copy into.'),
      U.setErr(term, term.value ? '' : 'Choose the term to copy into.')
    ].every(Boolean);
    if (!ok) return null;
    return API.cloneFeeStructure(SCHOOL, { sourceId: src.value, classId: cls.value, termId: term.value })
      .then(function (f) { load(); return 'Copied — <b>' + U.kes(f.total_mandatory) + '</b> per pupil.'; });
  });

  function boot() {
    Promise.all([API.listClasses(SCHOOL, {}), API.getDashboardSummary(SCHOOL, {}), API.listFeeStructures(SCHOOL, {})])
      .then(function (r) {
        classes = r[0];
        terms = [{ id: r[1].term_id, label: r[1].term_name }];
        state.termId = r[1].term_id;

        U.fillSelect(doc.getElementById('f-term'), terms, 'id', 'label', false);
        U.fillSelect(doc.getElementById('f-class'), classes, 'id', 'full_name', true);
        U.fillSelect(doc.getElementById('fs-class'), classes, 'id', 'full_name', true);
        U.fillSelect(doc.getElementById('fs-term'), terms, 'id', 'label', true);
        U.fillSelect(doc.getElementById('cl-class'), classes, 'id', 'full_name', true);
        U.fillSelect(doc.getElementById('cl-term'), terms, 'id', 'label', true);
        U.fillSelect(doc.getElementById('cl-source'), r[2].map(function (f) {
          var c = classes.filter(function (x) { return x.id === f.class_id; })[0];
          return { id: f.id, label: (c ? c.full_name : f.class_id) + ' — ' + U.kes(f.total_mandatory) };
        }), 'id', 'label', true);

        doc.getElementById('f-term').addEventListener('change', function () {
          state.termId = doc.getElementById('f-term').value; load();
        });
        doc.getElementById('f-class').addEventListener('change', function () {
          state.classId = doc.getElementById('f-class').value; load();
        });
        doc.getElementById('new-structure').addEventListener('click', function () { openEditor(null); });
        doc.getElementById('fs-add-line').addEventListener('click', function () {
          renderLines(readLines().concat([{ name: '', amount: 0, mandatory: true }]));
        });
        return load();
      }).then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);

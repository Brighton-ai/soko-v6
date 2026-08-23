/**
 * grading-scales.html — the band editor.
 *
 * The one rule that matters: bands must tile 0..max_score with no gap and no
 * overlap. The coverage strip shows it as you type; the backend refuses to save
 * until it is clean, and names the score that would otherwise fall through.
 */
(function (global) {
  'use strict';
  var doc = global.document, API = global.ShuleAPI, SHELL = global.ShuleShell, U = global.UI;
  var SCHOOL = SHELL.SCHOOL_ID;
  var editing = null, scales = [];

  var X = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var OK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';
  var BAD = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';

  function rowHTML(g) {
    return '<tr data-scale="' + g.id + '" data-default="' + g.is_default + '">' +
      '<td class="strong">' + U.esc(g.name) +
        (g.is_default ? ' <span class="tag tag--warn"><i></i>Default</span>' : '') +
        '<span class="sub" style="display:block">' + U.esc(g.description || '') + '</span></td>' +
      '<td class="r" data-cell="bands">' + g.band_count + '</td>' +
      '<td class="r">' + g.max_score + '</td>' +
      '<td class="r">' + g.exam_count + '</td>' +
      '<td class="r">' + U.num(g.result_count) + '</td>' +
      '<td>' + (g.tiles
        ? '<span class="tag tag--ok"><i></i>0–' + g.max_score + ' covered</span>'
        : '<span class="tag tag--bad"><i></i>Has a gap</span>') + '</td>' +
      '<td class="r">' +
        (g.is_default ? '' : '<button type="button" class="btn btn--ghost btn--sm" data-default-set="' + g.id + '">Make default</button> ') +
        '<button type="button" class="btn btn--ghost btn--sm" data-edit="' + g.id + '">Edit</button> ' +
        '<button type="button" class="btn btn--ghost btn--sm" data-delete="' + g.id + '">Delete</button>' +
      '</td></tr>';
  }

  function load() {
    return API.listGradingScaleRows(SCHOOL, {}).then(function (rows) {
      scales = rows;
      if (!rows.length) { U.show('scales', 'empty'); return; }
      doc.getElementById('rows').innerHTML = rows.map(rowHTML).join('');
      U.show('scales', 'content');
      wireRows();
    }).catch(function (e) { U.failed('scales', e.message); });
  }

  function wireRows() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        openEditor(scales.filter(function (g) { return g.id === b.getAttribute('data-edit'); })[0]);
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-default-set]'), function (b) {
      b.addEventListener('click', function () {
        API.setDefaultGradingScale(SCHOOL, b.getAttribute('data-default-set'))
          .then(function () { load(); SHELL.toast('Default scale changed.'); });
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-delete]'), function (b) {
      b.addEventListener('click', function () {
        API.deleteGradingScale(SCHOOL, b.getAttribute('data-delete'))
          .then(function () { load(); SHELL.toast('Scale deleted.'); })
          .catch(function (err) { SHELL.toast(U.esc(err.message), { tone: 'bad', ms: 8000 }); });
      });
    });
  }

  // ── the editor ────────────────────────────────────────────────────────
  function bandHTML(b, i) {
    return '<div class="band" data-band="' + i + '">' +
      '<label class="vh" for="band-grade-' + i + '">Grade</label>' +
      '<input type="text" id="band-grade-' + i + '" data-band-grade value="' + U.esc(b.grade) + '" placeholder="A">' +
      '<label class="vh" for="band-min-' + i + '">From</label>' +
      '<input type="number" id="band-min-' + i + '" data-band-min value="' + Number(b.min) + '" min="0" step="1">' +
      '<label class="vh" for="band-max-' + i + '">To</label>' +
      '<input type="number" id="band-max-' + i + '" data-band-max value="' + Number(b.max) + '" min="0" step="1">' +
      '<label class="vh" for="band-points-' + i + '">Points</label>' +
      '<input type="number" id="band-points-' + i + '" data-band-points value="' + Number(b.points) + '" min="0" step="1">' +
      '<label class="vh" for="band-remark-' + i + '">Remark</label>' +
      '<input type="text" id="band-remark-' + i + '" data-band-remark value="' + U.esc(b.remark) + '" placeholder="Meeting expectation">' +
      '<button type="button" class="band__x" data-band-remove="' + i + '" aria-label="Remove this band">' + X + '</button>' +
      '</div>';
  }

  function renderBands(bands) {
    doc.getElementById('sc-bands').innerHTML = bands.map(bandHTML).join('');
    Array.prototype.forEach.call(doc.querySelectorAll('#sc-bands input'), function (el) {
      el.addEventListener('input', recompute);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-band-remove]'), function (b) {
      b.addEventListener('click', function () {
        var rows = readBands();
        rows.splice(Number(b.getAttribute('data-band-remove')), 1);
        renderBands(rows.length ? rows : [{ grade: '', min: 0, max: 100, points: 1, remark: '' }]);
      });
    });
    recompute();
  }

  function readBands() {
    return Array.prototype.map.call(doc.querySelectorAll('#sc-bands .band'), function (row) {
      return {
        grade: row.querySelector('[data-band-grade]').value,
        min: Number(row.querySelector('[data-band-min]').value),
        max: Number(row.querySelector('[data-band-max]').value),
        points: Number(row.querySelector('[data-band-points]').value),
        remark: row.querySelector('[data-band-remark]').value
      };
    });
  }

  /** Draws the coverage strip and the plain-English verdict under it. */
  function recompute() {
    var bands = readBands();
    var max = Number(doc.getElementById('sc-max').value) || 100;
    var problem = API.validateBands(bands, max);
    var host = doc.getElementById('sc-coverage');

    var sorted = bands.slice().sort(function (a, b) { return a.min - b.min; });
    var segs = [], cursor = 0;
    sorted.forEach(function (b) {
      if (b.min > cursor) {
        segs.push({ from: cursor, to: b.min - 1, label: '', gap: true });
      }
      var from = Math.max(b.min, cursor);
      if (b.max >= from) segs.push({ from: from, to: b.max, label: b.grade, over: b.min < cursor });
      cursor = Math.max(cursor, b.max + 1);
    });
    if (cursor <= max) segs.push({ from: cursor, to: max, label: '', gap: true });

    host.innerHTML =
      '<div class="coverage__bar" role="img" aria-label="' +
        U.esc(problem ? 'Band coverage has a problem: ' + problem : 'Bands cover 0 to ' + max + ' with no gap') + '">' +
      segs.map(function (s) {
        var width = ((s.to - s.from + 1) / (max + 1) * 100).toFixed(2);
        return '<span class="coverage__seg' + (s.gap ? ' gap' : s.over ? ' over' : '') +
          '" style="width:' + width + '%" data-from="' + s.from + '" data-to="' + s.to + '">' +
          U.esc(s.label || (s.gap ? '!' : '')) + '</span>';
      }).join('') + '</div>' +
      '<p class="coverage__msg ' + (problem ? 'bad' : 'ok') + '" data-coverage>' +
        (problem ? BAD : OK) + '<span>' +
        U.esc(problem || ('Every score from 0 to ' + max + ' falls in exactly one band.')) +
        '</span></p>';

    var err = doc.getElementById('sc-bands-err');
    if (problem) { err.textContent = problem; err.classList.add('on'); }
    else { err.textContent = ''; err.classList.remove('on'); }
    return problem;
  }

  function openEditor(scale) {
    editing = scale || null;
    doc.getElementById('modal-scale-t').textContent = scale ? 'Edit grading scale' : 'New grading scale';
    doc.getElementById('sc-name').value = scale ? scale.name : '';
    doc.getElementById('sc-description').value = scale && scale.description ? scale.description : '';
    doc.getElementById('sc-max').value = scale ? scale.max_score : 100;
    renderBands(scale ? scale.bands.slice() : [
      { grade: 'BE', min: 0, max: 39, points: 1, remark: 'Below expectation' },
      { grade: 'AE', min: 40, max: 59, points: 2, remark: 'Approaching expectation' },
      { grade: 'ME', min: 60, max: 79, points: 3, remark: 'Meeting expectation' },
      { grade: 'EE', min: 80, max: 100, points: 4, remark: 'Exceeding expectation' }
    ]);
    U.clearErrs(doc.getElementById('modal-scale-form'));
    SHELL.showModal('modal-scale');
  }

  U.onSubmit('modal-scale-form', function () {
    var name = doc.getElementById('sc-name'), max = doc.getElementById('sc-max');
    var bands = readBands();
    var ok = [
      U.setErr(name, name.value.trim() ? '' : 'Give the scale a name.'),
      U.setErr(max, Number(max.value) > 0 ? '' : 'The maximum score must be greater than zero.')
    ].every(Boolean);
    var problem = recompute();
    if (!ok || problem) return null;

    var payload = {
      name: name.value.trim(),
      description: doc.getElementById('sc-description').value.trim() || null,
      maxScore: Number(max.value), bands: bands
    };
    var call = editing
      ? API.updateGradingScale(SCHOOL, editing.id, payload)
      : API.createGradingScale(SCHOOL, payload);
    return call.then(function (r) {
      load();
      var regraded = r && r.regraded;
      return 'Scale saved.' + (regraded ? ' <b>' + regraded + '</b> marks regraded against the new bands.' : '');
    });
  });

  function boot() {
    doc.getElementById('new-scale').addEventListener('click', function () { openEditor(null); });
    doc.getElementById('sc-add-band').addEventListener('click', function () {
      var rows = readBands();
      var top = rows.reduce(function (n, b) { return Math.max(n, b.max); }, -1);
      var max = Number(doc.getElementById('sc-max').value) || 100;
      renderBands(rows.concat([{ grade: '', min: Math.min(top + 1, max), max: max, points: 1, remark: '' }]));
    });
    doc.getElementById('sc-max').addEventListener('input', recompute);
    load().then(function () { U.ready(); })
      .catch(function (e) { global.console.error(e); U.ready('error'); });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);

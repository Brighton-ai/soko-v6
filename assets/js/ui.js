/**
 * Shule app — shared UI toolkit.
 *
 * Formatting, table plumbing, filters, pagination, selection, CSV download and
 * modal form wiring. Every page under app/ uses these so the list pages stay
 * short enough to read. Nothing here touches the dataset: pages call
 * assets/js/api.js and hand the rows to these helpers.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var nf = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

  // ── formatting ────────────────────────────────────────────────────────
  function num(n) { return nf.format(Math.round(Number(n) || 0)); }
  function kes(n) { return 'KES ' + num(n); }
  function pct(n, dp) { return n == null ? '—' : Number(n).toFixed(dp == null ? 1 : dp) + '%'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function d(iso) { return new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); }
  function shortDate(iso) {
    if (!iso) return '—';
    var t = d(iso);
    return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + String(t.getUTCFullYear()).slice(2);
  }
  function longDate(iso) {
    if (!iso) return '—';
    var t = d(iso);
    return DAYS[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MONTHS_LONG[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }
  function clock(stamp) { return stamp ? String(stamp).slice(11, 16) : '—'; }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p[0]; }).join('').toUpperCase();
  }
  function titleCase(s) {
    return String(s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  var METHOD_LABEL = { mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank transfer' };
  var STATUS_TAG = {
    cleared:    ['ok',   'Cleared'],
    part_paid:  ['warn', 'Part paid'],
    unpaid:     ['bad',  'Unpaid'],
    active:     ['ok',   'Active'],
    transferred:['mute', 'Transferred'],
    graduated:  ['mute', 'Graduated'],
    withdrawn:  ['mute', 'Withdrawn'],
    pending:    ['warn', 'Pending'],
    approved:   ['ok',   'Approved'],
    rejected:   ['bad',  'Rejected']
  };
  function tag(status) {
    var t = STATUS_TAG[status] || ['mute', titleCase(status)];
    return '<span class="tag tag--' + t[0] + '"><i></i>' + esc(t[1]) + '</span>';
  }

  // ── panels ────────────────────────────────────────────────────────────
  function panel(name) { return doc.querySelector('[data-panel="' + name + '"]'); }
  function show(name, region) {
    var p = panel(name);
    if (!p) return;
    ['loading', 'content', 'empty'].forEach(function (r) {
      var el = p.querySelector('[data-region="' + r + '"]');
      if (el) el.hidden = r !== region;
    });
    p.setAttribute('data-state', region);
  }
  function failed(name, message) {
    var p = panel(name);
    if (!p) return;
    var el = p.querySelector('[data-region="empty"]');
    if (el) {
      el.innerHTML = '<div class="empty empty--bad"><span class="empty__ico">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>' +
        '</span><b>Could not load this</b><p>' + esc(message) + '</p></div>';
    }
    show(name, 'empty');
  }
  function bind(key, value) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-bind="' + key + '"]'), function (el) {
      el.textContent = value;
    });
  }

  // ── query string ──────────────────────────────────────────────────────
  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  // ── selects ───────────────────────────────────────────────────────────
  function fillSelect(sel, rows, valueKey, labelKey, keepFirst) {
    if (!sel) return;
    var head = keepFirst && sel.options.length ? sel.options[0].outerHTML : '';
    sel.innerHTML = head + rows.map(function (r) {
      return '<option value="' + esc(r[valueKey]) + '">' + esc(r[labelKey]) + '</option>';
    }).join('');
  }

  // ── sortable headers ──────────────────────────────────────────────────
  var CARET = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';

  /** Wires th[data-sort] buttons; calls back with { sort, dir }. */
  function sortable(table, state, onChange) {
    Array.prototype.forEach.call(table.querySelectorAll('th[data-sort]'), function (th) {
      var key = th.getAttribute('data-sort');
      var label = th.textContent.trim();
      th.classList.add('sortable');
      th.innerHTML = '<button type="button" data-sort-key="' + key + '">' + esc(label) + CARET + '</button>';
      th.querySelector('button').addEventListener('click', function () {
        if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort = key; state.dir = 'asc'; }
        markSort(table, state);
        onChange(state);
      });
    });
    markSort(table, state);
  }
  function markSort(table, state) {
    Array.prototype.forEach.call(table.querySelectorAll('th[data-sort]'), function (th) {
      if (th.getAttribute('data-sort') === state.sort) {
        th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  // ── pagination ────────────────────────────────────────────────────────
  /** Renders a pager into `host`, calling back with the page number. */
  function pager(host, page, onGo) {
    if (!host) return;
    var total = page.total, size = page.page_size, cur = page.page, pages = page.pages;
    if (!total) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    var from = (cur - 1) * size + 1, to = Math.min(total, cur * size);

    var wanted = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - cur) <= 1) wanted.push(i);
      else if (wanted[wanted.length - 1] !== '…') wanted.push('…');
    }
    host.innerHTML =
      '<p class="pager__n">Showing <b>' + num(from) + '–' + num(to) + '</b> of <b>' + num(total) + '</b></p>' +
      '<div class="pager__c">' +
      '<button type="button" data-go="' + (cur - 1) + '"' + (cur <= 1 ? ' disabled' : '') + ' aria-label="Previous page">‹</button>' +
      wanted.map(function (p) {
        return p === '…' ? '<span aria-hidden="true">…</span>'
          : '<button type="button" data-go="' + p + '"' + (p === cur ? ' aria-current="true"' : '') +
            ' aria-label="Page ' + p + '">' + p + '</button>';
      }).join('') +
      '<button type="button" data-go="' + (cur + 1) + '"' + (cur >= pages ? ' disabled' : '') + ' aria-label="Next page">›</button>' +
      '</div>';
    Array.prototype.forEach.call(host.querySelectorAll('[data-go]'), function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.getAttribute('data-go'));
        if (n >= 1 && n <= pages && n !== cur) onGo(n);
      });
    });
  }

  // ── selection ─────────────────────────────────────────────────────────
  /**
   * Checkbox selection over a table body, with a bulk bar that appears when
   * anything is picked. Selection is kept as ids, not rows, so it survives a
   * re-render of the same page.
   */
  function selection(opts) {
    var picked = Object.create(null);
    var bar = doc.getElementById(opts.barId);
    var count = bar ? bar.querySelector('[data-bulk-count]') : null;

    function ids() { return Object.keys(picked); }
    function size() { return ids().length; }
    function sync() {
      var n = size();
      if (bar) bar.classList.toggle('is-on', n > 0);
      if (count) count.textContent = n + (n === 1 ? ' ' + opts.noun : ' ' + opts.nounPlural);
      Array.prototype.forEach.call(doc.querySelectorAll('[data-pick]'), function (cb) {
        var on = !!picked[cb.getAttribute('data-pick')];
        cb.checked = on;
        var tr = cb.closest('tr');
        if (tr) tr.setAttribute('data-selected', String(on));
      });
      var all = doc.getElementById(opts.allId);
      if (all) {
        var boxes = doc.querySelectorAll('[data-pick]');
        var on = boxes.length > 0 && Array.prototype.every.call(boxes, function (cb) { return cb.checked; });
        all.checked = on;
        all.indeterminate = !on && size() > 0;
      }
      if (opts.onChange) opts.onChange(ids());
    }
    function wire() {
      Array.prototype.forEach.call(doc.querySelectorAll('[data-pick]'), function (cb) {
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-pick');
          if (cb.checked) picked[id] = true; else delete picked[id];
          sync();
        });
      });
      sync();
    }
    var all = doc.getElementById(opts.allId);
    if (all) {
      all.addEventListener('change', function () {
        Array.prototype.forEach.call(doc.querySelectorAll('[data-pick]'), function (cb) {
          var id = cb.getAttribute('data-pick');
          if (all.checked) picked[id] = true; else delete picked[id];
        });
        sync();
      });
    }
    var clear = bar ? bar.querySelector('[data-bulk-clear]') : null;
    if (clear) clear.addEventListener('click', function () { picked = Object.create(null); sync(); });

    return { ids: ids, size: size, wire: wire, sync: sync,
             clear: function () { picked = Object.create(null); sync(); } };
  }

  // ── form errors ───────────────────────────────────────────────────────
  function setErr(el, message) {
    if (!el) return !message;
    var box = doc.getElementById(el.id + '-err');
    if (message) {
      el.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = message; box.classList.add('on'); }
    } else {
      el.setAttribute('aria-invalid', 'false');
      if (box) { box.textContent = ''; box.classList.remove('on'); }
    }
    return !message;
  }
  function clearErrs(form) {
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (e) {
      e.textContent = ''; e.classList.remove('on');
    });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (e) {
      e.setAttribute('aria-invalid', 'false');
    });
  }
  /** Puts a whole-form failure where the user can see it. */
  function formError(form, message) {
    if (!form) return;
    var box = form.querySelector('[data-form-error]');
    if (!box) return;
    if (message) { box.textContent = message; box.classList.add('on'); }
    else { box.textContent = ''; box.classList.remove('on'); }
  }

  /**
   * Wires a modal form. `handler` validates and returns a promise for the
   * success message, or null when the input is not good enough — in which case
   * the modal stays open with its errors showing.
   */
  function onSubmit(formId, handler, opts) {
    opts = opts || {};
    var form = doc.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      formError(form, '');
      var submit = form.querySelector('button[type="submit"]');
      var result;
      try { result = handler(form); } catch (err) { formError(form, err.message); return; }
      if (!result) return;
      if (submit) submit.disabled = true;
      result.then(function (message) {
        if (submit) submit.disabled = false;
        clearErrs(form);
        if (!opts.keepOpen) global.ShuleShell.closeModal();
        if (message) global.ShuleShell.toast(message);
        if (opts.after) opts.after();
      }).catch(function (err) {
        if (submit) submit.disabled = false;
        formError(form, err.message);
      });
    });
  }

  // ── CSV download ──────────────────────────────────────────────────────
  /**
   * Hands the browser a file. Artifact sandboxes block downloads, but this is
   * a plain local page, so an object URL is the right tool.
   */
  function downloadCSV(filename, csv) {
    try {
      var blob = new global.Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = global.URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url; a.download = filename;
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      global.clearTimeout(t);
      t = global.setTimeout(function () { fn.apply(self, args); }, ms || 180);
    };
  }

  /** Marks the page finished, which is what the tests wait on. */
  function ready(state) { doc.body.setAttribute('data-ready', state || '1'); }

  global.UI = {
    num: num, kes: kes, pct: pct, esc: esc,
    shortDate: shortDate, longDate: longDate, clock: clock,
    initials: initials, titleCase: titleCase, tag: tag,
    METHOD_LABEL: METHOD_LABEL,
    panel: panel, show: show, failed: failed, bind: bind,
    query: query, fillSelect: fillSelect,
    sortable: sortable, pager: pager, selection: selection,
    setErr: setErr, clearErrs: clearErrs, formError: formError, onSubmit: onSubmit,
    downloadCSV: downloadCSV, debounce: debounce, ready: ready
  };
})(typeof window !== 'undefined' ? window : globalThis);

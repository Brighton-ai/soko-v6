/* app/settings.html — integrations, plan, profile.
 *
 * The integrations panel is where a school's M-Pesa paybill and email key are
 * entered. Two things govern how it behaves.
 *
 * A secret that has been saved is shown as its last four characters and
 * nothing else. The field is left blank on load, and a blank field on save
 * means "keep what is stored" — so correcting a shortcode does not require
 * pasting the consumer secret again, and does not require keeping a copy of it
 * somewhere in order to do so.
 *
 * The test button reports what the provider actually said. "Something went
 * wrong" sends a bursar to support; "Invalid Access Token" sends them back to
 * the Daraja portal to fix it themselves.
 */
(function () {
  'use strict';
  var API = window.ShuleAPI, UI = window.ShuleUI || {};
  var school = (window.ShuleShell && window.ShuleShell.schoolId) || null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function say(msg, kind) {
    if (UI.toast) return UI.toast(msg, kind || 'ok');
    console.log(kind === 'err' ? 'error:' : '', msg);
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  var tabs = [].slice.call(document.querySelectorAll('.tab'));
  var panels = [].slice.call(document.querySelectorAll('.tabpanel'));
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) {
        var on = x === t;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', String(on));
      });
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== t.getAttribute('data-tab'); });
    });
  });

  var SECRET = /secret|passkey|password|api_key|token|credential/i;

  function fieldRow(provider, name, saved, required) {
    var isSecret = SECRET.test(name);
    var id = 'f-' + provider + '-' + name;
    var label = name.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    var input = el('input', {
      id: id, name: name, type: isSecret ? 'password' : 'text',
      autocomplete: 'off', spellcheck: 'false',
      placeholder: saved ? 'Saved — leave blank to keep it' : (required ? 'Required' : 'Optional')
    });
    return el('div', { class: 'field' }, [
      el('label', { for: id, text: label + (required ? '' : ' (optional)') }),
      input,
      saved ? el('span', { class: 'field__saved', text: 'stored: ' + saved }) : null
    ]);
  }

  function card(item) {
    var body = el('div', { class: 'card__body' });
    var badge = el('span', {
      class: 'tag ' + (item.status === 'connected' ? 'tag--ok'
                     : item.status === 'error' ? 'tag--bad' : 'tag--mute'),
      html: '<i></i>' + (item.status === 'connected' ? 'Connected'
                       : item.status === 'error' ? 'Not working'
                       : item.status === 'incomplete' ? 'Incomplete' : 'Not connected')
    });

    var form = el('form', { class: 'stack', 'data-provider': item.provider });
    var fields = (item.required || []).concat(item.optional || []);
    fields.forEach(function (f) {
      form.appendChild(fieldRow(item.provider, f, (item.config || {})[f], (item.required || []).indexOf(f) !== -1));
    });

    var actions = el('div', { class: 'row row--end' }, [
      el('button', { type: 'submit', class: 'btn btn--primary', text: 'Save' }),
      el('button', { type: 'button', class: 'btn btn--ghost', 'data-act': 'test', text: 'Test connection' }),
      item.status === 'not_connected' ? null
        : el('button', { type: 'button', class: 'btn btn--ghost btn--danger', 'data-act': 'disconnect', text: 'Disconnect' })
    ]);
    form.appendChild(actions);

    var result = el('p', { class: 'hint', 'data-role': 'result' });
    form.appendChild(result);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var config = {};
      [].slice.call(form.querySelectorAll('input')).forEach(function (i) {
        if (i.value.trim()) config[i.name] = i.value.trim();
      });
      if (!Object.keys(config).length) {
        result.textContent = 'Nothing to save — every field is blank.';
        return;
      }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Saving…';
      API.saveIntegration(school, item.provider, config).then(function (r) {
        say(r.missing && r.missing.length
          ? 'Saved. Still needed: ' + r.missing.join(', ')
          : item.label + ' connected.');
        load();
      }).catch(function (err) {
        result.textContent = err.message || 'Could not save.';
        btn.disabled = false; btn.textContent = 'Save';
      });
    });

    actions.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'test') {
        e.target.disabled = true; var was = e.target.textContent; e.target.textContent = 'Testing…';
        result.textContent = '';
        API.testIntegration(school, item.provider).then(function (r) {
          result.textContent = r.detail || (r.ok ? 'Connection works.' : 'Connection failed.');
          result.className = 'hint ' + (r.ok ? 'hint--ok' : 'hint--bad');
          e.target.disabled = false; e.target.textContent = was;
          if (r.ok) load();
        }).catch(function (err) {
          result.textContent = err.message || 'Could not test the connection.';
          result.className = 'hint hint--bad';
          e.target.disabled = false; e.target.textContent = was;
        });
      }
      if (act === 'disconnect') {
        // Disconnecting deletes the stored credential. A school that clicks it
        // by accident has to go back to Daraja for a new one, so it asks.
        if (!window.confirm('Disconnect ' + item.label + '? The stored credentials are deleted, ' +
                            'and you will need them again to reconnect.')) return;
        API.disconnectIntegration(school, item.provider).then(function () {
          say(item.label + ' disconnected.');
          load();
        }).catch(function (err) { say(err.message || 'Could not disconnect.', 'err'); });
      }
    });

    body.appendChild(el('p', { class: 'muted', text: item.purpose || '' }));
    if (item.where_to_find) {
      body.appendChild(el('details', { class: 'where' }, [
        el('summary', { text: 'Where do I find these?' }),
        el('p', { class: 'muted', text: item.where_to_find })
      ]));
    }
    body.appendChild(form);

    return el('section', { class: 'card' }, [
      el('header', { class: 'card__head' }, [
        el('h2', { text: item.label || item.provider }), badge
      ]),
      body
    ]);
  }

  function load() {
    var list = document.getElementById('integrations-list');
    list.setAttribute('aria-busy', 'true');
    API.listIntegrations(school).then(function (r) {
      list.innerHTML = '';
      var note = document.getElementById('enc-note');
      note.textContent = r.encryption === 'on'
        ? 'Keys are encrypted before they are stored, and are never shown again in full.'
        : 'Secrets cannot be stored: the server has no encryption key set (SHULE_SECRET_KEY).';
      note.className = 'hint ' + (r.encryption === 'on' ? 'hint--ok' : 'hint--bad');
      (r.items || []).forEach(function (i) { list.appendChild(card(i)); });
      list.setAttribute('aria-busy', 'false');
      list.setAttribute('data-ready', '1');
    }).catch(function (err) {
      list.innerHTML = '';
      list.appendChild(el('p', { class: 'hint hint--bad',
        text: err.status === 403
          ? 'Only a school administrator can see how the school is connected.'
          : (err.message || 'Could not load the integrations.') }));
      list.setAttribute('aria-busy', 'false');
      list.setAttribute('data-ready', '1');
    });
  }

  function loadBilling() {
    var box = document.getElementById('billing-box');
    API.getSubscription(school).then(function (s) {
      box.innerHTML = '';
      var rows = [
        ['Plan', s.plan_name || s.plan_slug || '—'],
        ['Status', s.status || '—'],
        ['Price', s.price_kes != null ? 'KES ' + Number(s.price_kes).toLocaleString('en-KE') + ' / month' : '—'],
        ['Modules', (s.active_modules || []).join(', ') || '—']
      ];
      if (s.trial_days_left != null) rows.push(['Trial', s.trial_days_left + ' days left']);
      var dl = el('dl', { class: 'kv' });
      rows.forEach(function (r) {
        dl.appendChild(el('dt', { text: r[0] }));
        dl.appendChild(el('dd', { text: String(r[1]) }));
      });
      box.appendChild(dl);
      box.setAttribute('aria-busy', 'false');
    }).catch(function (err) {
      box.innerHTML = '';
      box.appendChild(el('p', { class: 'hint hint--bad',
        text: err.status === 404 ? 'This school has no subscription on record.'
                                 : (err.message || 'Could not load the plan.') }));
      box.setAttribute('aria-busy', 'false');
    });
  }

  function loadProfile() {
    var box = document.getElementById('profile-box');
    API.getMe().then(function (me) {
      box.innerHTML = '';
      var dl = el('dl', { class: 'kv' });
      [['School', me.tenant_name || '—'],
       ['Signed in as', me.full_name || me.email || '—'],
       ['Role', me.role_name || '—'],
       ['Email confirmed', me.email_verified_at ? 'Yes' : 'Not yet']].forEach(function (r) {
        dl.appendChild(el('dt', { text: r[0] }));
        dl.appendChild(el('dd', { text: String(r[1]) }));
      });
      box.appendChild(dl);
      box.setAttribute('aria-busy', 'false');
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(el('p', { class: 'hint', text: 'Could not load the profile.' }));
      box.setAttribute('aria-busy', 'false');
    });
  }

  load();
  loadBilling();
  loadProfile();
})();

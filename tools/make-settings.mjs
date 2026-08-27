/** Generates app/settings.html through the shell generator, like every other page. */
import fs from 'node:fs';
import path from 'node:path';
import { page, ROOT } from './shell.mjs';

const content = `
<main class="wrap" id="settings-page">
  <header class="phead">
    <div>
      <h1>Settings</h1>
      <p class="phead__sub">How this school is set up, and what it is connected to.</p>
    </div>
  </header>

  <div class="tabs" role="tablist" aria-label="Settings sections">
    <button class="tab is-on" role="tab" aria-selected="true" data-tab="integrations" id="tab-integrations">Integrations</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="billing" id="tab-billing">Plan &amp; billing</button>
    <button class="tab" role="tab" aria-selected="false" data-tab="profile" id="tab-profile">School profile</button>
  </div>

  <!-- ── Integrations ──────────────────────────────────────────────────── -->
  <section class="tabpanel" role="tabpanel" aria-labelledby="tab-integrations" data-panel="integrations">
    <p class="hint" id="enc-note"></p>
    <div id="integrations-list" class="stack" aria-busy="true">
      <p class="muted">Loading…</p>
    </div>
  </section>

  <!-- ── Billing ───────────────────────────────────────────────────────── -->
  <section class="tabpanel" role="tabpanel" aria-labelledby="tab-billing" data-panel="billing" hidden>
    <div id="billing-box" class="stack" aria-busy="true">
      <p class="muted">Loading…</p>
    </div>
  </section>

  <!-- ── Profile ───────────────────────────────────────────────────────── -->
  <section class="tabpanel" role="tabpanel" aria-labelledby="tab-profile" data-panel="profile" hidden>
    <div id="profile-box" class="stack" aria-busy="true">
      <p class="muted">Loading…</p>
    </div>
  </section>
</main>
`;

const html = page({
  pageRel: 'settings.html',
  role: 'admin',
  title: 'Settings — Shule',
  desc: 'Connect M-Pesa, email and SMS, and see the school’s plan.',
  content,
  pageJs: 'settings',
  pageCss: 'settings'
});

fs.writeFileSync(path.join(ROOT, 'app', 'settings.html'), html);
console.log('app/settings.html written');

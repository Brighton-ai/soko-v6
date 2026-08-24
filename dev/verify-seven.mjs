/** The seven expectations from the static read, checked against the running system. */
import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('dev/seed-live.json', 'utf8'));
const API = S.api;
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token };

async function req(method, route, body) {
  const res = await fetch(API + route, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json, text };
}
const GET = (r) => req('GET', r);
const POST = (r, b) => req('POST', r, b);
const PUT = (r, b) => req('PUT', r, b);
const d = (r) => (r.body && r.body.data !== undefined ? r.body.data : r.body);
const line = (n, verdict, detail) => console.log(`\n[${n}] ${verdict}\n    ${detail}`);

const results = [];
function record(n, expectation, confirmed, detail) {
  results.push({ n, expectation, confirmed, detail });
  line(n, confirmed === true ? 'CONFIRMED' : confirmed === false ? 'NOT CONFIRMED' : 'INCONCLUSIVE', detail);
}

const money = (v) => (v === null || v === undefined ? 'null' : Number(v).toLocaleString('en-KE'));

// ── 1. guardian portal 500s on a valid token ─────────────────────────────
async function one() {
  const issued = await POST(`/school/students/${S.student_ids[0]}/guardian-token`, {});
  if (issued.status !== 200) {
    return record(1, 'portal 500s on a valid token', null,
      `could not issue a token: ${issued.status} ${issued.text.slice(0, 140)}`);
  }
  const token = d(issued).token;
  const portal = await GET(`/school/guardian-portal/${token}`);
  record(1, 'portal 500s on a valid token', portal.status >= 500,
    `POST guardian-token → 200, token ${String(token).slice(0, 12)}…  ` +
    `then GET /guardian-portal/{token} → ${portal.status}. ` +
    `Body: ${portal.text.slice(0, 180)}`);
  return token;
}

// ── 2. merit list 500s for the same reason ───────────────────────────────
async function two() {
  const r = await GET(`/school/exams/${S.exam_id}/merit-list?school_id=${S.school_id}`);
  record(2, 'merit-list 500s (marks_obtained)', r.status >= 500,
    `GET /exams/{id}/merit-list → ${r.status}. Body: ${r.text.slice(0, 180)}`);
}

// ── 3. class position only ever 1 or 2 ───────────────────────────────────
async function three() {
  // give five pupils clearly different totals
  const scores = [95, 80, 65, 50, 35];
  const res = await POST(`/school/exams/${S.exam_id}/results`, {
    exam_id: S.exam_id, class_id: S.class_ids[0],
    results: S.student_ids.slice(0, 3).map((id, i) => ({
      student_id: id, subject_id: S.subject_ids[0], score: scores[i]
    })).concat(S.student_ids.slice(0, 3).map((id, i) => ({
      student_id: id, subject_id: S.subject_ids[1], score: scores[i]
    })))
  });
  if (res.status !== 200) {
    return record(3, 'class position only 1 or 2', null, `could not save results: ${res.status} ${res.text.slice(0, 160)}`);
  }
  const positions = [];
  for (const sid of S.student_ids.slice(0, 3)) {
    const card = await POST('/school/report-cards', {
      school_id: S.school_id, student_id: sid, class_id: S.class_ids[0], term_id: S.term_id
    });
    if (card.status !== 200) { positions.push(`${sid.slice(0, 8)}:ERR ${card.status}`); continue; }
    positions.push(d(card).class_position);
  }
  const distinct = [...new Set(positions.filter((p) => typeof p === 'number'))];
  record(3, 'class position only 1 or 2',
    distinct.length > 0 && distinct.every((p) => p === 1 || p === 2),
    `three pupils with means 95, 80, 65 → positions ${JSON.stringify(positions)}. ` +
    `Distinct values: ${JSON.stringify(distinct)}. Expected 1, 2, 3.`);
}

// ── 4. /pay records money and posts nothing to the ledger ────────────────
async function four() {
  const before = await GET(`/school/fee-invoices?school_id=${S.school_id}&per_page=100`);
  const inv = (d(before).items || d(before) || []).filter((i) => Number(i.balance) > 1000)[0];
  if (!inv) return record(4, '/pay posts nothing to the GL', null, 'no invoice with a balance');

  const glBefore = await glTotals();
  const pay = await POST(`/school/fee-invoices/${inv.id}/pay`, { amount: 1000 });
  const glAfter = await glTotals();
  record(4, '/pay posts nothing to the GL',
    pay.status === 200 && glAfter.debits === glBefore.debits,
    `POST /fee-invoices/{id}/pay 1,000 → ${pay.status}. ` +
    `GL debits ${money(glBefore.debits)} → ${money(glAfter.debits)} ` +
    `(moved ${money(glAfter.debits - glBefore.debits)}).`);
  return inv;
}

// ── 5. over-payment accepted on /pay-with-journal ────────────────────────
async function five() {
  const list = await GET(`/school/fee-invoices?school_id=${S.school_id}&per_page=100`);
  const inv = (d(list).items || d(list) || []).filter((i) => Number(i.balance) > 1000)[0];
  if (!inv) return record(5, 'over-payment accepted', null, 'no invoice with a balance');
  const over = Number(inv.balance) + 8000;
  const pay = await POST(`/school/fee-invoices/${inv.id}/pay-with-journal`, { amount: over });
  const after = d(pay);
  record(5, 'over-payment accepted',
    pay.status === 200,
    `invoice balance ${money(inv.balance)}, sent ${money(over)} → HTTP ${pay.status}. ` +
    (pay.status === 200
      ? `Result: amount_paid ${money(after && after.amount_paid)}, balance ${money(after && after.balance)}, ` +
        `status "${after && after.status}". amount_due is ${money(inv.amount_due)}, so the school now shows ` +
        `${money((after && after.amount_paid) - inv.amount_due)} more received than was ever charged.`
      : `refused: ${pay.text.slice(0, 160)}`));
  return inv;
}

// ── 6. a payment after a waiver wipes the discount ───────────────────────
async function six() {
  const list = await GET(`/school/fee-invoices?school_id=${S.school_id}&per_page=100`);
  const inv = (d(list).items || d(list) || []).filter((i) => Number(i.balance) > 6000)[0];
  if (!inv) return record(6, 'payment after waiver wipes the discount', null, 'no suitable invoice');

  const w = await POST('/school/fee-waivers', { invoice_id: inv.id, amount: 5000, reason: 'Contract test bursary' });
  if (w.status !== 200) return record(6, 'payment after waiver wipes the discount', null, `waiver create ${w.status}`);
  const approve = await PUT(`/school/fee-waivers/${d(w).id}/approve`, {});
  const afterWaiver = await one_invoice(inv.id);

  const pay = await POST(`/school/fee-invoices/${inv.id}/pay-with-journal`, { amount: 1 });
  const afterPay = await one_invoice(inv.id);

  const wiped = Number(afterPay.balance) > Number(afterWaiver.balance);
  record(6, 'payment after waiver wipes the discount', wiped,
    `start: due ${money(inv.amount_due)}, paid ${money(inv.amount_paid)}, balance ${money(inv.balance)}, ` +
    `discount ${money(inv.discount_amount)}\n    ` +
    `after 5,000 waiver (approve → ${approve.status}): balance ${money(afterWaiver.balance)}, ` +
    `discount ${money(afterWaiver.discount_amount)}\n    ` +
    `after paying 1: balance ${money(afterPay.balance)}, discount ${money(afterPay.discount_amount)}, ` +
    `paid ${money(afterPay.amount_paid)}\n    ` +
    `→ the bursary ${wiped ? 'did NOT survive: balance rose by ' +
      money(Number(afterPay.balance) - Number(afterWaiver.balance)) +
      ' when one shilling was paid' : 'survived'}.`);
  return inv;
}

// ── 7. approving a waiver twice applies twice ────────────────────────────
async function seven() {
  const list = await GET(`/school/fee-invoices?school_id=${S.school_id}&per_page=100`);
  const inv = (d(list).items || d(list) || []).filter((i) => Number(i.balance) > 5000)[0];
  if (!inv) return record(7, 'double approval applies twice', null, 'no suitable invoice');

  const w = await POST('/school/fee-waivers', { invoice_id: inv.id, amount: 2000, reason: 'Contract test double-click' });
  const wid = d(w).id;
  const a1 = await PUT(`/school/fee-waivers/${wid}/approve`, {});
  const after1 = await one_invoice(inv.id);
  const a2 = await PUT(`/school/fee-waivers/${wid}/approve`, {});
  const after2 = await one_invoice(inv.id);

  const twice = Number(after2.discount_amount) > Number(after1.discount_amount);
  record(7, 'double approval applies twice', twice,
    `approve #1 → ${a1.status}: balance ${money(after1.balance)}, discount ${money(after1.discount_amount)}\n    ` +
    `approve #2 → ${a2.status}: balance ${money(after2.balance)}, discount ${money(after2.discount_amount)}\n    ` +
    `→ a 2,000 bursary was applied ${twice ? 'TWICE — discount rose by ' +
      money(Number(after2.discount_amount) - Number(after1.discount_amount)) +
      ' on the second click' : 'once'}.`);
}

async function one_invoice(id) {
  const r = await GET(`/school/fee-invoices?school_id=${S.school_id}&per_page=100`);
  return (d(r).items || d(r) || []).filter((i) => i.id === id)[0] || {};
}

async function glTotals() {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.env.PSQL || '/usr/lib/postgresql/18/bin/psql',
    [process.env.DATABASE_URL || 'postgresql://shule@127.0.0.1:55432/sokoos', '-t', '-A', '-c',
     `SELECT COALESCE(SUM(debit),0)||','||COALESCE(SUM(credit),0) FROM journal_lines`],
    { encoding: 'utf8' }).trim();
  const [debits, credits] = out.split(',').map(Number);
  return { debits, credits };
}

console.log('══ the seven verifications, against a running backend ══');
await one(); await two(); await three(); await four(); await five(); await six(); await seven();

console.log('\n══ summary ══');
results.forEach((r) => console.log(
  `  ${String(r.n).padEnd(2)} ${(r.confirmed === true ? 'CONFIRMED' : r.confirmed === false ? 'NOT CONFIRMED' : 'INCONCLUSIVE').padEnd(14)} ${r.expectation}`));
fs.writeFileSync('dev/verify-seven.json', JSON.stringify(results, null, 2));

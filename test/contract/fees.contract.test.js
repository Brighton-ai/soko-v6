'use strict';
/** Money rules. Every one of these must hold against production. */
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openAPI, SCHOOL, rule, because, fixtures, resetFixtures, authenticate } = require('./backend.js');

before(async () => { await authenticate(); });

let API, F;
beforeEach(async () => { API = openAPI(); resetFixtures(); F = await fixtures(API); });


/**
 * A pending waiver the test owns.
 *
 * school.py has POST /fee-waivers and no list route, so a test that starts by
 * listing pending waivers is testing plumbing rather than the rule. This makes
 * one and returns it with the invoice it is against — the same on both backends.
 */
async function pendingWaiver(amount) {
  const page = await API.listInvoiceRows(SCHOOL, { pageSize: 100 });
  const inv = page.items.filter((i) => i.balance > amount + 1000)[0];
  if (!inv) return null;
  const created = await API.createWaiver(SCHOOL, {
    invoiceId: inv.id, amount, reason: 'Contract test bursary'
  });
  return { waiver: created, invoice: inv };
}

const owing = async (min = 1) =>
  (await API.listInvoiceRows(SCHOOL, { pageSize: 100000 })).items
    .filter((i) => i.balance >= min)[0];

describe('Contract — fees', () => {
  it(rule(1, 'balance = amount_due − amount_paid − discount_amount', 'school.py:815, :1978'), async () => {
    const page = await API.listInvoiceRows(SCHOOL, { pageSize: 100000 });
    const bad = page.items
      .filter((i) => i.balance !== i.amount_due - i.amount_paid - (i.discount_amount || 0))
      .map((i) => `${i.id}: ${i.amount_due} − ${i.amount_paid} − ${i.discount_amount || 0} ≠ ${i.balance}`);
    assert.deepEqual(bad.slice(0, 8), [],
      `The balance identity does not hold:\n  ${bad.slice(0, 8).join('\n  ')}` +
      because(1, 'school.py:815 and :1978 compute amount_due − amount_paid and ignore discount_amount'));
  });

  it(rule(2, 'a payment cannot exceed the balance', 'school.py:1976'), async () => {
    const inv = await owing(100);
    assert.ok(inv, 'No invoice with a balance to over-pay.');
    let err = null;
    await API.recordPayment(SCHOOL, inv.id, { amount: inv.balance + 1, method: 'cash' })
      .catch((e) => { err = e; });
    assert.ok(err,
      `A payment of ${inv.balance + 1} against a balance of ${inv.balance} was accepted.` +
      because(2, 'school.py:1976 takes body["amount"] unchecked; :818 clamps balance but amount_paid keeps the overage'));
    assert.equal(err.status, 422, `The refusal came back as ${err.status}, expected 422.` + because(2));
  });

  it(rule(2, 'a rejected over-payment mutates nothing'), async () => {
    const inv = await owing(100);
    let err = null;
    await API.recordPayment(SCHOOL, inv.id, { amount: inv.balance + 5000, method: 'cash' })
      .catch((e) => { err = e; });
    assert.ok(err, 'The over-payment was accepted.' + because(2));
    const after = (await API.listInvoiceRows(SCHOOL, { pageSize: 100000 })).items
      .filter((i) => i.id === inv.id)[0];
    assert.equal(after.amount_paid, inv.amount_paid,
      `amount_paid moved from ${inv.amount_paid} to ${after.amount_paid} on a rejected payment.` + because(2));
    assert.equal(after.balance, inv.balance,
      `balance moved from ${inv.balance} to ${after.balance} on a rejected payment.` + because(2));
  });

  it(rule(2, 'a zero or negative payment is refused'), async () => {
    const inv = await owing(100);
    for (const amount of [0, -1, -5000]) {
      let err = null;
      await API.recordPayment(SCHOOL, inv.id, { amount, method: 'cash' }).catch((e) => { err = e; });
      assert.ok(err, `A payment of ${amount} was accepted.` + because(2));
    }
  });

  it(rule(3, 'a part payment leaves part_paid; a clearing payment leaves cleared', 'school.py:816'), async () => {
    const inv = await owing(5000);
    const part = await API.recordPayment(SCHOOL, inv.id, { amount: 1000, method: 'cash' });
    assert.equal(part.invoice.status, 'part_paid',
      `Paying 1000 of ${inv.balance} left status "${part.invoice.status}".` + because(3));
    assert.equal(part.invoice.balance, inv.balance - 1000,
      `The balance is ${part.invoice.balance}, expected ${inv.balance - 1000}.` + because(3));

    const rest = await API.recordPayment(SCHOOL, inv.id, { amount: part.invoice.balance, method: 'mpesa', reference: 'C1' });
    assert.equal(rest.invoice.balance, 0, `The balance is ${rest.invoice.balance} after paying it off.` + because(3));
    assert.equal(rest.invoice.status, 'cleared',
      `The invoice reads "${rest.invoice.status}" after being paid in full.` + because(3));
  });

  it(rule(4, 'every payment posts a balanced double entry', 'school.py:1985, test_school_fees.py:63'), async () => {
    const before = await API.listJournalLines(SCHOOL, {});
    const inv = await owing(2000);
    await API.recordPayment(SCHOOL, inv.id, { amount: 1500, method: 'mpesa', reference: 'GL1' });
    const after = await API.listJournalLines(SCHOOL, {});

    assert.ok(after.balanced,
      `The ledger is out by ${after.debits - after.credits} after a payment.` +
      because(4, 'school.py:807 records a payment with no journal posting at all; only :1968 /pay-with-journal posts'));
    assert.equal(after.debits - before.debits, 1500,
      `Debits moved by ${after.debits - before.debits} on a payment of 1500.` + because(4));
    assert.equal(after.credits - before.credits, 1500,
      `Credits moved by ${after.credits - before.credits} on a payment of 1500.` + because(4));
  });

  it(rule(5, 'a waiver discounts the charge and never reduces amount_due', 'school.py:919'), async () => {
    const made = await pendingWaiver(5000);
    assert.ok(made, 'No invoice with enough balance to waive against.');
    const w = { id: made.waiver.id, amount: 5000 };
    const before = made.invoice;

    const r = await API.approveWaiver(SCHOOL, w.id, {});
    assert.equal(r.invoice.amount_due, before.amount_due,
      `amount_due moved from ${before.amount_due} to ${r.invoice.amount_due}. The charge keeps its face value.` +
      because(5, 'school.py:919 reduces balance and increments discount_amount'));
    assert.equal(r.invoice.discount_amount, (before.discount_amount || 0) + w.amount,
      `discount_amount is ${r.invoice.discount_amount} after a waiver of ${w.amount}.` + because(5));
    assert.equal(r.invoice.balance, before.balance - w.amount,
      `The balance is ${r.invoice.balance}, expected ${before.balance - w.amount}.` + because(5));
  });

  it(rule(6, 'approving a waiver twice discounts once', 'school.py:908'), async () => {
    const made = await pendingWaiver(2000);
    assert.ok(made, 'No invoice with enough balance to waive against.');
    const w = { id: made.waiver.id, amount: 2000 };
    const first = await API.approveWaiver(SCHOOL, w.id, {});
    const afterFirst = { due: first.invoice.amount_due, discount: first.invoice.discount_amount, balance: first.invoice.balance };

    const second = await API.approveWaiver(SCHOOL, w.id, {});
    const now = (await API.listInvoiceRows(SCHOOL, { pageSize: 100000 })).items
      .filter((i) => i.id === first.invoice.id)[0];

    assert.equal(second.already, true,
      'The second approval did not report the waiver as already applied.' +
      because(6, "school.py:908 sets status='approved' unconditionally, then :919 discounts again"));
    assert.equal(now.discount_amount, afterFirst.discount,
      `discount_amount went from ${afterFirst.discount} to ${now.discount_amount} on a repeat approval.` + because(6));
    assert.equal(now.balance, afterFirst.balance,
      `The balance went from ${afterFirst.balance} to ${now.balance} on a repeat approval.` + because(6));
  });

  it(rule(31, 'approving a waiver posts to the general ledger'), async () => {
    const made = await pendingWaiver(3000);
    assert.ok(made, 'No invoice with enough balance to waive against.');
    const w = { id: made.waiver.id, amount: 3000 };
    const before = await API.listJournalLines(SCHOOL, {});
    await API.approveWaiver(SCHOOL, w.id, {});
    const after = await API.listJournalLines(SCHOOL, {});
    assert.ok(after.debits > before.debits,
      `A waiver of ${w.amount} posted nothing to the ledger.` +
      because(31, 'school.py:900-921 approve_waiver never calls post_journal'));
    assert.ok(after.balanced,
      `The ledger is out by ${after.debits - after.credits} after a waiver.` + because(31));
  });

  it(rule(7, 'bulk generate skips pupils already invoiced for that term', 'school.py:793'), async () => {
    const classes = Array.isArray(await API.listClasses(SCHOOL, {})) ? await API.listClasses(SCHOOL, {}) : [];
    const cls = classes[1] || classes[0];
    const first = await API.bulkGenerateInvoices(SCHOOL, {
      classId: cls.id, termId: 't3-2026', dueDate: '2026-10-02',
      structureId: F.structureId || `fee-${cls.id}-t2-2026`
    });
    assert.ok(first.created > 0, 'The first run created nothing.' + because(7));

    const second = await API.bulkGenerateInvoices(SCHOOL, {
      classId: cls.id, termId: 't3-2026', dueDate: '2026-10-02',
      structureId: F.structureId || `fee-${cls.id}-t2-2026`
    });
    assert.equal(second.created, 0,
      `Running bulk generate twice created ${second.created} more invoices.` +
      because(7, 'school.py:793 ON CONFLICT (student_id,term,year) DO NOTHING'));
    assert.equal(second.skipped, first.created,
      `${second.skipped} were reported skipped; ${first.created} already had an invoice.` + because(7));
  });

  it(rule(7, 'a pupil has at most one invoice per term, whatever their class'), async () => {
    const page = await API.listInvoiceRows(SCHOOL, { pageSize: 100000 });
    const seen = {};
    const dupes = [];
    page.items.forEach((i) => {
      const key = `${i.student_id}|${i.term_id}`;
      if (seen[key]) dupes.push(`${i.student_id} in ${i.term_id}: ${seen[key]} and ${i.id}`);
      seen[key] = i.id;
    });
    assert.deepEqual(dupes.slice(0, 5), [],
      `Pupils holding two invoices for one term:\n  ${dupes.slice(0, 5).join('\n  ')}` + because(7));
  });

  it(rule(29, 'reminders never pass three'), async () => {
    const d = await API.listDefaulterRows(SCHOOL, {});
    const target = d.items.filter((r) => !r.exhausted)[0];
    assert.ok(target, 'No chaseable invoice.');
    for (let n = 0; n < 6; n++) {
      await API.sendRemindersFor(SCHOOL, { invoiceIds: [target.invoice_id] });
    }
    const after = (await API.listDefaulterRows(SCHOOL, {})).items
      .filter((r) => r.invoice_id === target.invoice_id)[0];
    assert.ok(after.reminders_sent <= 3,
      `The invoice is at ${after.reminders_sent} reminders after six sends.` +
      because(29, 'school.py:2033-2068 sends reminders with no per-invoice counter or cap'));
  });
});

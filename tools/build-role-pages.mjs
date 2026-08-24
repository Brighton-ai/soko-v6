/** Builds the teacher and parent pages. Run: node tools/build-role-pages.mjs */
import fs from 'node:fs';
import path from 'node:path';
import * as shell from './shell.mjs';

const ROOT = shell.ROOT;
const write = (rel, html) => {
  const file = path.join(ROOT, 'app', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  console.log('wrote app/' + rel);
};

const ico = (paths, size = 15, sw = '1.8') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const TICK = ico('<path d="m20 6-11 11-5-5"/>', 20, '2.4');
const WARN = ico('<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>', 20);

const skel = (n = 6) => '<span class="sk sk--row"></span>'.repeat(n);
const empty = (title, body, bad = false) =>
  `<div class="empty${bad ? ' empty--bad' : ''}">\n` +
  `            <span class="empty__ico">${bad ? WARN : TICK}</span>\n` +
  `            <b>${title}</b>\n            <p>${body}</p>\n          </div>`;

const regions = (loading, content, emptyHtml, flush = true) =>
  `  <div class="card__b${flush ? ' card__b--flush' : ''}">\n` +
  `    <div data-region="loading" class="sk-rows">${loading}</div>\n` +
  `    <div data-region="content" hidden>\n${content}\n    </div>\n` +
  `    <div data-region="empty" hidden>${emptyHtml}</div>\n  </div>`;

const panel = (id, body, title, sub, headExtra = '', state) =>
  `<section class="card" data-panel="${id}"${state ? ` data-state="${state}"` : ''}>\n` +
  (title ? `  <div class="card__h">\n    <div>\n      <h2>${title}</h2>\n` +
           (sub ? `      <p>${sub}</p>\n` : '') + `    </div>\n    ${headExtra}\n  </div>\n` : '') +
  `${body}\n</section>`;

const phead = (title, sub, actions = '') =>
  `<div class="phd">\n    <div>\n      <h1>${title}</h1>\n      <p>${sub}</p>\n    </div>\n` +
  `    <div class="phd__act">${actions}</div>\n  </div>`;

const table = (tbodyId, cols, caption) => {
  const head = cols.map(([, label, cls]) => `<th scope="col"${cls ? ` class="${cls}"` : ''}>${label}</th>`).join('');
  return `      <div class="tbl-scroll">\n        <table class="tbl">\n` +
    `          <caption class="vh">${caption}</caption>\n` +
    `          <thead><tr>${head}</tr></thead>\n          <tbody id="${tbodyId}"></tbody>\n` +
    `        </table>\n      </div>`;
};

// ══════════════════════════════════════════════════════════════ teacher
write('teacher/dashboard.html', shell.page({
  pageRel: 'teacher/dashboard.html', role: 'teacher', pageJs: 'teacher',
  title: 'My day — Shule',
  desc: 'A teacher’s day at Riverside Academy: today’s periods, registers still to mark, marks due before the deadline, and the classes they teach.',
  content: `<main class="content">
  ${phead('My day', '<span data-bind="today-long">Thursday 20 August</span> · <span data-bind="teacher-name">—</span>')}

  <div class="grid grid--kpi">
    <div class="kpi" data-kpi="periods"><p class="kpi__l">Periods today</p>
      <span class="kpi__v" data-kpi-value>—</span><p class="kpi__d" data-kpi-delta></p></div>
    <div class="kpi" data-kpi="registers"><p class="kpi__l">Registers to mark</p>
      <span class="kpi__v" data-kpi-value>—</span><p class="kpi__d" data-kpi-delta></p></div>
    <div class="kpi" data-kpi="marks"><p class="kpi__l">Mark sheets outstanding</p>
      <span class="kpi__v" data-kpi-value>—</span><p class="kpi__d" data-kpi-delta></p></div>
    <div class="kpi" data-kpi="classes"><p class="kpi__l">My classes</p>
      <span class="kpi__v" data-kpi-value>—</span><p class="kpi__d" data-kpi-delta></p></div>
  </div>

  <div class="grid grid--2 mt">
    ${panel('periods', regions(skel(5),
      table('period-rows', [['', 'Period'], ['', 'Time'], ['', 'Class'], ['', 'Subject'], ['', 'Room']],
        'Today’s teaching periods'),
      empty('Nothing timetabled today', 'No periods are assigned to you on this day.')),
      'Today', 'Where you are, hour by hour')}

    ${panel('registers', regions(skel(3),
      `      <div class="stack" id="register-list"></div>`,
      empty('No registers of your own', 'You are not the class teacher for any class this term.')),
      'My registers', 'The ones you are responsible for')}
  </div>

  <div class="grid grid--2 mt">
    ${panel('marks', regions(skel(5),
      table('mark-rows', [['', 'Exam'], ['', 'Class'], ['', 'Subject'], ['', 'Entered', 'r'], ['', 'Due'], ['', '']],
        'Mark sheets not yet complete'),
      empty('Every mark sheet is in', 'Nothing is outstanding against your assignments.')),
      'Marks outstanding', 'Before the entry deadline')}

    ${panel('classes', regions(skel(5),
      table('class-rows', [['', 'Class'], ['', 'Subjects'], ['', 'Roll', 'r'], ['', 'Role']],
        'The classes this teacher is assigned to'),
      empty('No classes assigned', 'Nothing is assigned to you this term.')),
      'My classes', 'What you are assigned to')}
  </div>

  <div class="grid mt">
    ${panel('announcements', regions(skel(3),
      `      <div class="stack" id="announcement-list"></div>`,
      empty('Nothing new', 'No announcements for staff at the moment.')),
      'Staff announcements', 'The last few notices')}
  </div>
</main>`
}));

write('teacher/register.html', shell.page({
  pageRel: 'teacher/register.html', role: 'teacher', pageJs: 'teacher',
  title: 'My register — Shule',
  desc: 'Take the register for a class you teach at Riverside Academy: present, absent or late per pupil, with a note on absences and running tallies.',
  content: `<main class="content">
  ${phead('My register', 'Only the classes you teach appear here')}

  ${panel('register',
    `    <div class="filters">
      <div class="field">
        <label for="r-class">Class</label>
        <select id="r-class" name="class"></select>
      </div>
      <div class="field">
        <label for="r-date">Date</label>
        <input type="date" id="r-date" name="date">
      </div>
      <div class="filters__end">
        <button type="button" class="btn btn--ghost btn--sm" id="mark-all">Mark all present</button>
      </div>
    </div>
` + regions(skel(9),
      `      <div class="tally" id="tally"></div>\n` +
      table('roll', [['', 'Pupil'], ['', 'Adm. no'], ['', 'Present'], ['', 'Absent'], ['', 'Late'], ['', 'Note']],
        'The register for the selected class and date') +
      `\n      <div class="regfoot">
        <p id="reg-state" class="sub"></p>
        <button type="button" class="btn btn--solid btn--sm" id="submit-register">Submit register</button>
      </div>`,
      empty('Nothing to mark', 'Pick one of your classes to open its register.')))}
</main>`
}));

write('teacher/marks.html', shell.page({
  pageRel: 'teacher/marks.html', role: 'teacher', pageJs: 'teacher',
  title: 'Enter marks — Shule',
  desc: 'Mark entry for a teacher at Riverside Academy, restricted to their own subject assignments, with grades derived live from the exam’s grading scale.',
  content: `<main class="content">
  ${phead('Enter marks', 'Your subject assignments only — and you cannot verify your own')}

  ${panel('sheet',
    `    <div class="filters">
      <div class="field">
        <label for="f-exam">Exam</label>
        <select id="f-exam" name="exam"></select>
      </div>
      <div class="field">
        <label for="f-assignment">Class and subject</label>
        <select id="f-assignment" name="assignment"></select>
      </div>
      <div class="filters__end">
        <span class="filters__n" data-bind="sheet-state">—</span>
      </div>
    </div>
` + regions(skel(9),
      `      <div class="sheetbar" id="sheetbar"></div>\n` +
      table('rows', [['', 'Pupil'], ['', 'Adm. no'], ['', 'Score'], ['', 'Grade'],
                     ['', 'Points', 'r'], ['', 'Comment'], ['', 'Status']],
        'Mark entry for the selected exam, class and subject') +
      `\n      <div class="regfoot">
        <p id="sheet-note" class="sub"></p>
        <button type="button" class="btn btn--solid btn--sm" id="save-marks">Save marks</button>
      </div>`,
      empty('Nothing to mark', 'Pick an exam and one of your assignments.')))}

  <div class="grid mt">
    <div class="notice">
      <b>Verification is somebody else’s signature.</b> Marks you enter stay unverified
      until a head of department signs them off, and a mark you change goes back to
      unverified even if it had already been checked.
    </div>
  </div>
</main>`
}));

write('teacher/timetable.html', shell.page({
  pageRel: 'teacher/timetable.html', role: 'teacher', pageJs: 'teacher',
  title: 'My timetable — Shule',
  desc: 'A teacher’s week at Riverside Academy: every period they teach, by day and time, with the class, subject and room.',
  content: `<main class="content">
  ${phead('My timetable', '<span data-bind="periods-week">—</span> periods a week')}

  ${panel('timetable', regions(skel(6),
    `      <div class="tbl-scroll">
        <table class="tbl week">
          <caption class="vh">Teaching periods by day and time</caption>
          <thead><tr id="week-head"></tr></thead>
          <tbody id="week-rows"></tbody>
        </table>
      </div>`,
    empty('Nothing timetabled', 'No periods are assigned to you this term.')))}
</main>`
}));

// ═══════════════════════════════════════════════════════════════ parent
const CHILDBAR = `  <div class="childbar" id="childbar" role="tablist" aria-label="My children"></div>`;

const parentPage = (rel, title, desc, heading, sub, body) => write(rel, shell.page({
  pageRel: rel, role: 'parent', pageJs: 'parent', title, desc,
  content: `<main class="content">
  ${phead(heading, sub)}

${CHILDBAR}

${body}
</main>`
}));

parentPage('parent/index.html', 'My children — Shule',
  'A guardian’s view of their children at Riverside Academy: fee balance, attendance and published results for each child on one page.',
  'My children', 'Everything the school has for each of them',
  `  <div class="grid grid--kpi" id="child-kpis"></div>

  <div class="grid grid--2 mt">
    ${panel('summary', regions(skel(5),
      `      <dl class="dgrid" id="child-profile"></dl>`,
      empty('Nothing here yet', 'This child’s record has not been set up.'), false),
      'This child', 'Class, admission number and who you are to them')}

    ${panel('notices', regions(skel(4),
      `      <div class="stack" id="notice-list"></div>`,
      empty('Nothing to read', 'No announcements for guardians at the moment.')),
      'From the school', 'The most recent notices')}
  </div>`);

parentPage('parent/fees.html', 'Fee statement — Shule',
  'A guardian’s fee statement at Riverside Academy: what was invoiced, what has been paid, the balance, and how to pay it on M-Pesa.',
  'Fee statement', 'What is owed, and how to clear it',
  `  <div class="grid grid--kpi" id="fee-kpis"></div>

  <div class="grid grid--2 mt">
    ${panel('invoices', regions(skel(4),
      table('invoice-rows', [['', 'Term'], ['', 'Invoiced', 'r'], ['', 'Paid', 'r'],
                             ['', 'Balance', 'r'], ['', 'Due'], ['', 'Status']],
        'Invoices raised for this child'),
      empty('No invoices yet', 'Nothing has been billed for this child.')),
      'Invoices', 'Term by term',
      '<button type="button" class="btn btn--solid btn--sm" data-modal-open="modal-pay">Pay now</button>')}

    ${panel('receipts', regions(skel(4),
      table('receipt-rows', [['', 'Date'], ['', 'Amount', 'r'], ['', 'Method'], ['', 'Reference']],
        'Payments received for this child'),
      empty('No payments yet', 'Nothing has been received against this child’s invoices.')),
      'Receipts', 'Every payment the school has recorded')}
  </div>

<div class="scrim" id="modal-pay" role="dialog" aria-modal="true" aria-labelledby="modal-pay-t">
  <div class="modal">
    <div class="modal__h">
      <div>
        <h2 id="modal-pay-t">Pay on M-Pesa</h2>
        <p>Payments reconcile against the invoice automatically, usually within a minute.</p>
      </div>
      <button type="button" class="modal__x" data-modal-close aria-label="Close">
        ${ico('<path d="M18 6 6 18M6 6l12 12"/>', 16, '2')}
      </button>
    </div>
    <div class="modal__b">
      <ol class="paysteps" id="pay-steps"></ol>
      <p class="modal__note">You can pay any amount towards the balance. Part payments are normal
      and reduce what is owed straight away.</p>
    </div>
    <div class="modal__f">
      <button type="button" class="btn btn--solid btn--sm" data-modal-close>Done</button>
    </div>
  </div>
</div>`);

parentPage('parent/attendance.html', 'Attendance — Shule',
  'A guardian’s view of their child’s attendance at Riverside Academy: the term percentage and every day marked, present, late, absent or excused.',
  'Attendance', 'Every day the register was taken',
  `  <div class="grid grid--kpi" id="att-kpis"></div>

  <div class="grid mt">
    ${panel('attendance', regions(skel(6),
      `      <div style="padding:16px">
        <p style="font-size:12.6px;margin-bottom:12px">Oldest first. Hover a day for the date and the mark.</p>
        <div class="cal" id="calendar"></div>
        <div class="callegend">
          <span><i class="present"></i>Present</span><span><i class="late"></i>Late</span>
          <span><i class="absent"></i>Absent</span><span><i class="excused"></i>Excused</span>
        </div>
      </div>`,
      empty('Nothing recorded', 'No register has been taken for this child yet.')),
      'This term', 'Day by day')}
  </div>`);

parentPage('parent/results.html', 'Results — Shule',
  'A guardian’s view of published results at Riverside Academy: only cards the head has signed off, and only marks a head of department has verified.',
  'Results', 'Published report cards only — nothing before the head signs it off',
  `  <div class="grid mt" id="card-list"></div>

  ${panel('results', regions(skel(6),
    `      <div id="results-body"></div>`,
    empty('Nothing published yet', 'When the head signs off this term’s report card it appears here. Marks still being checked are not shown.')),
    'Report cards', 'What the school has released')}`);

parentPage('parent/messages.html', 'Messages — Shule',
  'Announcements and term dates for guardians at Riverside Academy, with the school’s contact details and the events still to come.',
  'Messages', 'What the school has sent to guardians',
  `  <div class="grid grid--2 mt">
    ${panel('messages', regions(skel(5),
      `      <div class="stack" id="message-list"></div>`,
      empty('Nothing to read', 'No announcements have gone out to guardians.')),
      'Announcements', 'Newest first')}

    ${panel('events', regions(skel(4),
      table('event-rows', [['', 'Date'], ['', 'What'], ['', 'Kind']], 'Dates in the school calendar'),
      empty('Nothing in the diary', 'No dates are on the calendar.')),
      'Term dates', 'What is coming up')}
  </div>`);

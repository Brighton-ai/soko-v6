/**
 * Shule — seeded demo dataset for Riverside Academy.
 *
 * Everything here is generated from a fixed seed, so two loads produce a
 * byte-identical dataset. Nothing in this file may call Math.random() or read
 * the wall clock: the tests recompute KPIs from this data and compare them
 * against what the dashboard rendered, which only works if both sides see the
 * same numbers.
 *
 * In step 4 this file is deleted and assets/js/api.js talks to FastAPI instead.
 * Nothing outside api.js is allowed to read window.DEMO_DATA.
 */
(function (global) {
  'use strict';

  // ── seeded pseudo-random ──────────────────────────────────────────────
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(20260620);
  function rand() { return rnd(); }
  function int(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function chance(p) { return rand() < p; }
  function round(n, step) { return Math.round(n / step) * step; }

  // ── dates (UTC only, so the dataset does not shift with the timezone) ──
  var TODAY = '2026-08-20';               // Thursday, week 7 of Term 2 2026
  function d(iso) { return new Date(iso + 'T00:00:00Z'); }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function addDays(isoStr, n) {
    var t = d(isoStr); t.setUTCDate(t.getUTCDate() + n); return iso(t);
  }
  function isWeekend(isoStr) { var w = d(isoStr).getUTCDay(); return w === 0 || w === 6; }
  /** The n most recent school days ending at (and including) `end`. */
  function schoolDays(end, n) {
    var out = [], cur = end;
    while (out.length < n) {
      if (!isWeekend(cur)) out.unshift(cur);
      cur = addDays(cur, -1);
    }
    return out;
  }
  function stamp(isoStr, h, m) {
    return isoStr + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00+03:00';
  }

  // ── name pools ────────────────────────────────────────────────────────
  var FIRST_F = ['Amina','Cynthia','Esther','Faith','Grace','Halima','Joy','Lucy','Mercy','Naomi',
    'Purity','Rehema','Sharon','Tabitha','Wanjiru','Zawadi','Achieng','Chelimo','Nafula','Wairimu',
    'Nasimiyu','Kanini','Mwikali','Njeri','Atieno','Kagure','Sifa','Baraka','Neema','Imani'];
  var FIRST_M = ['Brian','David','Elijah','Felix','Gideon','Isaac','Kevin','Mark','Nicholas','Oscar',
    'Peter','Samuel','Timothy','Victor','Wycliffe','Kiptoo','Otieno','Mwangi','Kamau','Ochieng',
    'Barasa','Mutiso','Kibet','Onyango','Njoroge','Wafula','Kipruto','Odhiambo','Karanja','Musyoka'];
  var LAST = ['Achieng','Barasa','Chebet','Gitau','Hassan','Juma','Kamau','Kariuki','Kimani','Kiptoo',
    'Langat','Maina','Mbugua','Mutua','Mwangi','Njoroge','Ochieng','Odhiambo','Okello','Omondi',
    'Onyango','Otieno','Ouma','Wafula','Wairimu','Wanjala','Wanjiru','Waweru','Cheruiyot','Nyambura'];

  function fullName(gender) {
    return (gender === 'F' ? pick(FIRST_F) : pick(FIRST_M)) + ' ' + pick(LAST);
  }
  function phone() {
    var prefix = pick(['0722','0733','0710','0715','0720','0728','0741','0759','0768','0790']);
    var n = String(int(100000, 999999));
    return prefix + ' ' + n.slice(0, 3) + ' ' + n.slice(3);
  }
  function mpesaCode() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', N = '0123456789', s = '';
    for (var i = 0; i < 3; i++) s += A[Math.floor(rand() * A.length)];
    for (var j = 0; j < 7; j++) s += N[Math.floor(rand() * N.length)];
    return s;
  }

  // ── school & terms ────────────────────────────────────────────────────
  var SCHOOL_ID = 'sch-riverside';
  var school = {
    id: SCHOOL_ID,
    name: 'Riverside Academy',
    short_name: 'Riverside',
    motto: 'Learn. Serve. Lead.',
    town: 'Nairobi',
    county: 'Nairobi',
    address: 'Riverside Drive, Westlands, Nairobi',
    phone: '+254 700 000 000',
    email: 'office@riverside.ac.ke',
    paybill: '522533',
    terms_per_year: 3,
    curriculum: 'CBC',
    current_term_id: 't2-2026'
  };

  var terms = [
    { id: 't1-2026', school_id: SCHOOL_ID, name: 'Term 1', year: 2026, index: 1,
      starts_on: '2026-01-06', ends_on: '2026-04-03', is_current: false,
      enrolment: 233, amount_invoiced: 6318400, amount_collected: 5876112, outstanding: 442288 },
    { id: 't2-2026', school_id: SCHOOL_ID, name: 'Term 2', year: 2026, index: 2,
      starts_on: '2026-05-04', ends_on: '2026-08-07', is_current: true,
      enrolment: null, amount_invoiced: null, amount_collected: null, outstanding: null },
    { id: 't3-2026', school_id: SCHOOL_ID, name: 'Term 3', year: 2026, index: 3,
      starts_on: '2026-09-07', ends_on: '2026-11-27', is_current: false,
      enrolment: null, amount_invoiced: null, amount_collected: null, outstanding: null }
  ];
  var TERM_ID = 't2-2026';

  // ── classes ───────────────────────────────────────────────────────────
  var CLASS_SPEC = [
    ['cls-g4e', 'Grade 4', 'East', 'primary',           29],
    ['cls-g5w', 'Grade 5', 'West', 'primary',           31],
    ['cls-g6e', 'Grade 6', 'East', 'primary',           30],
    ['cls-g6w', 'Grade 6', 'West', 'primary',           28],
    ['cls-g7e', 'Grade 7', 'East', 'junior_secondary',  32],
    ['cls-g7w', 'Grade 7', 'West', 'junior_secondary',  30],
    ['cls-g8e', 'Grade 8', 'East', 'junior_secondary',  31],
    ['cls-g9e', 'Grade 9', 'East', 'junior_secondary',  29]
  ];
  var classes = CLASS_SPEC.map(function (c, i) {
    return {
      id: c[0], school_id: SCHOOL_ID, name: c[1], stream: c[2],
      full_name: c[1] + ' ' + c[2], level: c[3], sort_order: i,
      capacity: 34, class_teacher_id: null, room: 'Block ' + (i < 4 ? 'A' : 'B') + ' · Rm ' + (101 + i)
    };
  });
  var classById = {};
  classes.forEach(function (c) { classById[c.id] = c; });

  // ── subjects ──────────────────────────────────────────────────────────
  var subjects = [
    { id: 'sub-mat', school_id: SCHOOL_ID, code: 'MAT', name: 'Mathematics',        category: 'core',      levels: ['primary', 'junior_secondary'] },
    { id: 'sub-eng', school_id: SCHOOL_ID, code: 'ENG', name: 'English',            category: 'core',      levels: ['primary', 'junior_secondary'] },
    { id: 'sub-kis', school_id: SCHOOL_ID, code: 'KIS', name: 'Kiswahili',          category: 'core',      levels: ['primary', 'junior_secondary'] },
    { id: 'sub-sci', school_id: SCHOOL_ID, code: 'SCI', name: 'Integrated Science', category: 'core',      levels: ['primary', 'junior_secondary'] },
    { id: 'sub-soc', school_id: SCHOOL_ID, code: 'SOC', name: 'Social Studies',     category: 'core',      levels: ['primary', 'junior_secondary'] },
    { id: 'sub-cre', school_id: SCHOOL_ID, code: 'CRE', name: 'Religious Education',category: 'core',      levels: ['primary', 'junior_secondary'] },
    { id: 'sub-agr', school_id: SCHOOL_ID, code: 'AGR', name: 'Agriculture',        category: 'optional',  levels: ['junior_secondary'] },
    { id: 'sub-bus', school_id: SCHOOL_ID, code: 'BUS', name: 'Business Studies',   category: 'optional',  levels: ['junior_secondary'] },
    { id: 'sub-art', school_id: SCHOOL_ID, code: 'ART', name: 'Creative Arts',      category: 'optional',  levels: ['primary'] }
  ];
  function subjectsForLevel(level) {
    return subjects.filter(function (s) { return s.levels.indexOf(level) !== -1; });
  }

  // ── teachers ──────────────────────────────────────────────────────────
  var TEACHER_SPEC = [
    ['Margaret Wanjiru',   'F', 'Head of Mathematics'],
    ['Joseph Otieno',      'M', 'Head of Languages'],
    ['Ann Chebet',         'F', 'Class teacher'],
    ['Samuel Kariuki',     'M', 'Head of Sciences'],
    ['Beatrice Mutua',     'F', 'Class teacher'],
    ['Patrick Wafula',     'M', 'Deputy head, academics'],
    ['Caroline Njeri',     'F', 'Class teacher'],
    ['Dennis Ochieng',     'M', 'Class teacher'],
    ['Lydia Kimani',       'F', 'Head of Humanities'],
    ['Emmanuel Barasa',    'M', 'Class teacher'],
    ['Hellen Achieng',     'F', 'Class teacher'],
    ['Charles Mwangi',     'M', 'Head of Creative Arts']
  ];
  var teachers = TEACHER_SPEC.map(function (t, i) {
    return {
      id: 'tch-' + String(i + 1).padStart(2, '0'),
      school_id: SCHOOL_ID,
      name: t[0], gender: t[1], role_title: t[2],
      tsc_number: 'TSC/' + int(200000, 899999),
      email: t[0].toLowerCase().replace(/[^a-z]+/g, '.') + '@riverside.ac.ke',
      phone: phone(),
      is_class_teacher: false,
      class_id: null,
      status: 'active'
    };
  });
  // eight of the twelve are class teachers
  classes.forEach(function (c, i) {
    var t = teachers[i];
    t.is_class_teacher = true;
    t.class_id = c.id;
    c.class_teacher_id = t.id;
  });

  // ── subject assignments: teacher → subject → class ────────────────────
  var assignments = [];
  classes.forEach(function (c) {
    subjectsForLevel(c.level).forEach(function (s, si) {
      var t = teachers[(classes.indexOf(c) * 3 + si * 5) % teachers.length];
      assignments.push({
        id: 'asg-' + c.id + '-' + s.id,
        school_id: SCHOOL_ID, term_id: TERM_ID,
        class_id: c.id, subject_id: s.id, teacher_id: t.id,
        periods_per_week: s.category === 'core' ? 5 : 3
      });
    });
  });

  // ── students ──────────────────────────────────────────────────────────
  var students = [];
  var admSeq = 2301;
  classes.forEach(function (c) {
    var size = CLASS_SPEC[classes.indexOf(c)][4];
    for (var i = 0; i < size; i++) {
      var gender = chance(0.5) ? 'F' : 'M';
      var name = fullName(gender);
      // a handful of pupils carry a scholarship; most carry none
      var scholarship = 0;
      if (chance(0.075)) scholarship = round(int(4000, 18000), 500);
      students.push({
        id: 'stu-' + admSeq,
        school_id: SCHOOL_ID,
        admission_no: 'ADM/' + admSeq,
        name: name,
        gender: gender,
        class_id: c.id,
        date_of_birth: iso(d('2026-01-01')) && (2026 - (c.sort_order < 4 ? int(9, 12) : int(12, 15))) + '-' + String(int(1, 12)).padStart(2, '0') + '-' + String(int(1, 28)).padStart(2, '0'),
        scholarship_amount: scholarship,
        boarding: false,
        transport_route_id: chance(0.28) ? pick(['rt-ngong', 'rt-kikuyu', 'rt-kasarani']) : null,
        status: 'active',
        admitted_on: (2026 - int(0, 4)) + '-01-06'
      });
      admSeq++;
    }
  });
  var studentById = {};
  students.forEach(function (s) { studentById[s.id] = s; });
  function studentsIn(classId) {
    return students.filter(function (s) { return s.class_id === classId; });
  }

  // ── fee structures (Term 2 2026, itemised per class) ───────────────────
  var feeStructures = classes.map(function (c) {
    var junior = c.level === 'junior_secondary';
    var items = [
      { name: 'Tuition',  amount: junior ? 22000 : 16500, mandatory: true },
      { name: 'Activity', amount: junior ? 3500 : 2800,   mandatory: true },
      { name: 'Lunch',    amount: 6000,                   mandatory: true }
    ];
    if (junior) items.push({ name: 'Science lab', amount: 2500, mandatory: true });
    items.push({ name: 'Transport', amount: 5500, mandatory: false });
    var total = items.reduce(function (n, it) { return n + (it.mandatory ? it.amount : 0); }, 0);
    return {
      id: 'fee-' + c.id + '-' + TERM_ID,
      school_id: SCHOOL_ID, class_id: c.id, term_id: TERM_ID,
      items: items,
      total_mandatory: total,
      optional_total: items.reduce(function (n, it) { return n + (it.mandatory ? 0 : it.amount); }, 0)
    };
  });
  var feeStructureByClass = {};
  feeStructures.forEach(function (f) { feeStructureByClass[f.class_id] = f; });

  // ── guardians: many per student, exactly one primary ──────────────────
  var RELATIONS = ['Mother', 'Father', 'Aunt', 'Uncle', 'Grandmother', 'Grandfather', 'Guardian'];
  var guardians = [];
  var gSeq = 1;
  students.forEach(function (s) {
    var surname = s.name.split(' ')[1];
    var count = chance(0.62) ? 2 : (chance(0.5) ? 1 : 3);
    for (var i = 0; i < count; i++) {
      var female = chance(0.55);
      var rel = i === 0 ? (female ? 'Mother' : 'Father') : pick(RELATIONS);
      var gname = (female ? pick(FIRST_F) : pick(FIRST_M)) + ' ' + surname;
      guardians.push({
        id: 'gdn-' + String(gSeq++).padStart(5, '0'),
        school_id: SCHOOL_ID,
        student_id: s.id,
        name: gname,
        relationship: rel,
        phone: phone(),
        email: chance(0.45) ? gname.toLowerCase().replace(/[^a-z]+/g, '.') + '@gmail.com' : null,
        // exactly one primary per student — the first guardian on the record
        is_primary: i === 0,
        is_emergency: i === 0 ? chance(0.4) : chance(0.7),
        occupation: pick(['Teacher', 'Trader', 'Farmer', 'Driver', 'Nurse', 'Civil servant', 'Self-employed'])
      });
    }
  });
  // the student record mirrors its primary guardian, for lists that need one line
  students.forEach(function (s) {
    var primary = guardians.filter(function (g) { return g.student_id === s.id && g.is_primary; })[0];
    s.guardian_name = primary.name;
    s.guardian_phone = primary.phone;
    s.guardian_relation = primary.relationship;
  });

  // ── waivers: bursary and hardship requests ────────────────────────────
  // An APPROVED waiver has already been applied and reduces amount_due below.
  // A PENDING one has not: approving it in the app is what reduces the balance.
  var waiverStudents = students.filter(function (s) { return s.scholarship_amount > 0; });
  var waivers = waiverStudents.map(function (s, i) {
    var pending = i < 5;
    return {
      id: 'wvr-' + String(i + 1).padStart(3, '0'),
      school_id: SCHOOL_ID, term_id: TERM_ID,
      student_id: s.id, class_id: s.class_id,
      amount: s.scholarship_amount,
      reason: pick(['Bursary — county fund', 'Staff child concession',
                    'Hardship case reviewed by board', 'Sponsored — alumni fund']),
      status: pending ? 'pending' : 'approved',
      requested_by: 'tch-06',
      requested_on: '2026-05-1' + int(0, 9),
      approved_by: pending ? null : 'tch-06',
      approved_on: pending ? null : '2026-05-2' + int(0, 8),
      applied: !pending
    };
  });
  var approvedWaiverFor = {}, pendingWaiverFor = {};
  waivers.forEach(function (w) {
    if (w.status === 'approved') approvedWaiverFor[w.student_id] = w.amount;
    else if (w.status === 'pending') pendingWaiverFor[w.student_id] = w.amount;
  });

  // ── invoices: ~78% cleared, ~14% part paid, ~8% untouched ─────────────
  var TARGET = { cleared: 187, part_paid: 34, unpaid: 19 };  // 240 pupils
  var pool = [];
  Object.keys(TARGET).forEach(function (k) {
    for (var i = 0; i < TARGET[k]; i++) pool.push(k);
  });
  // deterministic Fisher–Yates so the mix is spread across classes, not blocked
  for (var p = pool.length - 1; p > 0; p--) {
    var q = Math.floor(rand() * (p + 1));
    var tmp = pool[p]; pool[p] = pool[q]; pool[q] = tmp;
  }

  // One term due date, plus the payment arrangements a bursar actually grants.
  // The spread is what gives the defaulters page four populated aging buckets
  // instead of one; today is 2026-08-20.
  var DUE_CHOICES = [
    { date: '2026-05-08', weight: 0.10 },   // 104 days past due -> 90+
    { date: '2026-05-22', weight: 0.34 },   //  90 days          -> 61–90
    { date: '2026-06-19', weight: 0.22 },   //  62 days          -> 61–90
    { date: '2026-07-10', weight: 0.20 },   //  41 days          -> 31–60
    { date: '2026-08-07', weight: 0.14 }    //  13 days          -> 0–30
  ];
  function dueDate() {
    var r = rand(), acc = 0;
    for (var i = 0; i < DUE_CHOICES.length; i++) {
      acc += DUE_CHOICES[i].weight;
      if (r <= acc) return DUE_CHOICES[i].date;
    }
    return DUE_CHOICES[1].date;
  }
  var invoices = [];
  var payments = [];
  var paySeq = 1;
  var termDays = schoolDays(TODAY, 60);

  students.forEach(function (s, idx) {
    var fs = feeStructureByClass[s.class_id];
    var due = fs.total_mandatory + (s.transport_route_id ? 5500 : 0) - (approvedWaiverFor[s.id] || 0);
    var status = pool[idx];
    // A family waiting on a bursary decision has not started paying, and a
    // waiver can never exceed what is still owed — so a pending request always
    // sits against an untouched invoice.
    if (pendingWaiverFor[s.id]) status = 'unpaid';
    var paid = 0, reminders = 0;

    if (status === 'cleared') {
      paid = due;
    } else if (status === 'part_paid') {
      paid = round(due * (0.25 + rand() * 0.5), 500);
      if (paid >= due) paid = due - 1000;
      reminders = int(1, 3);
    } else {
      paid = 0;
      reminders = int(1, 3);
    }

    var inv = {
      id: 'inv-' + s.id + '-' + TERM_ID,
      school_id: SCHOOL_ID, term_id: TERM_ID,
      student_id: s.id, class_id: s.class_id,
      items: fs.items.filter(function (it) { return it.mandatory || s.transport_route_id; }),
      amount_due: due,
      amount_paid: paid,
      balance: due - paid,
      due_date: dueDate(),
      status: status,
      reminders_sent: reminders,
      mpesa_code: paid > 0 ? mpesaCode() : null,
      issued_on: '2026-05-06'
    };
    invoices.push(inv);

    // split what was paid into one or two receipts across the term
    if (paid > 0) {
      var splits = (status === 'cleared' && chance(0.35)) ? 2 : 1;
      var remaining = paid;
      for (var k = 0; k < splits; k++) {
        var amt = (k === splits - 1) ? remaining : round(paid * (0.4 + rand() * 0.2), 500);
        if (amt <= 0) amt = remaining;
        remaining -= amt;
        var day = termDays[int(0, termDays.length - 1)];
        payments.push({
          id: 'pay-' + String(paySeq++).padStart(5, '0'),
          school_id: SCHOOL_ID, term_id: TERM_ID,
          invoice_id: inv.id, student_id: s.id, class_id: s.class_id,
          amount: amt,
          method: chance(0.88) ? 'mpesa' : 'bank',
          mpesa_code: k === 0 ? inv.mpesa_code : mpesaCode(),
          paid_at: stamp(day, int(7, 19), int(0, 59)),
          reconciled: true
        });
        if (remaining <= 0) break;
      }
    }
  });
  payments.sort(function (a, b) { return a.paid_at < b.paid_at ? -1 : a.paid_at > b.paid_at ? 1 : 0; });

  // ── attendance: 60 school days, ~94% present, clustered ───────────────
  var attendance = [];
  var attSeq = 1;
  // two of the eight classes have not marked today's register yet
  var UNMARKED_TODAY = ['cls-g6w', 'cls-g8e'];
  // a rolling per-student absence streak makes absence cluster rather than sprinkle
  var streak = {};
  students.forEach(function (s) { streak[s.id] = 0; });

  termDays.forEach(function (day) {
    classes.forEach(function (c) {
      if (day === TODAY && UNMARKED_TODAY.indexOf(c.id) !== -1) return;
      var teacher = teachers.filter(function (t) { return t.class_id === c.id; })[0];
      var markedAt = stamp(day, 8, int(5, 40));
      studentsIn(c.id).forEach(function (s) {
        var status;
        if (streak[s.id] > 0) {
          streak[s.id] -= 1;
          status = chance(0.75) ? 'absent' : 'present';
        } else if (chance(0.026)) {
          streak[s.id] = int(0, 2);            // a bout of illness runs a few days
          status = 'absent';
        } else if (chance(0.018)) {
          status = 'late';
        } else if (chance(0.006)) {
          status = 'excused';
        } else {
          status = 'present';
        }
        attendance.push({
          id: 'att-' + String(attSeq++).padStart(6, '0'),
          school_id: SCHOOL_ID, term_id: TERM_ID,
          student_id: s.id, class_id: c.id,
          date: day,
          status: status,
          note: status === 'excused' ? pick(['Hospital appointment', 'Family bereavement', 'Sports fixture']) : null,
          marked_by: teacher ? teacher.id : null,
          marked_at: markedAt
        });
      });
    });
  });

  // ── grading scales ────────────────────────────────────────────────────
  // Bands must tile 0..max_score with no gap and no overlap. A school that
  // defines 0–39, 40–49 and 51–59 has a hole at 50, and a pupil who scores 50
  // gets no grade at all — so the editor refuses to save until it is clean.
  var gradingScales = [
    {
      id: 'grd-844', school_id: SCHOOL_ID,
      name: 'Riverside 8-4-4 letter grades',
      description: 'Eleven letter bands with points, used for the secondary streams and every summative exam.',
      max_score: 100, is_default: true, effective_from: '2026-01-06',
      bands: [
        { grade: 'E',  min: 0,  max: 29,  points: 1,  remark: 'Well below expectation' },
        { grade: 'D',  min: 30, max: 39,  points: 2,  remark: 'Below expectation' },
        { grade: 'D+', min: 40, max: 44,  points: 3,  remark: 'Below expectation' },
        { grade: 'C-', min: 45, max: 49,  points: 4,  remark: 'Approaching expectation' },
        { grade: 'C',  min: 50, max: 54,  points: 5,  remark: 'Approaching expectation' },
        { grade: 'C+', min: 55, max: 59,  points: 6,  remark: 'Approaching expectation' },
        { grade: 'B-', min: 60, max: 64,  points: 7,  remark: 'Meeting expectation' },
        { grade: 'B',  min: 65, max: 69,  points: 8,  remark: 'Meeting expectation' },
        { grade: 'B+', min: 70, max: 74,  points: 9,  remark: 'Meeting expectation' },
        { grade: 'A-', min: 75, max: 79,  points: 10, remark: 'Exceeding expectation' },
        { grade: 'A',  min: 80, max: 100, points: 11, remark: 'Exceeding expectation' }
      ]
    },
    {
      id: 'grd-cbc', school_id: SCHOOL_ID,
      name: 'CBC performance levels',
      description: 'The four competency-based levels, for junior school formative assessment.',
      max_score: 100, is_default: false, effective_from: '2026-01-06',
      bands: [
        { grade: 'BE', min: 0,  max: 39,  points: 1, remark: 'Below expectation' },
        { grade: 'AE', min: 40, max: 59,  points: 2, remark: 'Approaching expectation' },
        { grade: 'ME', min: 60, max: 79,  points: 3, remark: 'Meeting expectation' },
        { grade: 'EE', min: 80, max: 100, points: 4, remark: 'Exceeding expectation' }
      ]
    }
  ];
  var gradingScale = gradingScales[0];        // the default, kept for readability below

  function bandFor(scale, score) {
    for (var i = 0; i < scale.bands.length; i++) {
      var b = scale.bands[i];
      if (score >= b.min && score <= b.max) return b;
    }
    return scale.bands[0];
  }
  function gradeFor(score) { return bandFor(gradingScale, score); }

  // ── exams and results ─────────────────────────────────────────────────
  var exams = [
    { id: 'exm-t2-mid', school_id: SCHOOL_ID, term_id: TERM_ID, name: 'Mid-term Exam',
      type: 'midterm', starts_on: '2026-06-22', ends_on: '2026-06-25', sat_on: '2026-06-25',
      max_score: 100, grading_scale_id: 'grd-844',
      class_ids: classes.map(function (c) { return c.id; }),
      status: 'marks_entered', results_entered: true },
    { id: 'exm-t2-end', school_id: SCHOOL_ID, term_id: TERM_ID, name: 'End-term Exam',
      type: 'endterm', starts_on: '2026-08-04', ends_on: '2026-08-06', sat_on: '2026-08-04',
      max_score: 100, grading_scale_id: 'grd-844',
      class_ids: classes.map(function (c) { return c.id; }),
      status: 'scheduled', results_entered: false },
    { id: 'exm-t2-cat', school_id: SCHOOL_ID, term_id: TERM_ID, name: 'Junior School CAT 2',
      type: 'cat', starts_on: '2026-07-14', ends_on: '2026-07-15', sat_on: '2026-07-15',
      max_score: 40, grading_scale_id: 'grd-cbc',
      class_ids: ['cls-g7e', 'cls-g7w', 'cls-g8e', 'cls-g9e'],
      status: 'scheduled', results_entered: false }
  ];

  var examResults = [];
  var resSeq = 1;
  students.forEach(function (s) {
    var c = classById[s.class_id];
    // a steady per-pupil ability, so results look like a pupil and not like noise
    var ability = 46 + rand() * 40;
    subjectsForLevel(c.level).forEach(function (sub) {
      var score = Math.max(6, Math.min(99, Math.round(ability + (rand() - 0.5) * 22)));
      var band = gradeFor(score);
      var asg = assignments.filter(function (a) {
        return a.class_id === c.id && a.subject_id === sub.id;
      })[0];
      examResults.push({
        id: 'res-' + String(resSeq++).padStart(6, '0'),
        school_id: SCHOOL_ID, term_id: TERM_ID,
        exam_id: 'exm-t2-mid',
        student_id: s.id, class_id: c.id, subject_id: sub.id,
        score: score, grade: band.grade, points: band.points, remark: band.remark,
        entered_by: asg ? asg.teacher_id : null,
        // three of the eight classes are still waiting on HoD verification
        verified: ['cls-g7w', 'cls-g8e', 'cls-g9e'].indexOf(c.id) === -1,
        verified_by: ['cls-g7w', 'cls-g8e', 'cls-g9e'].indexOf(c.id) === -1 ? 'tch-06' : null,
        verified_at: ['cls-g7w', 'cls-g8e', 'cls-g9e'].indexOf(c.id) === -1 ? '2026-07-08' : null,
        max_score: 100,
        comment: chance(0.12) ? pick(['Improving steadily', 'Needs more practice', 'Excellent effort', 'Must revise consistently']) : null
      });
    });
  });

  // ── report cards ──────────────────────────────────────────────────────
  // Positions are dense-ranked by average descending: ties share a position and
  // the next distinct average takes the position after it, so a class of 30 with
  // one tie at the top runs 1, 1, 2, 3 rather than 1, 1, 3, 4.
  var TEACHER_REMARKS = [
    'A steady term. Keep the reading going over the holiday.',
    'Much improved on last term — the effort is showing.',
    'Capable, but needs to hand work in on time.',
    'Quiet and consistent. Should speak up more in class.',
    'Strong in the sciences; give the languages the same attention.'
  ];
  var HEAD_REMARKS = [
    'A promising report. Well done.',
    'Solid work. Push on next term.',
    'There is more here than the marks show. Keep at it.',
    'Pleasing progress across the board.'
  ];

  var reportCards = [];
  classes.forEach(function (c) {
    var roll = studentsIn(c.id);
    var cards = roll.map(function (s) {
      var mine = examResults.filter(function (r) { return r.student_id === s.id && r.exam_id === 'exm-t2-mid'; });
      var total = mine.reduce(function (n, r) { return n + r.score; }, 0);
      var average = mine.length ? total / mine.length : 0;
      return {
        id: 'rpt-' + s.id + '-' + TERM_ID,
        school_id: SCHOOL_ID, term_id: TERM_ID, exam_id: 'exm-t2-mid',
        student_id: s.id, class_id: c.id,
        subject_count: mine.length,
        total_marks: total,
        average: Math.round(average * 10) / 10,
        mean_score: Math.round(average * 10) / 10,   // the dashboard's older name
        grade: bandFor(gradingScale, Math.round(average)).grade,
        points: mine.reduce(function (n, r) { return n + r.points; }, 0),
        position: null, class_size: roll.length,
        teacher_comment: pick(TEACHER_REMARKS),
        principal_comment: pick(HEAD_REMARKS),
        status: mine.length && mine.every(function (r) { return r.verified; }) ? 'published' : 'draft',
        published_at: null,
        published_by: null
      };
    });

    // dense rank on the rounded average, so what is printed is what is ranked
    var ordered = cards.slice().sort(function (a, b) { return b.average - a.average; });
    var position = 0, previous = null;
    ordered.forEach(function (card) {
      if (previous === null || card.average !== previous) { position += 1; previous = card.average; }
      card.position = position;
    });
    cards.forEach(function (card) {
      if (card.status === 'published') {
        card.published_at = '2026-07-10T16:00:00+03:00';
        card.published_by = 'tch-06';
      }
    });
    reportCards = reportCards.concat(cards);
  });

  // ── fee waivers ───────────────────────────────────────────────────────
  // ── discipline incidents ──────────────────────────────────────────────
  var DISC = [
    ['lateness', 'Arrived after the second bell for the third time this week.'],
    ['uniform', 'Out of uniform — no school jumper, second occasion this term.'],
    ['homework', 'Mathematics assignment not submitted twice running.'],
    ['conduct', 'Disruptive during Integrated Science; sent to the deputy.'],
    ['property', 'Broke a laboratory beaker while unsupervised.'],
    ['bullying', 'Reported for name-calling in the Grade 6 corridor.'],
    ['absconding', 'Left the compound at lunch without a gate pass.']
  ];
  var ACTIONS = ['Verbal warning', 'Guardian called', 'Detention — one hour',
                 'Referred to the deputy', 'Written warning on file', 'Community service — two days'];
  var discipline = [];
  var dSeq = 1;
  students.forEach(function (s) {
    if (!chance(0.16)) return;
    var n = chance(0.72) ? 1 : 2;
    for (var i = 0; i < n; i++) {
      var kind = pick(DISC);
      var teacher = teachers[int(0, teachers.length - 1)];
      discipline.push({
        id: 'dis-' + String(dSeq++).padStart(4, '0'),
        school_id: SCHOOL_ID, term_id: TERM_ID,
        student_id: s.id, class_id: s.class_id,
        date: termDays[int(0, termDays.length - 1)],
        category: kind[0],
        note: kind[1],
        action_taken: pick(ACTIONS),
        severity: pick(['low', 'low', 'medium', 'medium', 'high']),
        recorded_by: teacher.id,
        recorded_by_name: teacher.name
      });
    }
  });
  discipline.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  // ── general ledger ────────────────────────────────────────────────────
  // Every movement of money writes a debit and a matching credit. The sum of
  // debits equals the sum of credits after every operation, in the seed and
  // after anything the app does — assets/js/api.js keeps posting into this and
  // a test enforces the invariant.
  var ACCOUNTS = {
    cash_mpesa:      { code: '1010', name: 'Cash at bank — M-Pesa' },
    cash_bank:       { code: '1020', name: 'Cash at bank — current account' },
    fees_receivable: { code: '1200', name: 'Fees receivable' },
    bursary_expense: { code: '5300', name: 'Bursaries and waivers' }
  };
  var journalLines = [];
  var jSeq = 1;
  function post(entryId, date, source, sourceId, memo, debit, credit, amount) {
    journalLines.push({
      id: 'jnl-' + String(jSeq++).padStart(6, '0'), school_id: SCHOOL_ID, term_id: TERM_ID,
      entry_id: entryId, date: date, source: source, source_id: sourceId, memo: memo,
      side: 'debit', account: debit.name, account_code: debit.code, amount: amount
    });
    journalLines.push({
      id: 'jnl-' + String(jSeq++).padStart(6, '0'), school_id: SCHOOL_ID, term_id: TERM_ID,
      entry_id: entryId, date: date, source: source, source_id: sourceId, memo: memo,
      side: 'credit', account: credit.name, account_code: credit.code, amount: amount
    });
  }
  payments.forEach(function (p) {
    post('ent-' + p.id, p.paid_at.slice(0, 10), 'payment', p.id,
      'Fee payment ' + (p.mpesa_code || p.id),
      p.method === 'mpesa' ? ACCOUNTS.cash_mpesa : ACCOUNTS.cash_bank,
      ACCOUNTS.fees_receivable, p.amount);
  });
  waivers.filter(function (w) { return w.applied; }).forEach(function (w) {
    post('ent-' + w.id, w.approved_on, 'waiver', w.id,
      'Waiver approved — ' + w.reason,
      ACCOUNTS.bursary_expense, ACCOUNTS.fees_receivable, w.amount);
  });

  // ── announcements & events ────────────────────────────────────────────
  var announcements = [
    { id: 'ann-1', school_id: SCHOOL_ID, title: 'Term 2 closing date confirmed',
      body: 'Term 2 closes on Friday 7 August. Buses leave at 11.00am; boarders must be collected by 1.00pm.',
      audience: 'all', posted_by: 'tch-06', posted_at: stamp('2026-08-17', 9, 12), pinned: true },
    { id: 'ann-2', school_id: SCHOOL_ID, title: 'Mid-term results now with heads of department',
      body: 'Subject teachers have completed entry for the mid-term exam. Heads of department should verify by Friday so report cards can be published.',
      audience: 'staff', posted_by: 'tch-06', posted_at: stamp('2026-08-14', 16, 40), pinned: false },
    { id: 'ann-3', school_id: SCHOOL_ID, title: 'Fee balances — final reminder before closing',
      body: 'Guardians with an outstanding balance have been sent a statement. Please clear before the closing date to avoid carry-over into Term 3.',
      audience: 'guardians', posted_by: 'tch-06', posted_at: stamp('2026-08-12', 8, 5), pinned: true },
    { id: 'ann-4', school_id: SCHOOL_ID, title: 'Grade 9 career day — Thursday',
      body: 'Six alumni will speak to Grade 9 on Thursday from 11.00am in the hall. Normal lessons resume after lunch.',
      audience: 'all', posted_by: 'tch-09', posted_at: stamp('2026-08-11', 13, 22), pinned: false },
    { id: 'ann-5', school_id: SCHOOL_ID, title: 'Bus route 3 timing change',
      body: 'The Kasarani route now departs at 6.20am from Monday. Affected guardians have been sent an SMS.',
      audience: 'guardians', posted_by: 'tch-03', posted_at: stamp('2026-08-06', 17, 2), pinned: false },
    { id: 'ann-6', school_id: SCHOOL_ID, title: 'Staff meeting — Monday 4.00pm',
      body: 'Agenda: verification backlog, Term 3 timetable draft, and the new grading bands review.',
      audience: 'staff', posted_by: 'tch-06', posted_at: stamp('2026-08-03', 15, 45), pinned: false }
  ];

  var events = [
    { id: 'evt-1', school_id: SCHOOL_ID, title: 'End-term exams begin', starts_on: '2026-08-04', ends_on: '2026-08-06', category: 'academic' },
    { id: 'evt-2', school_id: SCHOOL_ID, title: 'Prize giving day',      starts_on: '2026-08-06', ends_on: '2026-08-06', category: 'school' },
    { id: 'evt-3', school_id: SCHOOL_ID, title: 'Term 2 closes',         starts_on: '2026-08-07', ends_on: '2026-08-07', category: 'school' },
    { id: 'evt-4', school_id: SCHOOL_ID, title: 'Term 3 opens',          starts_on: '2026-09-07', ends_on: '2026-09-07', category: 'school' }
  ];

  // ── current-term aggregates, so deltas are derivable ──────────────────
  var invoiced = invoices.reduce(function (n, i) { return n + i.amount_due; }, 0);
  var collected = invoices.reduce(function (n, i) { return n + i.amount_paid; }, 0);
  terms[1].enrolment = students.length;
  terms[1].amount_invoiced = invoiced;
  terms[1].amount_collected = collected;
  terms[1].outstanding = invoiced - collected;

  global.DEMO_DATA = {
    generated_with_seed: 20260620,
    today: TODAY,
    school: school,
    terms: terms,
    current_term_id: TERM_ID,
    classes: classes,
    subjects: subjects,
    teachers: teachers,
    assignments: assignments,
    students: students,
    guardians: guardians,
    fee_structures: feeStructures,
    invoices: invoices,
    payments: payments,
    attendance: attendance,
    exams: exams,
    exam_results: examResults,
    report_cards: reportCards,
    waivers: waivers,
    discipline: discipline,
    accounts: ACCOUNTS,
    journal_lines: journalLines,
    grading_scale: gradingScale,
    grading_scales: gradingScales,
    announcements: announcements,
    events: events
  };
})(typeof window !== 'undefined' ? window : globalThis);

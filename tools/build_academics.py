"""Builds the step-4 academics pages: grading scales, attendance, exams, results, report cards."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shell as A
from parts import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def write(name, html):
    open(os.path.join(ROOT, 'app', name), 'w', encoding='utf-8').write(html)
    print('wrote app/' + name)

# ══════════════════════════════════════════════════════════ grading scales
scale_body = regions(skel(4),
  table('rows', [('','Scale'),('','Bands','r'),('','Max score','r'),
                 ('','Bound exams','r'),('','Marks graded','r'),('','Coverage'),('','')],
        'Grading scales defined for this school'),
  empty('No grading scales yet', 'A scale turns a mark into a grade. Build one before setting an exam.'))

BAND_HEAD = ('          <div class="band__h"><span>Grade</span><span>From</span><span>To</span>'
             '<span>Points</span><span>Remark</span><span></span></div>')

m_scale = modal('modal-scale', 'Grading scale',
  'Bands must tile the whole range with no gap and no overlap — otherwise a pupil on the wrong side of a hole gets no grade at all.',
  field('sc-name', 'Scale name', inp('sc-name','name',extra=' placeholder="CBC performance levels"')) + "\n" +
  field('sc-max', 'Maximum score', inp('sc-max','max','number',' min="1" max="1000" step="1" value="100"')) + "\n" +
  field('sc-description', 'What it is for',
        inp('sc-description','description',extra=' placeholder="Junior school formative assessment"'), opt=True) + "\n" +
  '          <div>\n' + BAND_HEAD + '\n            <div class="bands" id="sc-bands"></div>\n'
  '            <p class="err" id="sc-bands-err" role="alert"></p>\n'
  '            <p style="margin-top:10px"><button type="button" class="btn btn--ghost btn--sm" id="sc-add-band">' + PLUS + ' Add a band</button></p>\n'
  '            <div class="coverage" id="sc-coverage" aria-live="polite"></div>\n'
  '          </div>',
  'Save scale', wide=True)

grading = f'''<main class="content">
  {phead('Grading scales', 'What a mark means at this school, band by band',
         '<button type="button" class="btn btn--solid btn--sm" id="new-scale">New scale</button>')}

  {panel('scales', scale_body)}
</main>

{m_scale}'''

write('grading-scales.html', A.page('grading-scales.html',
  'Grading scales — Shule',
  'Grading scales at Riverside Academy: band editors for CBC performance levels and 8-4-4 letter grades, validated to leave no score ungraded.',
  grading, page_js='grading-scales'))

# ══════════════════════════════════════════════════════════════ attendance
modes = ('  <div class="modes" role="tablist" aria-label="Attendance mode">\n'
         '    <button type="button" role="tab" id="mode-register" aria-controls="panel-register" '
         'aria-selected="true" data-mode="register">Take the register</button>\n'
         '    <button type="button" role="tab" id="mode-report" aria-controls="panel-report" '
         'aria-selected="false" data-mode="report">Report</button>\n'
         '  </div>')

reg_filters = filters([
  ffield('r-class', 'Class', '<select id="r-class" name="class"></select>'),
  ffield('r-date', 'Date', '<input type="date" id="r-date" name="date">'),
  ffield('r-teacher', 'Marked by', '<select id="r-teacher" name="teacher"></select>'),
], end='<button type="button" class="btn btn--ghost btn--sm" id="mark-all">Mark all present</button>')

reg_body = reg_filters + "\n" + regions(skel(9),
  '      <div class="tally" id="tally"></div>\n' +
  table('roll', [('','Pupil'),('','Adm. no'),('','Present'),('','Absent'),('','Late'),('','Note')],
        'Today’s register for the selected class') +
  '\n      <div class="regfoot">\n'
  '        <p id="reg-state" class="sub"></p>\n'
  '        <button type="button" class="btn btn--solid btn--sm" id="submit-register">Submit register</button>\n'
  '      </div>',
  empty('Nobody on this roll', 'That class has no active pupils, so there is no register to take.'))

rep_filters = filters([
  ffield('p-class', 'Class', '<select id="p-class" name="class"><option value="">All classes</option></select>'),
  ffield('p-from', 'From', '<input type="date" id="p-from" name="from">'),
  ffield('p-to', 'To', '<input type="date" id="p-to" name="to">'),
], end='<span class="filters__n" data-bind="report-count">—</span>')

rep_body = rep_filters + "\n" + regions(skel(8),
  '      <div class="qstats" style="border-radius:0;border-left:0;border-right:0;border-top:0" id="rep-stats"></div>\n'
  '      <div class="tbl-scroll">\n'
  '        <table class="tbl grid-tbl">\n'
  '          <caption class="vh">Attendance by pupil and day over the selected range</caption>\n'
  '          <thead><tr id="grid-head"></tr></thead>\n'
  '          <tbody id="grid-rows"></tbody>\n'
  '        </table>\n'
  '      </div>\n'
  '      <div class="absentees">\n'
  '        <div class="absentees__h">\n'
  '          <h2>Absentees</h2>\n'
  '          <div class="field"><label class="vh" for="a-date">Absentee date</label>\n'
  '            <input type="date" id="a-date" name="absentee_date"></div>\n'
  '        </div>\n'
  + table('absentee-rows', [('','Pupil'),('','Class'),('','Status'),('','Note'),('','Guardian')],
          'Pupils absent on the selected day') + '\n'
  '      </div>',
  empty('No attendance in that range', 'Widen the dates, or pick a class whose register has been taken.'))

attendance = f'''<main class="content">
  {phead('Attendance', 'Take the register, or look back over the term')}

{modes}

  <div class="tabpanel" role="tabpanel" id="panel-register" aria-labelledby="mode-register">
    {panel('register', reg_body)}
  </div>

  <div class="tabpanel" role="tabpanel" id="panel-report" aria-labelledby="mode-report" hidden>
    {panel('report', rep_body)}
  </div>
</main>'''

write('attendance.html', A.page('attendance.html',
  'Attendance — Shule',
  'Take a class register or review attendance at Riverside Academy: present, absent and late per pupil, term percentages and the daily absentee list.',
  attendance, page_js='attendance'))

# ══════════════════════════════════════════════════════════════════ exams
ex_filters = filters([
  ffield('f-term', 'Term', '<select id="f-term" name="term"></select>'),
  ffield('f-type', 'Type', '<select id="f-type" name="type"><option value="">All types</option></select>'),
], end='<span class="filters__n" data-bind="result-count">—</span>')

ex_body = ex_filters + "\n" + regions(skel(5),
  table('rows', [('','Exam'),('','Type'),('','Dates'),('','Out of','r'),
                 ('','Grading scale'),('','Classes','r'),('','Marks','r'),('','Status'),('','')],
        'Exams set for the term'),
  empty('No exams for this term', 'Set one, and bind it to the scale its marks will be graded against.'))

m_exam = modal('modal-exam', 'Exam',
  'An exam is bound to a grading scale when it is created. Once anything is marked, that binding is frozen.',
  field('ex-name', 'Exam name', inp('ex-name','name',extra=' placeholder="End-term Exam"')) + "\n" +
  field('ex-type', 'Type', sel('ex-type','type',
        '<option value="opener">Opener</option><option value="cat">CAT</option>'
        '<option value="midterm" selected>Mid-term</option><option value="endterm">End-term</option>'
        '<option value="mock">Mock</option>')) + "\n" +
  field('ex-term', 'Term', sel('ex-term','term')) + "\n" +
  '          <div class="calc__row">\n' +
  field('ex-starts', 'Starts', inp('ex-starts','starts','date')) + "\n" +
  field('ex-ends', 'Ends', inp('ex-ends','ends','date')) + "\n" +
  '          </div>\n' +
  field('ex-max', 'Marked out of', inp('ex-max','max','number',' min="1" max="1000" step="1" value="100"')) + "\n" +
  field('ex-scale', 'Grading scale', sel('ex-scale','scale')) + "\n" +
  field('ex-classes', 'Classes sitting it', sel('ex-classes','classes',extra=' multiple size="6"')) + "\n" +
  '          <p class="modal__note" id="ex-lock" hidden></p>',
  'Save exam', wide=True)

exams = f'''<main class="content">
  {phead('Exams', 'What is being sat this term, and what each mark will mean',
         '<button type="button" class="btn btn--solid btn--sm" id="new-exam">Set an exam</button>')}

  {panel('exams', ex_body)}
</main>

{m_exam}'''

write('exams.html', A.page('exams.html',
  'Exams — Shule',
  'Exams at Riverside Academy: set an exam, bind it to a grading scale, and see how many marks are entered and how many still need verifying.',
  exams, page_js='exams'))

# ════════════════════════════════════════════════════════════════ results
res_filters = filters([
  ffield('f-exam', 'Exam', '<select id="f-exam" name="exam"></select>'),
  ffield('f-class', 'Class', '<select id="f-class" name="class"></select>'),
  ffield('f-subject', 'Subject', '<select id="f-subject" name="subject"></select>'),
], end='<span class="filters__n" data-bind="sheet-state">—</span>')

sheet_body = res_filters + "\n" + regions(skel(9),
  '      <div class="sheetbar" id="sheetbar"></div>\n' +
  table('rows', [('','Pupil'),('','Adm. no'),('','Score'),('','Grade'),
                 ('','Points','r'),('','Comment'),('','Status')],
        'Mark entry for the selected exam, class and subject') +
  '\n      <div class="regfoot">\n'
  '        <p id="sheet-note" class="sub"></p>\n'
  '        <div style="display:flex;gap:8px;flex-wrap:wrap">\n'
  '          <button type="button" class="btn btn--ghost btn--sm" data-modal-open="modal-verify">Verify these marks</button>\n'
  '          <button type="button" class="btn btn--solid btn--sm" id="save-marks">Save marks</button>\n'
  '        </div>\n'
  '      </div>',
  empty('Nothing to mark', 'Pick an exam, a class and a subject to open the mark sheet.'))

analysis_body = regions(skel(5),
  '      <div class="qstats" style="border-radius:0;border-left:0;border-right:0;border-top:0" id="an-stats"></div>\n'
  + table('an-rows', [('','Subject'),('','Entries','r'),('','Mean','r'),
                      ('','Highest','r'),('','Lowest','r'),('','Unverified','r')],
          'Per-subject breakdown for the selected exam and class'),
  empty('No marks yet', 'Nothing has been entered for this exam and class.'))

merit_body = regions(skel(6),
  table('merit-rows', [('','Pos','r'),('','Pupil'),('','Class'),('','Subjects','r'),
                       ('','Total','r'),('','Average','r'),('','Points','r'),('','')],
        'Merit list for the selected exam, ranked by total'),
  empty('No merit list yet', 'Marks have to be entered before anyone can be ranked.'))

m_verify = modal('modal-verify', 'Verify marks',
  'Verification is a separate action under a different name. Whoever entered these marks cannot be the one to sign them off.',
  '          <div class="modal__note" id="verify-context">—</div>\n' +
  field('vf-by', 'Verified by', sel('vf-by','verified_by','<option value="">Choose who is verifying…</option>')) + "\n" +
  field('vf-scope', 'Scope', sel('vf-scope','scope',
        '<option value="subject">This subject in this class</option>'
        '<option value="class">Every subject in this class</option>')),
  'Verify')

results = f'''<main class="content">
  {phead('Results', 'Enter marks, verify them, and see what the class actually did')}

  {panel('sheet', sheet_body)}

  <div class="grid grid--2 mt">
    {panel('analysis', analysis_body, 'Class analysis', 'Mean, highest, lowest and the per-subject breakdown')}

    {panel('merit', merit_body, 'Merit list', 'Ranked by total marks; ties share a position')}
  </div>
</main>

{m_verify}'''

write('results.html', A.page('results.html',
  'Results — Shule',
  'Mark entry and verification at Riverside Academy: a grid per exam, class and subject with live grading, class analysis and the merit list.',
  results, page_js='results'))

# ═══════════════════════════════════════════════════════════ report cards
rc_filters = filters([
  ffield('f-class', 'Class', '<select id="f-class" name="class"></select>'),
  ffield('f-exam', 'Exam', '<select id="f-exam" name="exam"></select>'),
  ffield('f-status', 'Status',
         '<select id="f-status" name="status"><option value="">All</option>'
         '<option value="draft">Draft</option><option value="published">Published</option></select>'),
], end='<span class="filters__n" data-bind="result-count">—</span>')

rc_body = rc_filters + "\n" + regions(skel(8),
  '      <div class="blocker" id="blocker" hidden></div>\n' +
  table('rows', [('','Pos','r'),('','Pupil'),('','Subjects','r'),('','Total','r'),
                 ('','Average','r'),('','Grade'),('','Status'),('','')],
        'Report cards for the selected class and exam'),
  empty('No cards yet', 'Generate them for a class once its marks are in.'))

m_card = modal('modal-card', 'Report card', 'Draft cards are visible here and nowhere else.',
  '          <div id="card-body"></div>', 'Print', wide=True,
  footer='        <button type="button" class="btn btn--ghost btn--sm" data-modal-close>Close</button>\n'
         '        <button type="button" class="btn btn--ghost btn--sm" id="save-comments">Save comments</button>\n'
         '        <button type="button" class="btn btn--solid btn--sm" id="print-card">Print</button>')

cards = f'''<main class="content">
  {phead('Report cards', 'Generate, review and publish — nothing goes to a guardian unverified',
         '<button type="button" class="btn btn--ghost btn--sm" id="generate">Generate for class</button>'
         '<button type="button" class="btn btn--solid btn--sm" id="publish">Publish class</button>')}

  {panel('cards', rc_body)}
</main>

{m_card}'''

write('report-cards.html', A.page('report-cards.html',
  'Report cards — Shule',
  'Report cards at Riverside Academy: generate for a class, review positions and comments, and publish only once every mark is verified.',
  cards, page_js='report-cards'))

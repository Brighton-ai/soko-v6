"""Reusable markup fragments for the app pages. See tools/shell.py."""

def ico(paths, size=15, sw="1.8"):
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="%s" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>'
            % (size, size, sw, paths))

TICK = ico('<path d="m20 6-11 11-5-5"/>', 20, "2.4")
WARN = ico('<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>', 20)
PLUS = ico('<path d="M12 5v14M5 12h14"/>', 15, "2.2")
ARROW = ico('<path d="M5 12h14M13 6l6 6-6 6"/>', 14, "2.2")
X = ico('<path d="M18 6 6 18M6 6l12 12"/>', 16, "2")


def skel(n=6, cls="sk--row"):
    return "".join('<span class="sk %s"></span>' % cls for _ in range(n))


def empty(title, body, ico_paths=None, bad=False):
    return ('<div class="empty%s">\n'
            '            <span class="empty__ico">%s</span>\n'
            '            <b>%s</b>\n'
            '            <p>%s</p>\n'
            '          </div>' % (' empty--bad' if bad else '',
                                  ico_paths or (WARN if bad else TICK), title, body))


def panel(pid, body, title=None, sub=None, head_extra="", state=None):
    st = ' data-state="%s"' % state if state else ""
    head = ""
    if title:
        head = ('  <div class="card__h">\n'
                '    <div>\n      <h2>%s</h2>\n%s    </div>\n    %s\n  </div>\n'
                % (title, ('      <p>%s</p>\n' % sub) if sub else "", head_extra))
    return ('<section class="card" data-panel="%s"%s>\n%s%s\n</section>' % (pid, st, head, body))


def regions(loading, content, empty_html, flush=True):
    cls = ' card__b--flush' if flush else ''
    return ('  <div class="card__b%s">\n'
            '    <div data-region="loading" class="sk-rows">%s</div>\n'
            '    <div data-region="content" hidden>\n%s\n    </div>\n'
            '    <div data-region="empty" hidden>%s</div>\n'
            '  </div>' % (cls, loading, content, empty_html))


def field(fid, label, control, opt=False, hint=None):
    o = ' <span class="opt">(optional)</span>' if opt else ''
    h = '\n            <p class="calc__hint">%s</p>' % hint if hint else ''
    return ('          <div class="field">\n'
            '            <label for="%s">%s%s</label>\n'
            '            %s%s\n'
            '            <p class="err" id="%s-err" role="alert"></p>\n'
            '          </div>' % (fid, label, o, control, h, fid))


def sel(fid, name, options="", extra=""):
    return '<select id="%s" name="%s" aria-describedby="%s-err"%s>%s</select>' % (fid, name, fid, extra, options)


def inp(fid, name, kind="text", extra=""):
    return '<input type="%s" id="%s" name="%s" aria-describedby="%s-err"%s>' % (kind, fid, name, fid, extra)


def modal(mid, title, sub, body, submit_label, wide=False, footer=None):
    w = ' style="max-width:640px"' if wide else ''
    foot = footer if footer is not None else (
        '        <button type="button" class="btn btn--ghost btn--sm" data-modal-close>Cancel</button>\n'
        '        <button type="submit" class="btn btn--solid btn--sm">%s</button>' % submit_label)
    return f'''<div class="scrim" id="{mid}" role="dialog" aria-modal="true" aria-labelledby="{mid}-t">
  <div class="modal"{w}>
    <form id="{mid}-form" novalidate>
      <div class="modal__h">
        <div>
          <h2 id="{mid}-t">{title}</h2>
          <p>{sub}</p>
        </div>
        <button type="button" class="modal__x" data-modal-close aria-label="Close">{X}</button>
      </div>
      <div class="modal__b">
{body}
        <p class="formerr" data-form-error role="alert"></p>
      </div>
      <div class="modal__f">
{foot}
      </div>
    </form>
  </div>
</div>'''


def phead(title, sub, actions=""):
    return ('<div class="phd">\n'
            '    <div>\n      <h1>%s</h1>\n      <p>%s</p>\n    </div>\n'
            '    <div class="phd__act">%s</div>\n  </div>' % (title, sub, actions))


def filters(fields, end=""):
    return ('    <div class="filters">\n%s\n      <div class="filters__end">%s</div>\n    </div>'
            % ("\n".join(fields), end))


def ffield(fid, label, control, grow=False):
    cls = "field filters__grow" if grow else "field"
    return ('      <div class="%s">\n        <label for="%s">%s</label>\n        %s\n      </div>'
            % (cls, fid, label, control))


def table(tbody_id, cols, caption, pick_all=None, thead_id=None):
    head = ""
    if pick_all:
        head += ('<th scope="col" class="pick"><input type="checkbox" id="%s" '
                 'aria-label="Select every row on this page"></th>' % pick_all)
    for c in cols:
        key, label = c[0], c[1]
        cls = c[2] if len(c) > 2 else ""
        sortable = ' data-sort="%s"' % key if key else ""
        cls_attr = ' class="%s"' % cls if cls else ""
        head += '<th scope="col"%s%s>%s</th>' % (cls_attr, sortable, label)
    tid = ' id="%s"' % thead_id if thead_id else ""
    return ('      <div class="tbl-scroll">\n'
            '        <table class="tbl">\n'
            '          <caption class="vh">%s</caption>\n'
            '          <thead><tr%s>%s</tr></thead>\n'
            '          <tbody id="%s"></tbody>\n'
            '        </table>\n'
            '      </div>' % (caption, tid, head, tbody_id))

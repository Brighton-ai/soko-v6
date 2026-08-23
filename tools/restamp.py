"""
Restamps the shell — sidebar, topbar and script tags — into every page under
app/, from tools/shell.py. Page content is left untouched.

    python3 tools/restamp.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shell

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')

for name in sorted(os.listdir(APP)):
    if not name.endswith('.html'):
        continue
    path = os.path.join(APP, name)
    src = open(path, encoding='utf-8').read()

    a = src.index('<aside class="side"')
    b = src.index('</aside>') + len('</aside>')
    src = src[:a] + shell.sidebar(name) + src[b:]

    a = src.index('<header class="top">')
    b = src.index('</header>') + len('</header>')
    src = src[:a] + shell.topbar() + src[b:]

    a = src.index('<script src="../assets/js/data/demo-data.js">')
    b = src.rindex('</script>') + len('</script>')
    page_js = [s for s in src[a:b].split('\n') if 'assets/js/' in s and
               not any(k in s for k in shell.SCRIPTS)]
    tags = ['<script src="%s"></script>' % s for s in shell.SCRIPTS] + page_js
    src = src[:a] + '\n'.join(tags) + src[b:]

    open(path, 'w', encoding='utf-8').write(src)
    print('restamped', name)

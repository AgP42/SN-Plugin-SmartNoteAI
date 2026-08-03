#!/usr/bin/env python3
"""Build the embedded User Guide PDF *and* its seeded transcripts.

ONE source of truth: docs/USER-GUIDE.md. This script
  - paginates it (cover, contents, then the chapters, images in place),
  - writes android/app/src/main/assets/SmartNoteAI-UserGuide.pdf,
  - writes src/core/guide/guidePages.json with one entry per PDF page, so
    the transcript seeded in the library matches the PDF page by page.

After editing the Markdown:
    python3 tools/make_guide_pdf.py
then bump GUIDE_REV in src/native/guideSeed.ts so installed devices replace
the old PDF and its transcript.

Pure-python PDF (Helvetica + JPEG XObjects, no compression). Pillow is used
only to read image sizes and to re-encode the pictures.
"""
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MD = os.path.join(ROOT, 'docs/USER-GUIDE.md')
IMG_DIR = os.path.join(ROOT, 'assets/guide')
KOFI = os.path.join(ROOT, 'assets/kofi-qr.png')
DEVICE = os.path.join(ROOT, 'assets/guide/cover-device.png')
OUT_PDF = os.path.join(ROOT, 'android/app/src/main/assets/SmartNoteAI-UserGuide.pdf')
OUT_JSON = os.path.join(ROOT, 'src/core/guide/guidePages.json')

# ---- design tokens (e-ink first: pure black on white, no colour) ----
W, H = 595, 842
MARGIN = 64
TOP = H - 92
BOTTOM = 74
CHAP_NUM = 44
CHAP_SIZE = 21
SUB_SIZE = 13.5
H3_SIZE = 11.5
BODY = 10.2
LEAD = 15.2
FOLIO = 8.5
GREY = 0.42
HAIR = 0.82
COL = W - 2 * MARGIN
CPL = 84


def esc(t):
    return (t.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')
            .encode('latin-1', 'replace').decode('latin-1'))


def demark(t):
    t = re.sub(r'\*\*(.+?)\*\*', r'\1', t)
    t = re.sub(r'(?<!\w)\*(.+?)\*(?!\w)', r'\1', t)
    t = t.replace('`', '')
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', t)
    return t


def wrap(text, cpl=CPL):
    out, cur = [], ''
    for w in text.split(' '):
        nxt = w if not cur else cur + ' ' + w
        if len(nxt) <= cpl:
            cur = nxt
        else:
            if cur:
                out.append(cur)
            cur = w
    out.append(cur)
    return out or ['']


def img_size(path):
    from PIL import Image
    with Image.open(path) as im:
        return im.size


def jpeg_bytes(path, maxw=820):
    from PIL import Image
    im = Image.open(path).convert('RGB')
    if im.size[0] > maxw:
        im.thumbnail((maxw, maxw * 4))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72)
    return buf.getvalue(), im.size[0], im.size[1]


def parse_md(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    secs, cur, para, in_code = [], None, [], False
    start = next(i for i, l in enumerate(lines) if l.startswith('# 1.'))

    def flush():
        nonlocal para
        if para and cur is not None:
            cur['blocks'].append(('p', ' '.join(para).strip()))
        para = []

    for raw in lines[start:]:
        l = raw.rstrip()
        if l.startswith('```'):
            flush()
            in_code = not in_code
            if in_code:
                cur['blocks'].append(('code', []))
            continue
        if in_code:
            cur['blocks'][-1][1].append(l)
            continue
        if l.startswith('# ') or l.startswith('## '):
            flush()
            cur = {'title': demark(l.lstrip('#').strip()), 'blocks': []}
            secs.append(cur)
            continue
        if cur is None:
            continue
        if l.startswith('### '):
            flush()
            cur['blocks'].append(('h', demark(l[4:].strip())))
            continue
        if '[IMAGE:' in l:
            flush()
            for g in re.findall(r'\[IMAGE: ([^\]]+)\]', l):
                cur['blocks'].append(('img', g.strip()))
            continue
        if l.startswith('|'):
            flush()
            cells = [demark(c.strip()) for c in l.strip('|').split('|')]
            if all(set(c) <= set('-: ') for c in cells):
                continue
            if len(cells) >= 2 and cells[0]:
                cur['blocks'].append(('row', (cells[0], ' '.join(cells[1:]).strip())))
            continue
        if l.startswith('- ') or l.startswith('* '):
            flush()
            cur['blocks'].append(('b', demark(l[2:].strip())))
            continue
        if re.match(r'^\d+\. ', l):
            flush()
            cur['blocks'].append(('b', demark(l.split('. ', 1)[1].strip())))
            continue
        if l.startswith('> '):
            flush()
            cur['blocks'].append(('q', demark(l[2:].strip())))
            continue
        if l.strip() in ('', '---'):
            flush()
            continue
        if cur['blocks'] and cur['blocks'][-1][0] in ('b', 'q') and raw.startswith('  ') and not para:
            k, v = cur['blocks'][-1]
            cur['blocks'][-1] = (k, v + ' ' + demark(l.strip()))
            continue
        para.append(demark(l.strip()))
    flush()
    return secs

def lay_out(secs):
    """Typeset the sections. Rules of the house:
      - a chapter (level 1) opens its own page, with an eyebrow and a numeral;
      - a heading never sits alone at the foot of a page (keep-with-next);
      - a page carrying only a header is never emitted;
      - images are framed and never orphaned from the text they illustrate.
    """
    pages = []
    starts = []
    current_chapter = ''
    st = {'ops': [], 'txt': [], 'imgs': [], 'y': TOP, 'body': 0, 'opener': False,
          'running': ''}

    def flushpage():
        if st['ops'] and (st['body'] > 0 or st['opener']):
            pages.append({'title': st.get('page_title', ''),
                          'running': st['running'],
                          'opener': st['opener'],
                          'ops': st['ops'], 'text': '\n'.join(st['txt']),
                          'images': st['imgs']})
        st['ops'], st['txt'], st['imgs'] = [], [], []
        st['y'], st['body'], st['opener'] = TOP, 0, False

    def room(need):
        return st['y'] - need >= BOTTOM

    for sec in secs:
        title = sec['title']
        m = re.match(r'^(\d+)\.(\d+)?\s*(.*)$', title)
        chap_no = m.group(1) if m else ''
        sub_no = m.group(2) if m else None
        label = m.group(3) if m else title
        # A chapter is "N. Title". "N.M Title" is a section, and an unnumbered
        # "## Heading" is a section of the chapter it sits in.
        is_chapter = bool(m) and sub_no is None
        if is_chapter:
            current_chapter = chap_no + '. ' + label

        st['page_title'] = title
        st['running'] = current_chapter or label

        def open_chapter():
            starts.append((title, len(pages) + 3))
            st['opener'] = True
            y = H - 150
            st['ops'].append(('track', MARGIN, y + 76, 8.5, 'F2',
                              'CHAPTER ' + chap_no, GREY, 2.2))
            st['ops'].append(('text', MARGIN, y, CHAP_NUM, 'F2', chap_no + '.', 0.0))
            wnum = len(chap_no + '.') * CHAP_NUM * 0.60
            st['ops'].append(('text', MARGIN + wnum + 14, y, CHAP_SIZE, 'F2', label, 0.0))
            st['ops'].append(('rule', MARGIN, y - 26, W - MARGIN, 2.0, 0.0))
            st['y'] = y - 58
            st['txt'].append('# ' + title)

        def open_section():
            # a section flows on the running page when at least a few lines
            # fit under its heading; otherwise it starts the next one
            if st['body'] > 0:
                if room(SUB_SIZE + 5 * LEAD + 30):
                    st['y'] -= 16
                else:
                    flushpage()
                    st['page_title'] = title
            starts.append((title, len(pages) + 3))
            st['ops'].append(('text', MARGIN, st['y'], SUB_SIZE, 'F2', title, 0.0))
            st['ops'].append(('rule', MARGIN, st['y'] - 9, W - MARGIN, HAIR, 0.72))
            st['y'] -= SUB_SIZE + 20
            st['txt'].append('# ' + title)

        def carry():
            flushpage()
            st['page_title'] = title

        if is_chapter:
            flushpage()
            open_chapter()
        else:
            open_section()

        for kind, payload in sec['blocks']:
            if kind == 'img':
                path = os.path.join(IMG_DIR, payload)
                if not os.path.exists(path):
                    continue
                iw0, ih0 = img_size(path)
                iw = COL
                ih = iw * ih0 / iw0
                if ih > 292:
                    ih = 292.0
                    iw = ih * iw0 / ih0
                if not room(ih + 26):
                    carry()
                x = MARGIN + (COL - iw) / 2
                st['ops'].append(('img', payload, x, st['y'] - ih, iw, ih))
                st['ops'].append(('frame', x - 1, st['y'] - ih - 1, iw + 2, ih + 2, 0.72))
                st['imgs'].append(payload)
                st['txt'].append('[screenshot: ' + payload + ']')
                st['y'] -= ih + 22
                st['body'] += 1
                continue

            if kind == 'code':
                lines = [l for l in payload if l.strip()]
                need = len(lines) * 10.4 + 22
                if not room(need):
                    carry()
                st['ops'].append(('fill', MARGIN, st['y'] - need + 14, COL, need - 8, 0.955))
                yy = st['y'] - 6
                for l in lines:
                    st['ops'].append(('text', MARGIN + 10, yy, 7.6, 'F3', l, 0.15))
                    st['txt'].append(l)
                    yy -= 10.4
                st['y'] -= need
                st['body'] += 1
                continue

            if kind == 'h':
                if not room(H3_SIZE + 4 * LEAD):
                    carry()
                st['y'] -= 9
                st['ops'].append(('text', MARGIN, st['y'], H3_SIZE, 'F2', payload, 0.0))
                st['txt'].append('## ' + payload)
                st['y'] -= H3_SIZE + 7
                st['body'] += 1
                continue

            if kind == 'q':
                lines = wrap(payload, CPL - 8)
                need = len(lines) * LEAD + 18
                if not room(need):
                    carry()
                top = st['y'] + 8
                st['ops'].append(('fill', MARGIN, top - need + 6, COL, need - 4, 0.955))
                st['ops'].append(('fill', MARGIN, top - need + 6, 2.4, need - 4, 0.0))
                yy = st['y'] - 4
                for ln in lines:
                    st['ops'].append(('text', MARGIN + 16, yy, BODY, 'F1', ln, 0.0))
                    yy -= LEAD
                st['txt'].append('> ' + payload)
                st['y'] -= need + 4
                st['body'] += 1
                continue

            if kind == 'b':
                lines = wrap(payload, CPL - 4)
                if not room(min(len(lines), 2) * LEAD):
                    carry()
                first = True
                for ln in lines:
                    if not room(LEAD):
                        carry()
                    if first:
                        st['ops'].append(('fill', MARGIN + 3, st['y'] + 3.0, 2.6, 2.6, 0.0))
                        first = False
                    st['ops'].append(('text', MARGIN + 14, st['y'], BODY, 'F1', ln, 0.0))
                    st['y'] -= LEAD
                st['txt'].append('- ' + payload)
                st['y'] -= 4
                st['body'] += 1
                continue

            if kind == 'row':
                left, right = payload
                lw = 148.0
                lls = wrap(left, 25)
                rls = wrap(right, 60)
                need = max(len(lls), len(rls)) * LEAD + 10
                if not room(need):
                    carry()
                yy = st['y']
                for ln in lls:
                    st['ops'].append(('text', MARGIN, yy, BODY, 'F2', ln, 0.0))
                    yy -= LEAD
                yy = st['y']
                for ln in rls:
                    st['ops'].append(('text', MARGIN + lw, yy, BODY, 'F1', ln, 0.0))
                    yy -= LEAD
                st['y'] -= need
                st['ops'].append(('rule', MARGIN, st['y'] + 7, W - MARGIN, 0.4, 0.85))
                st['txt'].append(left + ': ' + right)
                st['body'] += 1
                continue

            lines = wrap(payload)
            if not room(2 * LEAD):
                carry()
            for ln in lines:
                if not room(LEAD):
                    carry()
                st['ops'].append(('text', MARGIN, st['y'], BODY, 'F1', ln, 0.0))
                st['y'] -= LEAD
            st['txt'].append(payload)
            st['y'] -= 7
            st['body'] += 1

    flushpage()
    return pages, starts


def cover_ops():
    """Cover: a black masthead, the device drawing carrying the plugin logo,
    then a credits block set as small-caps labels with the Ko-fi code."""
    ops = [('fill', 0, H - 148, W, 148, 0.0)]
    ops.append(('track', MARGIN, H - 62, 8.5, 'F2', 'SUPERNOTE PLUGIN', 1.0, 2.6))
    ops.append(('text', MARGIN, H - 100, 29, 'F2', 'SmartNote AI', 1.0))
    ops.append(('text', MARGIN, H - 128, 14.5, 'F1', 'User Guide', 1.0))
    if os.path.exists(DEVICE):
        dw0, dh0 = img_size(DEVICE)
        dh = 366.0
        dw = dh * dw0 / dh0
        ops.append(('img', os.path.basename(DEVICE), (W - dw) / 2, H - 196 - dh, dw, dh))
        base = H - 196 - dh
    else:
        base = 250
    ops.append(('rule', MARGIN, base - 38, W - MARGIN, HAIR, 0.72))
    ops.append(('text', MARGIN, base - 64, 12.5, 'F1',
                'Your Supernote in the age of AI; privacy first.', 0.0))
    ops.append(('track', MARGIN, base - 102, 7.6, 'F2', 'AUTHOR', GREY, 2.0))
    ops.append(('text', MARGIN, base - 118, 10.5, 'F1', 'AgP42', 0.0))
    ops.append(('track', MARGIN, base - 144, 7.6, 'F2', 'SOURCES AND ISSUES', GREY, 2.0))
    ops.append(('text', MARGIN, base - 160, 10.5, 'F1',
                'github.com/AgP42/SN-Plugin-SmartNoteAI', 0.0))
    ops.append(('track', MARGIN, base - 186, 7.6, 'F2', 'SUPPORT THE PROJECT', GREY, 2.0))
    ops.append(('text', MARGIN, base - 202, 10.5, 'F1', 'ko-fi.com/agp42', 0.0))
    if os.path.exists(KOFI):
        qw = 76.0
        ops.append(('img', 'kofi-qr.png', W - MARGIN - qw, base - 206, qw, qw))
    return ops


def toc_ops(entries):
    ops = [('track', MARGIN, TOP + 24, 8.5, 'F2', 'CONTENTS', GREY, 2.4),
           ('rule', MARGIN, TOP + 14, W - MARGIN, 2.0, 0.0)]
    y = TOP - 16
    for title, page in entries:
        m = re.match(r'^(\d+)\.(\d+)?\s*(.*)$', title)
        sub = bool(m and m.group(2))
        num = (m.group(1) + '.' + m.group(2)) if sub else ((m.group(1) + '.') if m else '')
        lbl = m.group(3) if m else title
        x = MARGIN + (24 if sub else 0)
        ops.append(('text', x, y, 9.5 if sub else 11.5, 'F1' if sub else 'F2',
                    num, GREY if sub else 0.0))
        ops.append(('text', x + (32 if sub else 26), y, 9.5 if sub else 11.5,
                    'F1' if sub else 'F2', lbl, 0.0))
        ops.append(('text', W - MARGIN - 14, y, 9.5, 'F1', str(page), GREY))
        if not sub:
            ops.append(('rule', MARGIN, y - 7, W - MARGIN, 0.4, 0.85))
        y -= 19 if sub else 24
    return ops


def page_stream(ops, idx, total, names, running=''):
    out = []
    for op in ops:
        k = op[0]
        if k == 'text':
            _, x, y, size, font, s, g = op
            out.append(f'{g:.2f} g BT /{font} {size} Tf 1 0 0 1 {x:.1f} {y:.1f} Tm '
                       f'({esc(s)}) Tj ET 0 g')
        elif k == 'track':
            _, x, y, size, font, s, g, tc = op
            out.append(f'{g:.2f} g BT /{font} {size} Tf {tc} Tc 1 0 0 1 {x:.1f} {y:.1f} Tm '
                       f'({esc(s)}) Tj 0 Tc ET 0 g')
        elif k == 'rule':
            _, x0, y, x1, wd, g = op
            out.append(f'{g:.2f} G {wd} w {x0:.1f} {y:.1f} m {x1:.1f} {y:.1f} l S 0 G')
        elif k == 'fill':
            _, x, y, w, h, g = op
            out.append(f'{g:.2f} g {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f 0 g')
        elif k == 'frame':
            _, x, y, w, h, g = op
            out.append(f'{g:.2f} G 0.5 w {x:.1f} {y:.1f} {w:.1f} {h:.1f} re S 0 G')
        elif k == 'img':
            _, name, x, y, w, h = op
            out.append(f'q {w:.1f} 0 0 {h:.1f} {x:.1f} {y:.1f} cm /{names[name]} Do Q')
    if idx:
        if running:
            out.append(f'{GREY:.2f} g BT /F1 {FOLIO} Tf 1 0 0 1 {MARGIN} {H - 56} Tm '
                       f'({esc(running)}) Tj ET 0 g')
            out.append(f'0.80 G 0.5 w {MARGIN} {H - 64} m {W - MARGIN} {H - 64} l S 0 G')
        out.append(f'{GREY:.2f} g BT /F1 {FOLIO} Tf 1 0 0 1 {W / 2 - 6:.0f} 46 Tm '
                   f'({idx}) Tj ET 0 g')
    return '\n'.join(out).encode('latin-1', 'replace')


def build():
    body_pages, starts = lay_out(parse_md(MD))
    seen, toc = set(), []
    for t, n in starts:
        if t in seen or not re.match(r'^\d', t):
            continue
        seen.add(t)
        toc.append((t, n))
    # keep the contents readable: chapters and their sections only
    toc = [(t, n) for t, n in toc if re.match(r'^\d', t)]
    pages = [
        {'title': 'SmartNote AI - User Guide', 'ops': cover_ops(),
         'text': ('# SmartNote AI - User Guide\n'
                  'Your Supernote in the age of AI; privacy first.\nby AgP42\n'
                  'Sources: github.com/AgP42/SN-Plugin-SmartNoteAI\n'
                  'Support: ko-fi.com/agp42'),
         'images': ([os.path.basename(DEVICE)] if os.path.exists(DEVICE) else [])
                   + (['kofi-qr.png'] if os.path.exists(KOFI) else [])},
        {'title': 'Contents', 'ops': toc_ops(toc),
         'text': '# Contents\n' + '\n'.join(f'{t} .... p. {n}' for t, n in toc),
         'images': []},
    ] + body_pages

    used = []
    for p in pages:
        for n in p['images']:
            if n not in used:
                used.append(n)
    objs = [
        (1, b'<< /Type /Catalog /Pages 2 0 R >>'),
        (2, b'PAGES'),
        (3, b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
        (4, b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'),
        (5, b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'),
    ]
    imgobj, num = {}, 6
    for name in used:
        path = (KOFI if name == 'kofi-qr.png'
                else DEVICE if name == os.path.basename(DEVICE)
                else os.path.join(IMG_DIR, name))
        data, w, h = jpeg_bytes(path)
        objs.append((num, (f'<< /Type /XObject /Subtype /Image /Width {w} /Height {h} '
                           f'/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode '
                           f'/Length {len(data)} >>\nstream\n').encode() + data + b'\nendstream'))
        imgobj[name] = num
        num += 1

    first = num
    kids = ' '.join(f'{first + i*2} 0 R' for i in range(len(pages)))
    objs[1] = (2, f'<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>'.encode())
    total = len(pages)
    for i, p in enumerate(pages):
        names = {n: f'Im{imgobj[n]}' for n in p['images']}
        st = page_stream(p['ops'], 0 if i == 0 else i + 1, total, names,
                         '' if (i < 2 or p.get('opener')) else p.get('running', ''))
        xo = ''
        if names:
            xo = ' /XObject << ' + ' '.join(f'/{v} {imgobj[k]} 0 R'
                                            for k, v in names.items()) + ' >>'
        objs.append((first + i*2,
                     (f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] '
                      f'/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>{xo} >> '
                      f'/Contents {first + 1 + i*2} 0 R >>').encode()))
        objs.append((first + 1 + i*2,
                     f'<< /Length {len(st)} >>\nstream\n'.encode() + st + b'\nendstream'))

    out = bytearray(b'%PDF-1.4\n')
    offsets = {}
    for n, body in objs:
        offsets[n] = len(out)
        out += f'{n} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    count = len(objs) + 1
    out += f'xref\n0 {count}\n'.encode() + b'0000000000 65535 f \n'
    for n in sorted(offsets):
        out += f'{offsets[n]:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    seeds = [{'title': p['title'], 'body': p['text']} for p in pages]
    return bytes(out), seeds

if __name__ == '__main__':
    pdf, seeds = build()
    open(OUT_PDF, 'wb').write(pdf)
    json.dump(seeds, open(OUT_JSON, 'w'), indent=2, ensure_ascii=True)
    print(f'{OUT_PDF}: {len(pdf)} bytes, {len(seeds)} pages')

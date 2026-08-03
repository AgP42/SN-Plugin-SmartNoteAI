#!/usr/bin/env python3
"""Import a DESIGNED User Guide PDF into the plugin (pipeline v2, 2026-08-03).

The manual is now laid out outside the repo (Claude Design); this script
replaces the old make_guide_pdf.py generation step:
  - copies the given PDF to android/app/src/main/assets/SmartNoteAI-UserGuide.pdf
    (the embedded asset guideSeed installs into Document/SmartNote AI/),
  - copies it to docs/SmartNoteAI-UserGuide.pdf (repo distribution copy),
  - extracts each page's text with pdftotext and rewrites
    src/core/guide/guidePages.json so the transcripts seeded in the library
    match the PDF page by page (search hits land on the right page).

Usage:
    python3 tools/import_guide_pdf.py "/path/to/Manual.pdf"
then bump GUIDE_REV in src/native/guideSeed.ts so installed devices replace
the old PDF and its transcript, and rebuild.
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PDF = os.path.join(ROOT, 'android/app/src/main/assets/SmartNoteAI-UserGuide.pdf')
DOC_PDF = os.path.join(ROOT, 'docs/SmartNoteAI-UserGuide.pdf')
OUT_JSON = os.path.join(ROOT, 'src/core/guide/guidePages.json')


def page_count(pdf: str) -> int:
    info = subprocess.check_output(['pdfinfo', pdf], text=True)
    m = re.search(r'^Pages:\s+(\d+)', info, re.M)
    if m is None:
        raise SystemExit('pdfinfo gave no page count')
    return int(m.group(1))


def page_text(pdf: str, page: int) -> str:
    raw = subprocess.check_output(
        ['pdftotext', '-f', str(page), '-l', str(page), pdf, '-'], text=True)
    # Normalize: strip trailing spaces, collapse 3+ blank lines, drop the
    # running footer/header artifacts.
    lines = [l.rstrip() for l in raw.split('\n')]
    lines = [l for l in lines
             if l.strip() not in ('SMARTNOTE AI · USER GUIDE · COMPACT',
                                  'PRIVACY FIRST')]
    text = '\n'.join(lines)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return text


def title_of(text: str, page: int) -> str:
    for l in text.split('\n'):
        t = l.strip()
        if len(t) >= 3:
            return t[:80]
    return f'Page {page}'


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = sys.argv[1]
    n = page_count(src)
    pages = []
    for p in range(1, n + 1):
        text = page_text(src, p)
        pages.append({'title': title_of(text, p), 'body': text})
    shutil.copyfile(src, OUT_PDF)
    shutil.copyfile(src, DOC_PDF)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(pages, f, ensure_ascii=False, indent=1)
    print(f'{n} pages → guidePages.json · PDF → assets + docs')
    print('Now bump GUIDE_REV in src/native/guideSeed.ts and rebuild.')


if __name__ == '__main__':
    main()

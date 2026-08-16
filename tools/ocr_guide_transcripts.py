#!/usr/bin/env python3
"""Regenerate guidePages.json with MISTRAL OCR instead of pdftotext.

pdftotext scrambles the designed layout (the page-1 table of contents came
out unreadable — user report 2026-08-16); Mistral's /v1/ocr reads the SAME
pages the way the plugin itself would, in clean markdown. This runs the
exact request shape the plugin uses (model, table_format, data-URL PDF).

Usage:
    python3 tools/ocr_guide_transcripts.py "/path/to/Manual.pdf" /path/to/keyfile

The key file is read from disk (e.g. the device's legacy
MyStyle/Plugins/SmartNoteAI/mistral.txt pulled over adb) — never pasted in
a terminal or chat. Cost: ~0.35 c€/page.

Writes src/core/guide/guidePages.json (same shape as import_guide_pdf.py:
[{title, body}...]). Run import_guide_pdf.py FIRST for the PDF copies; this
only replaces the transcripts. Then bump GUIDE_REV and rebuild.
"""
import base64
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, 'src/core/guide/guidePages.json')
# Same model the plugin pins (src/core/model/ocr.ts OCR_MODEL).
OCR_MODEL = 'mistral-ocr-2505'


def read_model_from_source() -> str:
    src = os.path.join(ROOT, 'src/core/model/ocr.ts')
    try:
        m = re.search(r"OCR_MODEL\s*=\s*'([^']+)'", open(src).read())
        return m.group(1) if m else OCR_MODEL
    except OSError:
        return OCR_MODEL


def title_of(md: str, page: int) -> str:
    for line in md.split('\n'):
        t = line.strip().lstrip('#').strip()
        if len(t) >= 3:
            return t[:80]
    return f'Page {page}'


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    pdf, keyfile = sys.argv[1], sys.argv[2]
    key = open(keyfile).read().strip().lstrip('﻿')
    if not key:
        raise SystemExit('empty key file')
    b64 = base64.b64encode(open(pdf, 'rb').read()).decode()
    body = json.dumps({
        'model': read_model_from_source(),
        'document': {
            'type': 'document_url',
            'document_url': f'data:application/pdf;base64,{b64}',
        },
        'table_format': 'markdown',
    }).encode()
    req = urllib.request.Request(
        'https://api.mistral.ai/v1/ocr',
        data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {key}',
        },
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    pages_raw = sorted(data.get('pages', []), key=lambda p: p.get('index', 0))
    if not pages_raw:
        raise SystemExit('OCR returned no pages')
    pages = []
    for p in pages_raw:
        md = (p.get('markdown') or '').strip()
        # Merge extracted tables back in — same rule as the plugin's
        # mergeTables (ocr.ts): replace the [id](id) placeholder with the
        # table's markdown, append unmatched ones.
        leftovers = []
        for t in p.get('tables') or []:
            tid = t.get('id') or ''
            content = (t.get('content') or '').strip()
            if not content:
                continue
            ph = f'[{tid}]({tid})'
            if tid and ph in md:
                md = md.replace(ph, content)
            else:
                leftovers.append(content)
        if leftovers:
            md = '\n\n'.join([md] + leftovers)
        # Drop image placeholders the OCR inserts for figures.
        md = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', md)
        md = re.sub(r'\n{3,}', '\n\n', md).strip()
        pages.append({'title': title_of(md, p.get('index', 0) + 1), 'body': md})
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(pages, f, ensure_ascii=False, indent=1)
    print(f'{len(pages)} pages OCR → guidePages.json '
          f'(~{len(pages) * 0.35:.0f} c€). Bump GUIDE_REV and rebuild.')


if __name__ == '__main__':
    main()

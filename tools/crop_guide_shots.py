#!/usr/bin/env python3
"""Crop the guide screenshots down to their actual content.

Device screenshots keep the Supernote side toolbar and bottom bar; console
screenshots are a dialog floating on a dimmed page. Both waste most of the
page in the PDF. This trims each one to what the reader must see, once, and
rewrites assets/guide/*.jpg in place.
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'assets/guide')

# Fraction-of-image crop boxes (l, t, r, b) applied before the auto trim.
PRE = {
    # full-screen plugin pages: drop the Supernote toolbar + bottom bar
    'hub': (0.055, 0.012, 1.0, 0.965),
    'door1': (0.055, 0.012, 1.0, 0.965),
    'door2a': (0.055, 0.012, 1.0, 0.965),
    'door2b': (0.055, 0.012, 1.0, 0.965),
    'door3a': (0.055, 0.012, 1.0, 0.965),
    'door3b': (0.055, 0.012, 1.0, 0.965),
    'door3c': (0.055, 0.012, 1.0, 0.965),
    'door3d': (0.055, 0.012, 1.0, 0.965),
    'library': (0.055, 0.012, 1.0, 0.965),
    'syncstatus': (0.055, 0.012, 1.0, 0.965),
    'browse_a': (0.055, 0.012, 1.0, 0.965),
    'browse_b': (0.055, 0.012, 1.0, 0.965),
    'search': (0.055, 0.012, 1.0, 0.965),
    'export': (0.055, 0.012, 1.0, 0.965),
}


def dark_bbox(g, thr=150, min_run=0.35):
    """Bounding box of the largest framed panel (long dark runs)."""
    d = g < thr
    h, w = d.shape
    rows = np.where(d.sum(axis=1) > w * min_run)[0]
    cols = np.where(d.sum(axis=0) > h * min_run)[0]
    if len(rows) >= 2 and len(cols) >= 2:
        return int(cols.min()), int(rows.min()), int(cols.max()), int(rows.max())
    return None


def content_bbox(g, bg_thr=246):
    """Bounding box of everything that is not background."""
    nz = np.where(g < bg_thr)
    if len(nz[0]) == 0:
        return None
    return int(nz[1].min()), int(nz[0].min()), int(nz[1].max()), int(nz[0].max())


def crop(path):
    name = os.path.splitext(os.path.basename(path))[0]
    im = Image.open(path).convert('L')
    w, h = im.size
    if name in PRE:
        l, t, r, b = PRE[name]
        im = im.crop((int(w * l), int(h * t), int(w * r), int(h * b)))
    g = np.asarray(im)
    box = None
    if name.startswith('mistral') or name.startswith('ctx_') or \
       name in ('menu', 'chat', 'brain_agents', 'panel_search'):
        box = dark_bbox(g, thr=170, min_run=0.30)
    if box is None:
        box = content_bbox(g)
    if box is None:
        return
    x0, y0, x1, y1 = box
    pad = max(6, int(0.012 * max(im.size)))
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(im.size[0], x1 + pad); y1 = min(im.size[1], y1 + pad)
    if (x1 - x0) < 60 or (y1 - y0) < 60:
        return
    out = im.crop((x0, y0, x1, y1))
    out.thumbnail((1000, 1400))
    out.save(path, quality=80)
    print(f'{name}: {w}x{h} -> {out.size[0]}x{out.size[1]}')


if __name__ == '__main__':
    for f in sorted(os.listdir(D)):
        if f.endswith('.jpg'):
            crop(os.path.join(D, f))

#!/usr/bin/env python3
"""Measure the Mistral API limits & speed for SmartNote AI's models.

The key is read from the MISTRAL_API_KEY environment variable and NEVER
written anywhere. Run:

    MISTRAL_API_KEY=xxxxx python3 tools/probe_free_tier.py

It reports, for the models the plugin uses:
  - the rate-limit headers (req/min, tokens/min) — the hard limits;
  - text latency per model;
  - a realistic vision-page transcription time (ministral-14b on a
    generated page-like image);
  - a burst test that finds where 429s start.

Free-tier profile measured 2026-07-21: ~30 req/min, 937.5k tokens/min,
~8 s per vision page (ministral-14b), no retry-after header on 429.
"""
import base64
import concurrent.futures as cf
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

KEY = os.environ.get("MISTRAL_API_KEY")
if not KEY:
    sys.exit("Set MISTRAL_API_KEY in the environment (never hard-code it).")

API = "https://api.mistral.ai/v1/chat/completions"
VISION_MODEL = "ministral-14b-2512"
TEXT_MODELS = ["mistral-small-latest", "mistral-medium-latest", VISION_MODEL]


def post(model, content, max_tokens, want_headers=False):
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
    ).encode()
    req = urllib.request.Request(
        API,
        body,
        {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    t = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=90)
        j = json.load(r)
        dt = time.time() - t
        u = j.get("usage", {})
        hdr = dict(r.headers) if want_headers else None
        return dt, r.status, u, hdr
    except urllib.error.HTTPError as e:
        return time.time() - t, e.code, {}, dict(e.headers)


def make_page_image():
    """A page-like PNG (falls back to a 1px image if Pillow is absent)."""
    try:
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (1240, 1750), "white")
        d = ImageDraw.Draw(img)
        d.multiline_text(
            (60, 60),
            (
                "Meeting notes\n- Kickoff customer project\n- Owner: A.M., due 30/07\n"
                "- Budget approved: 42k EUR\n- Risks: supplier lead time\n"
            )
            * 6,
            fill="black",
            spacing=10,
        )
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        px = bytes.fromhex(
            "89504e470d0a1a0a0000000d494844520000000100000001080600"
            "00001f15c4890000000d4944415478da6360000002000001e221bc"
            "330000000049454e44ae426082"
        )
        return base64.b64encode(px).decode()


def main():
    print("=== rate-limit headers (the hard limits) ===")
    _, st, _, hdr = post(VISION_MODEL, "ping", 3, want_headers=True)
    for k, v in (hdr or {}).items():
        if "ratelimit" in k.lower():
            print(f"  {k}: {v}")
    print(f"  (HTTP {st})")

    print("\n=== text latency (~130 tokens out) ===")
    prompt = "Write exactly 80 words about clouds."
    for m in TEXT_MODELS:
        dt, st, u, _ = post(m, prompt, 120)
        print(f"  {m}: HTTP {st} | {dt:.2f}s | {u.get('total_tokens', '?')} tok")

    print("\n=== vision page (realistic transcription speed) ===")
    b64 = make_page_image()
    content = [
        {"type": "text", "text": "Transcribe this page verbatim in Markdown."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ]
    dt, st, u, _ = post(VISION_MODEL, content, 1500)
    print(
        f"  {VISION_MODEL}: HTTP {st} | {dt:.2f}s/page | "
        f"in {u.get('prompt_tokens')} out {u.get('completion_tokens')} tok"
    )

    print("\n=== burst: 45 requests, find the 429 threshold ===")

    def one(i):
        _, st, _, h = post(VISION_MODEL, f"{i}", 3)
        return st, (h or {}).get("Retry-After")

    t = time.time()
    with cf.ThreadPoolExecutor(max_workers=40) as ex:
        res = list(ex.map(one, range(45)))
    wall = time.time() - t
    codes = {}
    for c, _ in res:
        codes[c] = codes.get(c, 0) + 1
    print(f"  45 requests in {wall:.1f}s -> {codes}")


if __name__ == "__main__":
    main()

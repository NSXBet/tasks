#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Convert a `cmux browser state save` dump into a Playwright/agent-browser state file.

cmux emits CDP-shaped cookies (`session_only`, `http_only`, `expires: null`) plus a
`storage.local` / `storage.session` map. agent-browser expects Playwright's
`{cookies: [...], origins: [{origin, localStorage}]}` shape with numeric `expires`.
Loading the raw cmux dump fails with:
    Invalid state file: invalid type: null, expected f64

Usage:
    cmux-state-to-playwright.py <cmux-state.json> <out-state.json> [--host localhost] [--origin http://localhost:3004]

--host may be repeated; cookies whose domain contains any host substring are kept.
Default host filter is the hostname of --origin (falls back to the dump's own `url`).
Filtering matters: a real cmux profile carries thousands of unrelated cookies.
"""
from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import urlparse


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--host", action="append", default=[])
    ap.add_argument("--origin", default=None)
    args = ap.parse_args()

    dump = json.load(open(args.src))
    origin = args.origin
    if not origin:
        url = dump.get("url") or ""
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            print("no --origin given and dump has no usable url", file=sys.stderr)
            return 2
        origin = f"{parsed.scheme}://{parsed.netloc}"

    hosts = args.host or [urlparse(origin).hostname or ""]

    cookies = []
    for c in dump.get("cookies", []):
        domain = c.get("domain") or ""
        if not any(h and h in domain for h in hosts):
            continue
        expires = c.get("expires")
        cookies.append(
            {
                "name": c["name"],
                "value": c["value"],
                "domain": domain,
                "path": c.get("path") or "/",
                # session cookies (expires null) become -1, Playwright's session marker
                "expires": float(expires) if expires else -1.0,
                "httpOnly": bool(c.get("http_only", False)),
                "secure": bool(c.get("secure", False)),
                "sameSite": "Lax",
            }
        )

    storage = dump.get("storage") or {}
    local = storage.get("local") or {}
    state = {
        "cookies": cookies,
        "origins": [
            {
                "origin": origin,
                "localStorage": [{"name": k, "value": v} for k, v in local.items()],
            }
        ],
    }
    json.dump(state, open(args.dst, "w"))
    print(
        f"wrote {args.dst}: {len(cookies)} cookies, {len(local)} localStorage keys, origin {origin}"
    )
    session = storage.get("session") or {}
    if session:
        print(
            f"note: {len(session)} sessionStorage keys dropped "
            "(Playwright state has no sessionStorage; replay with `agent-browser eval` if needed)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

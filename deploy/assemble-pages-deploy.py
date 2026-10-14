#!/usr/bin/env python3
"""Assemble the Cloudflare Pages deploy directory from OpenNext build output.

Versioned from pookie-app/scripts/assemble-pages-deploy.py (2026-10-12).

Always run AFTER a fresh `npx opennextjs-cloudflare build` — never reuse a
stale .open-next/ (see deploy-staging.py, which always rebuilds).

Layout: copies .open-next/assets -> .pages-deploy/, keeps the Pages
Functions layout (cloudflare/, middleware/, server-functions/, .build/),
and drops the worker in as _worker.js. Then writes _routes.json so Pages
serves static assets directly instead of routing them through the worker.
"""
import json
import os
import shutil
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    src = os.path.join(APP_DIR, ".open-next")
    dst = os.path.join(APP_DIR, ".pages-deploy")
    if not os.path.isdir(src):
        print(f"ERROR: {src} not found — run opennextjs-cloudflare build first",
              file=sys.stderr)
        return 1
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    for item in os.listdir(os.path.join(src, "assets")):
        s, d = os.path.join(src, "assets", item), os.path.join(dst, item)
        shutil.copytree(s, d) if os.path.isdir(s) else shutil.copy2(s, d)
    for sub in ("cloudflare", "middleware", "server-functions"):
        sub_src = os.path.join(src, sub)
        if os.path.isdir(sub_src):
            shutil.copytree(sub_src, os.path.join(dst, sub))
    build_dir = os.path.join(src, ".build")
    if os.path.isdir(build_dir):
        shutil.copytree(build_dir, os.path.join(dst, ".build"))
    shutil.copy2(os.path.join(src, "worker.js"), os.path.join(dst, "_worker.js"))
    # Serve static assets directly from Pages, not via the worker.
    # Without this, the OpenNext worker 404s every static asset (lesson from
    # pookie-app, 2026-10-11). /videos/* excluded 2026-10-12: the cockpit
    # space-loop background videos must be served straight from Pages'
    # static hosting (the smoke test asserts video content-type on
    # /videos/vista-planets-1.mp4).
    with open(os.path.join(dst, "_routes.json"), "w") as f:
        json.dump({"version": 1, "include": ["/*"],
                   "exclude": ["/_next/static/*", "/videos/*"]}, f)
    print(f"Assembled {dst} from fresh .open-next build.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

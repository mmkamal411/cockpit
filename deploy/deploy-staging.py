#!/usr/bin/env python3
"""Deploy Cockpit to Cloudflare Pages (cockpit.pages.dev).

Pipeline: npm run build -> opennextjs-cloudflare build -> assemble
.pages-deploy (with _routes.json so /videos/* and /_next/static/* bypass
the worker) -> wrangler pages deploy -> post-deploy smoke test.

Versioned from pookie-app/deploy-staging.py (2026-10-12), adapted for the
cockpit repo. Lesson carried over: ALWAYS rebuild from source first; never
deploy whatever happens to sit in .open-next/.

Usage:
    python3 deploy/deploy-staging.py              # full pipeline
    python3 deploy/deploy-staging.py --skip-build  # reuse .open-next/
                                                  # (local iteration only;
                                                  #  still refuses a stale
                                                  #  build)

Prerequisites:
  1. The Cloudflare Pages project "cockpit" must exist (created once in
     the dashboard — see DEPLOY.md).
  2. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
     must be in the environment or .env.local (they are baked into the
     bundle at build time; the script fails loudly if missing).
  3. The Secure Vault entry "custom.cloudflare" must hold a Cloudflare
     API token (same pattern as pookie-app).

DO NOT run this until Mehedi has created the Pages project.
"""
import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import dynamic_credential_entry  # noqa: E402

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACCOUNT_ID = "91264b3fa69afffd6ffe57bdb3c545a8"  # same Cloudflare account as pookie-app
PROJECT = "cockpit"
STAGING_URL = "https://cockpit.pages.dev"

# Source inputs that must be older than the build output. If any of these is
# newer than .open-next/worker.js, the build output is stale and must not ship.
SOURCE_WATCH_PATHS = ["src", "middleware.ts", "next.config.ts",
                      "open-next.config.ts", "package.json",
                      "package-lock.json", "wrangler.jsonc"]

# Build-time env vars baked into the Next.js bundle. Missing ones mean a
# build that does not match the intended staging config — fail loudly.
REQUIRED_BUILD_ENV = ["NEXT_PUBLIC_SUPABASE_URL",
                      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]


def run(cmd, env=None, check=True):
    print(f"+ {' '.join(cmd)}", flush=True)
    r = subprocess.run(cmd, cwd=APP_DIR, env=env)
    if check and r.returncode != 0:
        sys.exit(f"FAILED (exit {r.returncode}): {' '.join(cmd)}")
    return r


def newest_source_mtime():
    newest = 0.0
    for rel in SOURCE_WATCH_PATHS:
        path = os.path.join(APP_DIR, rel)
        if not os.path.exists(path):
            continue
        if os.path.isfile(path):
            newest = max(newest, os.path.getmtime(path))
        else:
            for root, _dirs, files in os.walk(path):
                for f in files:
                    newest = max(newest,
                                 os.path.getmtime(os.path.join(root, f)))
    return newest


def build_is_stale():
    """True if .open-next/ is missing or older than any source input."""
    marker = os.path.join(APP_DIR, ".open-next", "worker.js")
    if not os.path.isfile(marker):
        return True, ".open-next/worker.js missing — no build output present"
    if newest_source_mtime() > os.path.getmtime(marker):
        return True, "source files are newer than .open-next/worker.js"
    return False, ""


def read_env_local():
    """Parse KEY=VALUE lines from .env.local (ignores comments/exports)."""
    values = {}
    path = os.path.join(APP_DIR, ".env.local")
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                key, _, val = line.partition("=")
                val = val.strip().strip('"').strip("'")
                if val:
                    values[key.strip()] = val
    except OSError:
        pass
    return values


def ensure_build_env(env):
    """Fail loudly if any required NEXT_PUBLIC_* build var is missing.

    Values can come from the process environment or .env.local (which
    `next build` reads automatically, but opennextjs-cloudflare build also
    needs them in the env we pass).
    """
    local = read_env_local()
    missing = []
    for key in REQUIRED_BUILD_ENV:
        if key not in env or not env[key]:
            if key in local:
                env[key] = local[key]
            else:
                missing.append(key)
    if missing:
        sys.exit("REFUSING TO DEPLOY: missing build-time env vars: "
                 + ", ".join(missing)
                 + " — the build would bake empty Supabase config. Add them "
                   "to .env.local or the environment and retry.")


def build(env):
    run(["npm", "run", "build"], env=env)
    run(["npx", "opennextjs-cloudflare", "build"], env=env)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--skip-build", action="store_true",
                    help="reuse the existing .open-next/ instead of "
                         "rebuilding (local iteration only; still refuses "
                         "a stale build)")
    args = ap.parse_args()

    if args.skip_build:
        stale, reason = build_is_stale()
        if stale:
            sys.exit(f"REFUSING TO DEPLOY: {reason}. "
                     f"Run without --skip-build to rebuild from source.")
        print("Reusing existing .open-next/ (--skip-build); "
              "staleness check passed.", flush=True)
    else:
        env = dict(os.environ)
        ensure_build_env(env)
        build(env)

    # Assemble via the shared script (same versioned logic every run).
    run([sys.executable, os.path.join(APP_DIR, "deploy",
                                      "assemble-pages-deploy.py")])

    entry = dynamic_credential_entry("custom.cloudflare")
    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = str(entry["surrogate"]).strip()
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCOUNT_ID
    # --branch=main makes this the PRODUCTION deployment: Cloudflare treats
    # a --branch deploy as production exactly when branch == production_branch.
    # Keep in sync with the Pages project's production branch in the
    # dashboard (default "main" for new projects).
    r = run(["npx", "wrangler", "pages", "deploy", ".pages-deploy",
             "--project-name", PROJECT, "--branch=main", "--commit-dirty=true"],
            env=env, check=False)
    if r.returncode != 0:
        sys.exit(r.returncode)

    # Post-deploy smoke test. A stale/broken deployment can serve a Next.js
    # error boundary with a 200 and no other signal — this catches it before
    # anyone announces "deployed".
    print("\n--- Running post-deploy smoke test ---", flush=True)
    time.sleep(10)  # Give Cloudflare a moment to propagate the deployment
    s = subprocess.run(
        [sys.executable, os.path.join(APP_DIR, "deploy",
                                      "smoke-test-staging.py"), STAGING_URL],
        cwd=APP_DIR)
    if s.returncode != 0:
        print("\n*** DEPLOY MAY BE BROKEN — smoke test failed, "
              "investigate before announcing ***")
    sys.exit(s.returncode)


if __name__ == "__main__":
    main()

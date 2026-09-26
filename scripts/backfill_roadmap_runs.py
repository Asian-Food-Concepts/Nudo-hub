#!/usr/bin/env python3
"""scripts/backfill_roadmap_runs.py — one-off import of historical runs into public.roadmap_runs.

BEN'S EXPLICIT INSTRUCTION (2026-09-26):
"yes, backfill even if zero, we should record failures too."

Import EVERY run from ~/.hermes/profiles/oversight/work/agycore.jsonl, including real failures
(two stalled runs that burned 1324s/209 steps and 1248s/212 steps, plus short failures).

⚠️ `tokens` STAYS NULL FOR EVERY BACKFILLED ROW — not zero. A 0 in tokens asserts the run consumed
no tokens, which is demonstrably false. The number was never captured. NULL means "not measured",
and the UI prints "sin datos de tokens" and excludes them from totals.

Idempotent: does NOT overwrite a row that already exists.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

# Add agycore to sys.path so we can use queue helpers
AGYCORE_DIR = Path.home() / ".hermes" / "profiles" / "oversight" / "scripts" / "agycore"
if str(AGYCORE_DIR) not in sys.path:
    sys.path.insert(0, str(AGYCORE_DIR))

import queue as q  # noqa: E402

LOG_PATH = Path.home() / ".hermes" / "profiles" / "oversight" / "work" / "agycore.jsonl"

# Known commit shas produced by successful roadmap runs on 2026-09-26
GIT_COMMITS = {
    ("planear-popup-centered", 2): "cf7cc83",
    ("onboarding-verify-collapse", 2): "4dfc2b8",
    ("notification-prefs", 3): "8baab2b",
    ("partner-projects-page", 1): "42d9432",
    ("silent-failure-review", 1): "26b7a2a",
    ("silent-failure-review", 2): "59dabbe",
    ("mant-table-formatting", 1): "bdb0c34",
    ("onboarding-creates-profile", 1): "2c82c6d",
    ("admin-block-roadmap", 1): "500c90a",
}


def load_roadmap_map() -> tuple[dict[int, dict], dict[str, dict]]:
    roadmap_rows = json.loads(q._sql("select id, priority_rank, dedupe_key, title from public.roadmap;"))
    by_rank = {r["priority_rank"]: r for r in roadmap_rows if r.get("priority_rank") is not None}
    by_key = {r["dedupe_key"]: r for r in roadmap_rows if r.get("dedupe_key")}
    return by_rank, by_key


def main() -> int:
    if not LOG_PATH.exists():
        print("Log file not found: %s" % LOG_PATH)
        return 1

    by_rank, by_key = load_roadmap_map()

    lines = []
    with open(LOG_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    lines.append(json.loads(line))
                except Exception:
                    pass

    claims = {}
    attempts: dict[str, int] = {}
    inserted = 0
    skipped = 0

    for entry in lines:
        ev = entry.get("event")
        if ev == "claim":
            claims[entry.get("item")] = entry
        elif ev == "run":
            item = entry.get("item")
            claim = claims.get(item, {})

            # Map item (e.g. 'roadmap-6') to dedupe_key
            target_key = None
            if item in by_key:
                target_key = item
            elif item and str(item).startswith("roadmap-"):
                try:
                    rk = int(str(item).split("-", 1)[1])
                    if rk in by_rank:
                        target_key = by_rank[rk].get("dedupe_key")
                except ValueError:
                    pass
            if not target_key:
                target_key = item or "unknown"

            attempts[target_key] = attempts.get(target_key, 0) + 1
            att = attempts[target_key]

            ok = entry.get("ok")
            stalled = entry.get("stalled")
            if ok:
                outcome = "done"
            elif stalled:
                outcome = "infra"
            else:
                outcome = "failed"

            commit = GIT_COMMITS.get((target_key, att))

            # Check if this (roadmap_id, attempt) already exists
            check_sql = "select id from public.roadmap_runs where roadmap_id=%s and attempt=%d;" % (
                q._lit(target_key), att
            )
            existing = q._rows(check_sql)
            if existing:
                print("  skip existing: %s #%d" % (target_key, att))
                skipped += 1
                continue

            # Insert: tokens is deliberately LEFT NULL (Never write 0 for unknown)
            cols = ["roadmap_id", "attempt", "outcome", "tokens", "note"]
            vals = [q._lit(target_key), str(att), q._lit(outcome), "null", q._lit("imported from agycore.jsonl")]

            started_at = entry.get("ts")
            if started_at:
                cols.append("started_at")
                vals.append(q._lit(started_at))

            elapsed = entry.get("elapsed")
            if elapsed is not None:
                cols.append("elapsed_secs")
                vals.append(str(round(float(elapsed), 1)))

            steps = entry.get("steps")
            if steps is not None:
                cols.append("steps")
                vals.append(str(int(steps)))

            model = claim.get("model")
            if model:
                cols.append("model")
                vals.append(q._lit(model))

            if commit:
                cols.append("commit_sha")
                vals.append(q._lit(commit))

            insert_sql = "insert into public.roadmap_runs (%s) values (%s);" % (
                ", ".join(cols), ", ".join(vals)
            )
            q._sql(insert_sql)
            print("  + backfilled: %s #%d (%s, elapsed=%.1fs, steps=%s, sha=%s)" % (
                target_key, att, outcome, float(elapsed or 0), steps, commit or "—"
            ))
            inserted += 1

    print("\nBackfill complete: %d inserted, %d skipped." % (inserted, skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main())

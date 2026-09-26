-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- roadmap_runs — what one attempt at a roadmap item cost, and what it produced.
--
-- WHY THIS EXISTS (Ben, 2026-09-26): "can you track token consumption and run time for each
-- request in this roadmap? so its roadmap, and done items, for done items i should be able to go
-- in and ask for refinements etc"
--
-- The numbers were ALREADY measured and then thrown away. `agy.py` parses `total_tokens` off the
-- stream's `result` event into `Run.tokens`, and `Run.elapsed`/`Run.steps` have always been there
-- — but `run.py`'s run event persisted only item/elapsed/steps/committed/files. So the cost of an
-- item was recoverable only while the stream file happened to survive.
--
-- ⚠️ ONE ROW PER ATTEMPT, not one row per item. A `done` item can be sent back with a refinement;
-- that is a SECOND attempt, and attempt 1's time and tokens must stay readable. Collapsing to one
-- row per item would silently overwrite the history the refinement flow exists to preserve.
--
-- ⚠️ `tokens` IS NULLABLE, AND NULL IS NOT ZERO. Historical runs (imported from agycore.jsonl)
-- have elapsed and steps but NO token data — it was never captured. Writing 0 there would be a
-- REAL-LOOKING MEASUREMENT THAT IS FALSE: "this run used no tokens". NULL means "not measured",
-- and the UI must say `sin datos de tokens`. A fake that lies produces false passes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.roadmap_runs (
  id            uuid        primary key default gen_random_uuid(),
  -- The roadmap item's `dedupe_key`. ⚠️ NOT `priority_rank`: rank is a display position Ben can
  -- reorder at any time (and is not even unique), so keying cost history on it would detach the
  -- history from its item the first time someone dragged a row.
  roadmap_id    text        not null,
  attempt       int         not null,
  started_at    timestamptz not null default now(),
  elapsed_secs  numeric,
  tokens        bigint,                    -- NULL = not measured. Never 0-for-unknown.
  steps         int,
  model         text,                      -- the model FAMILY the run used (agy.py: Run.family)
  outcome       text        not null,      -- 'done' | 'failed' | 'infra'
  commit_sha    text,                      -- short sha this attempt produced, when it produced one
  note          text,                      -- the refinement request that triggered this attempt
  constraint roadmap_runs_attempt_once unique (roadmap_id, attempt),
  constraint roadmap_runs_outcome_check check (outcome in ('done','failed','infra'))
);

comment on column public.roadmap_runs.tokens is
  'Total tokens for this attempt. NULL means NOT MEASURED (historical runs) — never write 0 for unknown.';
comment on column public.roadmap_runs.attempt is
  '1 for the first run of an item; a refinement re-queue makes attempt 2, and attempt 1 stays readable.';

-- The UI reads all attempts for one item, newest first.
create index if not exists roadmap_runs_by_item
  on public.roadmap_runs (roadmap_id, attempt desc);

-- ── RLS: mirror public.roadmap exactly ───────────────────────────────────────────────────────
-- roadmap uses `is_dueno()` for both SELECT and ALL. Same predicate here, so the file keeps ONE
-- definition of "owner" and cost history is no more visible than the roadmap itself.
-- The engine writes with the service role, which bypasses RLS by design.
alter table public.roadmap_runs enable row level security;

drop policy if exists roadmap_runs_read  on public.roadmap_runs;
drop policy if exists roadmap_runs_write on public.roadmap_runs;

create policy roadmap_runs_read on public.roadmap_runs
  for select to public using (is_dueno());

create policy roadmap_runs_write on public.roadmap_runs
  for all to public using (is_dueno()) with check (is_dueno());

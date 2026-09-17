# Nudo Hub — Agent Context (for Antigravity/Gemini sessions)

You are working on the **Nudo Hub** staff PWA: mobile-first, Spanish-language,
deployed via GitHub Pages at `https://asian-food-concepts.github.io/Nudo-hub/`
(repo `Asian-Food-Concepts/Nudo-hub`, branch `main`, auto-deploys on push).

**Owner: Ben (Dueño).** English replies to Ben; app UI text stays Spanish.

## NON-NEGOTIABLE RULES

1. **Never `git push` unless the task explicitly says to ship.** Never commit
   without first showing what changed. This repo deploys to PRODUCTION on push
   (staff use it daily).
2. **Any shipped change bumps ALL THREE version artifacts together:**
   - `app.html` → `APP_VERSION` (e.g. `v0.119`)
   - `sw.js` → `const CACHE` = `nudo-hub-v<N+1>` (bump N on every ship)
   - `version.json` → `{"version": "...", "cache": "...", "ts": "<now>Z"}`
   The version.json beacon is what heals stale clients — never skip it.
3. **Validate JS before commit:** extract every `<script>` block from
   app.html → `node --check`. A broken block ships a dead app silently.
4. **Verify patches landed:** grep the file for the new string AND the absence
   of the old string before committing. Patches can silently no-op.
5. **Visual changes need a screenshot check at ~390px width** (mobile).
   Grep passes cannot catch paint/layering bugs.

## MOBILE-FIRST RULES (Ben's standing order)

- All buttons/selects/toggles thumb-friendly: ≥44px tap targets, 16px control
  font (prevents iOS zoom), full-width actions.
- Planner opens in Día view by default under 700px.

## Z-INDEX LAYER MAP (check BEFORE any new fixed/overlay element)

  sticky-submit 30 < bottom dock 50 < review/estatus-detail 60 <
  plan-modal 70 < toast-wrap 90 < tooltips 99

- New fixed/floating elements must be z > 70 OR participate in the
  `body.modal-open` hiding mechanism (MutationObserver on `.hidden` of
  `.plan-modal, .review-modal` fades the dock).
- Equal z-index + later DOM order = later element wins the paint.

## COUPLED GEOMETRY (change together or the wheel breaks)

Entrevistas wheel picker: `.wheel-mask` height ↔ JS `CENTER = mask/2 − 17`
(currently 112px ↔ 39). Highlight bar anchors to `top: 56px` (mask centerline),
NOT `top: 50%`. Ben prefers compact 3-row wheels.

## STRUCTURAL CONVENTIONS (do not regress)

- **NO SECRETS IN THIS REPO — it is PUBLIC.** Never put a door/alarm code,
  password, API key, or staff credential in `app.html`, `sw.js`, in a code
  comment, or in a commit message. The access codes live in Supabase table
  `access_codes` (RLS: the caller must have a `profiles` row, not merely a
  valid JWT) and are fetched after login by `loadAccessCodes()`.
  Before declaring ANY secrets fix done, grep the WHOLE TREE — a fix scoped to
  `app.html` alone once left `sw.js` leaking the identical codes (v0.134).
- userbar lives INSIDE `<header>` as bottom row with hairline separator
  (v0.116 — Ben explicitly wants ONE unified card, no standalone strips).
- Bitácora field order: Reservaciones → Corte → Propinas → Descuentos y
  Cortesías (Comida de empleados nested below) → Notas → Foto → Confirmación.
  Corte = 2-state category (✅ / ⚠️ + nota).
  Comida de empleados = Sunday-only, required Sundays.
- Bitácora AREA SUB-HEADERS (v0.136, Ben) — `.form-subhead` dividers, in document
  order: Turno / Equipo y servicio / Producto / Instalaciones / Operación y caja /
  Cierre. They are pure insertions; do NOT move a field to "fix" a group. If you
  move a divider, re-dump `header → fields` in document order — a per-header grep
  passes even when a field ends up in the wrong group.
- Producción is its OWN role group in the planner (not merged with Cocina).
- shifts table unique index (branch, slot, shift_date) — save paths UPSERT
  with onConflict 'branch,slot,shift_date'.
- supabase-js PINNED at @2.116.0 — do not change the version.
- Auth: OTP options key is `emailRedirectTo` (NOT `redirectTo` — silently
  ignored). Never click/consume Ben's real magic links during testing —
  single-use AND device-paired. Use throwaway addresses.

## DEPLOY VERIFICATION (after any push)

1. Wait 60–90s, then `curl --max-time 15 https://asian-food-concepts.github.io/Nudo-hub/version.json`
   — must show the new version.
2. `curl --max-time 20 .../app.html | grep` the new APP_VERSION + your fix strings.
3. If beacon still old: re-check once more before declaring failure (Pages lag varies).
4. Transient full-site 404 during a Pages rebuild is normal (minutes).

## LOCAL REPO FACTS

- Clone lives at `/private/tmp/nudo-hub-work` — tmpfs, wiped on reboot.
  If missing: `git clone git@github.com:Asian-Food-Concepts/Nudo-hub.git /private/tmp/nudo-hub-work`
  then `git log --oneline -3` and compare with live version.json.
- `git commit` shows an identity warning (macmini2@hostname) — cosmetic, push succeeds.
- Backend = Supabase project `dnzvkppytzjsipwfhafk` (free tier, auto-pauses
  ~7 days idle; a keepalive cron exists — don't build your own).
- This repo also contains `live.html` (marketing page, injected daily by cron)
  and `guia.html`, `contactos.html` — don't touch unless asked.
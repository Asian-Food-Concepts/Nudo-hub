CLASSIFICATION OF THE 12 HARNESS FAILURES
=========================================

1. "a Tue->Tue window maps every submission to ONE week"  → MY TEST IS WRONG
   2026-09-23 is a WEDNESDAY. The rule says Wed..Sun → +14 → Oct 5.
   That is CORRECT behaviour. I mislabelled the window as Tue->Tue but
   included Wed 23 through Tue 29. The app is right; my assertion was wrong.

2. "range label spans Mon..Sun" (_MESES is not defined)     → MY HARNESS IS WRONG
3. "range label collapses the month" (_MESES)               → MY HARNESS IS WRONG
4. "cutoff label is the Tuesday..." (_DIAS is not defined)   → MY HARNESS IS WRONG
5. "cutoff label agrees with the week rule" (_DIAS)          → MY HARNESS IS WRONG
6. "the cutoff is always a Tuesday" (_DIAS)                  → MY HARNESS IS WRONG
7. "on 21 Sep 2026 the form shows..." (_MESES)               → MY HARNESS IS WRONG
   _MESES and _DIAS are module-level `const`s at app.html:5721-5722, NOT
   function declarations. My extractor only pulls `function NAME(...)`, so the
   functions loaded without their sibling constants. Fix the extractor to also
   capture referenced module-level const/let declarations.

8. "normalize strips Spanish accents"                        → MY TEST IS WRONG
   I wrote normalize('MÉRCOLES') expecting 'miercoles'. The correct Spanish
   spelling is "miércoles" (with an i). 'MÉRCOLES' has no i, so normalize
   correctly returned 'mercoles'. The app is right; I misspelled the input.

9. "excerptAround windows around the match"                  → MY TEST IS WRONG
   I asserted a leading ellipsis, but with span=54 and the match at index ~31,
   from = max(0, 31-54) = 0, so there is correctly no leading ellipsis.
   The app is right; my expectation assumed the match was further in.

10-12. "urlBase64ToUint8Array ..." (window.atob is not a function) → MY HARNESS IS WRONG
   The function calls `window.atob(...)`, but I only defined `ctx.atob`.
   Fix: expose atob/btoa on the `window` stub too.

CONCLUSION: ZERO defects found in app.html. All 12 failures are errors in the
test harness or in my own expectations. This is the harness doing its job — but
it is also a warning: if I had "fixed" app.html to make these pass, I would have
BROKEN working code in exactly the way a careless automated refactor does.

That is the argument for building this before letting any refactor run.

#!/usr/bin/env node
/**
 * Nudo Hub test harness — ZERO dependencies (plain node).
 *
 * WHY THIS EXISTS
 * app.html is ~6,600 lines / 354 KB with EVERYTHING nested inside one 257 KB
 * function (`initApp`). There was no test infrastructure at all, so any
 * refactor was unverifiable: you could not tell "I moved code" from "I broke
 * code". This harness extracts the PURE, DOM-free functions from the real
 * app.html and runs them in a sandbox, so a refactor can be proven harmless.
 *
 * It reads the SHIPPED file — never a copy — so a test can only pass if the
 * code that actually deploys is correct.
 *
 * USAGE
 *   node tests/harness.js            # run every test file
 *   node tests/harness.js pure       # run only tests/pure.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.html');

// ---------------------------------------------------------------------------
// Source extraction
// ---------------------------------------------------------------------------

/** Pull every inline <script> body out of the html, biggest first. */
function scriptBlocks(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out.sort((a, b) => b.length - a.length);
}

/** The document MARKUP (everything except the inline scripts), for the fake DOM. */
function extractMarkup(html) {
  return html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g, '');
}

/**
 * Extract a named function or a const-arrow function by brace matching.
 *
 * Handles BOTH shapes, because a refactor may legitimately turn
 * `function f(){}` into `const f = () => {}`:
 *     function nudoWarn(scope, err) { ... }
 *     const nudoDebug = () => { ... }
 *     const f = async (a) => { ... }
 * Anchored to a line start so a call site (`foo(`) can never match.
 */
function extractFunction(src, name) {
  const patterns = [
    // function NAME(  /  async function NAME(
    '^[ \\t]*(?:async[ \\t]+)?function[ \\t]+' + name + '[ \\t]*\\(',
    // const/let/var NAME = function(  /  = async function(  -- an EXPLICIT function
    '^[ \\t]*(?:const|let|var)[ \\t]+' + name + '[ \\t]*=[ \\t]*(?:async[ \\t]+)?function[ \\t]*\\(',
    // const/let/var NAME = (  -> ARROW. Must be immediately followed by `=>`.
    '^[ \\t]*(?:const|let|var)[ \\t]+' + name + '[ \\t]*=[ \\t]*(?:async[ \\t]+)?\\([^)]*\\)[ \\t]*=>[ \\t]*\\{',
    // const/let/var NAME = x =>  -> single-param ARROW.
    '^[ \\t]*(?:const|let|var)[ \\t]+' + name + '[ \\t]*=[ \\t]*(?:async[ \\t]+)?[A-Za-z_$][\\w$]*[ \\t]*=>[ \\t]*\\{',
  ];
  for (const p of patterns) {
    const m = new RegExp(p, 'm').exec(src);
    if (!m) continue;
    const braceStart = src.indexOf('{', m.index);
    if (braceStart === -1) continue;
    // The `{` must be the BODY opener, not just the next brace anywhere. For the
    // declaration patterns the match already ends at `(`, so what remains before
    // the brace is the parameter list; for an arrow pattern the body brace is
    // consumed by the pattern itself. A `.` or `;` in between means this is an
    // expression (`let text = ($('x').value).trim();`) and must be rejected —
    // slicing that produced a fragment with a bare `return` and threw
    // "Illegal return statement" at load.
    const between = src.slice(m.index + m[0].length, braceStart);
    if (/[;.]/.test(between)) continue;
    const close = matchBrace(src, braceStart);
    if (close === -1) continue;
    return src.slice(m.index, close + 1);
  }
  return null;
}

/**
 * Find the matching close brace for a body starting at `openIdx`.
 *
 * MUST skip string, template AND REGEX literals. A regex like /[&<>"']/ contains
 * no brace, but /[{}]/ does — and `esc`'s regex `/['"]/g` inside a template-heavy
 * function was enough to desynchronise a naive counter, which then ran past the
 * function's end and swallowed the next several functions. That is how `esc`
 * returned 4008 chars and `escAttr` became unextractable.
 *
 * Template literals are tracked with their `${}` nesting so a `}` inside a
 * template expression does not close the function early.
 */
function matchBrace(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  const tmpl = [];   // stack of template-literal brace depths
  let prev = '';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    // line comment
    if (c === '/' && next === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) return -1;
      continue;
    }
    // block comment
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    // regex literal (only where a value may start)
    if (c === '/' && isRegexStart(prev)) {
      i = skipRegex(src, i);
      if (i === -1) return -1;
      prev = '/';
      continue;
    }
    // strings
    if (c === '"' || c === "'") {
      i = skipString(src, i, c);
      if (i === -1) return -1;
      prev = c;
      continue;
    }
    // template literal
    if (c === '`') {
      i = skipTemplate(src, i);
      if (i === -1) return -1;
      prev = '`';
      continue;
    }
    if (c === '{') {
      depth++;
      if (tmpl.length) tmpl[tmpl.length - 1] = depth;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return -1;
}

function isRegexStart(prev) {
  // A regex can follow an operator, an opening delimiter, a comma, or nothing.
  // If the previous meaningful char is an identifier/number/closing bracket, this
  // is a division.
  return prev === '' || /[=(,:[!&|?{};+\-*%^~<>]/.test(prev);
}

function skipString(src, i, q) {
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i + 1;
    if (src[i] === '\n') return i + 1; // unterminated: stop
    i++;
  }
  return -1;
}

function skipRegex(src, i) {
  i++;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;  // flags
      return i;
    } else if (c === '\n') return -1;
    i++;
  }
  return -1;
}

function skipTemplate(src, i) {
  // Walk a template literal, honouring ${ ... } nesting (which may itself contain
  // strings, templates and braces).
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      const end = matchBrace(src, i + 1);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    i++;
  }
  return -1;
}

/** Names of every function-shaped declaration (function, or const arrow). */
function functionNames(src) {
  const names = [];
  let m;
  const reDecl = /^[ \t]*(?:async[ \t]+)?function[ \t]+(\w+)[ \t]*\(/gm;
  while ((m = reDecl.exec(src)) !== null) names.push(m[1]);
  const reArrow = /^[ \t]*(?:const|let|var)[ \t]+(\w+)[ \t]*=[ \t]*(?:async[ \t]+)?(?:function[ \t]*)?\(/gm;
  while ((m = reArrow.exec(src)) !== null) names.push(m[1]);
  return names;
}

/**
 * Extract a module-level `const NAME = ...;` / `let NAME = ...;` declaration.
 *
 * WHY: some functions depend on a sibling constant rather than another function
 * (_MESES / _DIAS at app.html:5721-5722 feed descansoRangeLabel). A function-only
 * extractor loads those functions without their constants, and they throw
 * "X is not defined" — which reads as a broken function when in fact the harness
 * failed to bring the dependency along.
 *
 * Only single-line declarations are handled. A multi-line initialiser (an object
 * literal spanning lines) returns null rather than a truncated, invalid snippet —
 * a partial const would be worse than none, because it would evaluate.
 */
function extractConst(src, name) {
  const re = new RegExp('^[ \\t]*(?:const|let|var)[ \\t]+' + name + '[ \\t]*=', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const nl = src.indexOf('\n', m.index);
  if (nl === -1) return null;
  const line = src.slice(m.index, nl).trim();
  // Reject a line that opens a bracket it does not close (multi-line initialiser).
  const opens = (line.match(/[{\[\(]/g) || []).length;
  const closes = (line.match(/[}\]\)]/g) || []).length;
  if (opens !== closes) return null;
  if (!line.endsWith(';')) return null;
  return line;
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Build a context containing the named functions plus any function they call
 * (transitively), so an extracted function is never tested against a missing
 * dependency — a silent ReferenceError would otherwise look like a failure of
 * the code under test.
 *
 * `opts.now` freezes the clock: every `new Date()` returns that instant, which
 * is what makes the descansos week-rule tests deterministic instead of
 * "whatever day you happen to run them".
 */
function sandbox(src, names, opts = {}) {
  // Markup for the fake DOM. `src` is only the script block, so the document
  // markup is passed in by the caller (the runner reads it from app.html). When
  // absent, the fake DOM starts empty and lookups return null — which is correct
  // for tests that build their own tree.
  const htmlMarkup = opts.markup === undefined ? '' : opts.markup;

  const ctx = {
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };

  if (opts.now) {
    const fixed = opts.now instanceof Date ? opts.now : new Date(opts.now);
    const Real = Date;
    function FrozenDate(...args) {
      if (!(this instanceof FrozenDate)) return new Real(fixed.getTime()).toString();
      if (args.length === 0) return new Real(fixed.getTime());
      return new Real(...args);
    }
    FrozenDate.now = () => fixed.getTime();
    FrozenDate.parse = Real.parse;
    FrozenDate.UTC = Real.UTC;
    FrozenDate.prototype = Real.prototype;
    ctx.Date = FrozenDate;
  }

  // -------------------------------------------------------------------------
  // DOM: a REAL fake DOM, not a null-returning stub.
  //
  // The earlier stub returned null for every lookup, which made DOM functions
  // untestable AND created false passes (a render wrote into nothing and the
  // assertion "no error thrown" still held). tests/fakedom.js implements parsing,
  // bubbling events and a strict selector engine, so render/lookup/wire functions
  // can actually run and be asserted on.
  //
  // opts.html  — the document markup to load (default: app.html's own markup, so
  //              the elements a function looks for really exist). Pass '' to start
  //              from an empty document.
  // opts.dom   — pass your own Document instance to keep a handle on it.
  // -------------------------------------------------------------------------
  const fakedom = require('./fakedom.js');
  const docHtml = opts.html === undefined ? htmlMarkup : opts.html;
  const document_ = opts.dom || new fakedom.Document(docHtml);
  ctx.document = document_;
  ctx.DocumentFragment = function () { return document_.createDocumentFragment(); };
  ctx.MutationObserver = class {
    constructor(cb) { this._cb = cb; this._targets = []; }
    observe(t) { this._targets.push(t); }
    disconnect() { this._targets = []; }
    takeRecords() { return []; }
  };
  ctx.IntersectionObserver = ctx.MutationObserver;
  ctx.ResizeObserver = ctx.MutationObserver;
  ctx.requestAnimationFrame = (fn) => { if (typeof fn === 'function') fn(0); return 1; };
  ctx.cancelAnimationFrame = () => {};


  // -------------------------------------------------------------------------
  // EGRESS BAN — Ben's standing constraint: NO email and NO WhatsApp while testing.
  //
  // This is a STRUCTURAL guarantee, not a convention. The harness can only send
  // something if a loaded function can reach a network primitive. So the sandbox
  // simply does not provide one, and anything that could transmit records the
  // attempt instead of making it.
  //
  // Why record rather than throw: the point of testing a notification path is to
  // assert WHAT it tried to do. A throwing stub can only prove "it failed"; a
  // recorder proves "it called fetch with exactly this URL" AND is incapable of
  // delivering anything. Both properties matter here.
  //
  // If a future test genuinely needs a live call, it must not do it here.
  // -------------------------------------------------------------------------
  const egress = [];
  const summarize = (v) => {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    try { return typeof v === 'string' ? v.slice(0, 200) : JSON.parse(JSON.stringify(v)); }
    catch { return '[unserializable]'; }
  };
  const record = (fn) => (...args) => {
    egress.push({ fn, args: args.map(summarize), at: new Date().toISOString() });
    // A promise that resolves LOCALLY. No socket is ever opened.
    //
    // DO NOT add a `then` property to the resolved object. Doing so makes it a
    // thenable, and `Promise.resolve(thenable)` adopts its state by CALLING
    // `then(resolve, reject)` — with a self-referential `then` that recurses
    // forever and hangs the whole test run (took a 400s timeout to diagnose).
    // A plain object with no `then` awaits correctly and is inert.
    return Promise.resolve({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({}), text: async () => '', blob: async () => null,
      headers: { get: () => null }, body: null,
    });
  };

  // Every transmission primitive the app could plausibly reach. fetch is the only
  // one nudo-hub actually uses (supabase-js is bundled in a separate external
  // script that this sandbox never loads — see tests/safety.test.js).
  ctx.fetch = record('fetch');
  ctx.XMLHttpRequest = function () { egress.push({ fn: 'XMLHttpRequest', args: [] }); return { open: record('xhr.open'), send: record('xhr.send'), setRequestHeader() {} }; };
  ctx.WebSocket = function () { egress.push({ fn: 'WebSocket', args: [] }); return { send: record('ws.send'), close() {} }; };
  ctx.EventSource = function () { egress.push({ fn: 'EventSource', args: [] }); return { close() {} }; };
  ctx.sendBeacon = record('sendBeacon');
  ctx.importScripts = record('importScripts');

  // navigator.vibrate must stay a NO-OP (it is a deliberate silent catch in the
  // app and must not become a recorded egress, or haptic() tests get noisy).
  ctx.navigator = {
    vibrate: () => false,
    userAgent: 'node-test-sandbox',
    // BOTH spellings of every transmission primitive must be stubbed. Real code
    // reaches these through `navigator.` (navigator.sendBeacon) far more often
    // than through the bare global, and a fence that only covers the bare global
    // has a hole exactly where the real send would go. (Found by the egress-fire
    // positive control, which is why that test exists.)
    sendBeacon: record('navigator.sendBeacon'),
    serviceWorker: { register: record('sw.register'), ready: Promise.resolve({ pushManager: { subscribe: async () => ({ endpoint: 'about:blank#blocked' }) } }) },
    onLine: true,
    language: 'es-MX',
  };
  ctx.Notification = Object.assign(
    function Notification() { egress.push({ fn: 'new Notification', args: [] }); return { close() {} }; },
    { permission: 'denied', requestPermission: record('Notification.requestPermission') }
  );
  ctx.serviceWorker = ctx.navigator.serviceWorker;
  ctx.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
  ctx.sessionStorage = ctx.localStorage;
  ctx.addEventListener = () => {};
  ctx.postMessage = record('postMessage');

  // window must exist as its own object (app.html uses window.innerWidth,
  // window.addEventListener, window.matchMedia, window.atob). atob/btoa are
  // ALSO on window, because `window.atob(...)` does not resolve via ctx.atob.
  ctx.window = {
    innerWidth: 390,          // mobile-first: the app's real target
    innerHeight: 844,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: ctx.localStorage,
    sessionStorage: ctx.sessionStorage,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
    atob: ctx.atob,
    btoa: ctx.btoa,
    scrollTo: () => {},
    open: () => null,
    location: { href: 'https://asian-food-concepts.github.io/Nudo-hub/app.html', hash: '', search: '', origin: 'https://asian-food-concepts.github.io', pathname: '/Nudo-hub/app.html', reload: () => {}, assign: () => {} },
    navigator: ctx.navigator,
    document: ctx.document,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: ctx.requestAnimationFrame,
  };
  ctx.location = ctx.window.location;
  ctx.history = { pushState: () => {}, replaceState: () => {}, back: () => {} };
  ctx.screen = { width: 390, height: 844, availWidth: 390, availHeight: 844 };
  ctx.performance = { now: () => 0 };
  ctx.innerWidth = 390;
  ctx.innerHeight = 844;
  ctx.matchMedia = ctx.window.matchMedia;
  ctx.caches = { open: record('caches.open'), keys: async () => [], delete: async () => true, match: async () => undefined };
  ctx.addEventListener = () => {};

  // Hard seal the transmission path even if a loaded body reaches for a global we
  // forgot: anything not defined is undefined, so it throws instead of sending.
  vm.createContext(ctx);

  // PRE-SEED MUTABLE MODULE STATE.
  //
  // WHY: `let horasRoster = []` and `const planState = {...}` are declared inside
  // initApp, so extractFunction/extractConst never pull them in. Inside an
  // extracted function such a name resolves to a GLOBAL — which is exactly the
  // hook tests need to drive the function with realistic data. Without this,
  // every state-dependent function is untestable, which is why the first pass
  // covered only the small stateless helpers.
  //
  // Assign AFTER createContext so these land as real globals in the context.
  for (const [k, v] of Object.entries(opts.globals || {})) {
    ctx[k] = v;
  }

  // `getters` are read AFTER the bodies load, for state a function mutates itself
  // (e.g. a cache) that a test wants to inspect.
  Object.defineProperty(ctx, '__get', {
    value: (name) => ctx[name],
    enumerable: false,
  });


  // Resolve the transitive closure of dependencies.
  //
  // FIXED: the first version had `if (seen.has(name) || !names.includes(name)) return;`
  // — so a recursion into a dependency that the caller had not ALSO listed bailed
  // out immediately. The closure resolution was therefore dead code: every test
  // had to hand-list every dependency, and a missing one surfaced as a confusing
  // "X is not defined" mid-test (exactly how escAttr hid inside horasOptions).
  //
  // Now: names the caller asks for are REQUIRED (a missing one is an error), and
  // anything they call is pulled in automatically if it exists in the file.
  const available = new Set(functionNames(src));
  const wanted = [];
  const seen = new Set();
  const missing = [];
  function add(name, required) {
    if (seen.has(name)) return;
    if (!names.includes(name) && !available.has(name)) {
      if (required) missing.push(name);
      return;
    }
    const body = extractFunction(src, name);
    if (!body) {
      if (required) missing.push(name);
      return;
    }
    seen.add(name);
    // Register BEFORE recursing so mutual recursion terminates.
    wanted.push({ name, body });
    // Only CALLS, not member accesses or keywords.
    //   `Math.min(...)` must not pull in a `min`; `.then(` must not pull `then`;
    //   `if (` / `for (` are not calls at all.
    // The [^.\w$] guard excludes anything reached through a dot, and the keyword
    // filter drops control-flow parens (which the `available` check would skip
    // anyway, but naming them keeps the intent obvious).
    const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
                        'function', 'new', 'await', 'else', 'do', 'delete', 'void', 'in', 'of']);
    const called = new Set(
      [...body.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((x) => x[1])
        .filter((n) => !KW.has(n))
    );
    for (const c of called) add(c, false);
  }
  names.forEach((n) => add(n, true));
  if (missing.length) {
    throw new Error('sandbox: requested function(s) not found in app.html: ' + missing.join(', '));
  }

  // Bring along module-level CONSTANTS the loaded functions close over.
  //
  // WHY AN EXPLICIT LIST, not an automatic scan: a scan over every identifier in
  // the extracted bodies is unstable. It matches `e` in `catch (e) {}` and short
  // locals, and any one-letter name that happens to be declared as a `const`
  // somewhere in this 6,600-line file gets pulled in — which then fails to load
  // ("s is not defined") or silently shadows a real value. Two attempts at a
  // clever auto-scan both produced that failure. A named list is honest: it
  // states exactly what the harness depends on, and adding a dependency is a
  // deliberate one-line change.
  //
  // Only SINGLE-LINE declarations can be pulled (see extractConst); if a needed
  // constant is declared across several lines, the test using it will report the
  // missing name and it must be added here by hand rather than half-extracted.
  const NEEDED_CONSTS = ['_MESES', '_DIAS', '__nudoDiagOnce'];
  for (const ident of NEEDED_CONSTS) {
    if (seen.has(ident)) continue;
    const decl = extractConst(src, ident);
    if (decl) {
      seen.add(ident);
      wanted.push({ name: ident, body: decl });
    }
  }

  for (const { name, body } of wanted) {
    try {
      // APPEND AN EXPLICIT EXPORT.
      // A top-level `const f = () => {}` (or `let`) run via runInContext lands in
      // the context's global LEXICAL scope — reachable from later scripts, but
      // NOT a property of the context object, so `ctx.f` is undefined and the
      // test reports "f is not a function". A `function` declaration DOES become
      // a property, which is why only the arrow-shaped helpers failed. Binding
      // with globalThis.<name> makes both shapes readable identically.
      vm.runInContext(
        body + '\n;try{globalThis.' + name + ' = ' + name + ';}catch(e){}',
        ctx,
        { filename: `app.html:${name}` }
      );
    } catch (e) {
      throw new Error(`failed to load ${name}(): ${e.message}`);
    }
  }
  ctx.__loaded = wanted.map((w) => w.name).sort();
  // Expose the egress log so a test can assert that NOTHING was transmitted.
  // `__egress` is the recorded attempts; tests/safety.test.js proves the recorder
  // is real by asserting a deliberate fetch() lands in it.
  ctx.__egress = egress;
  return ctx;
}

// ---------------------------------------------------------------------------
// Tiny assertion library
// ---------------------------------------------------------------------------

const results = { pass: 0, fail: 0, failures: [] };

function test(name, fn) {
  try {
    fn();
    results.pass++;
  } catch (e) {
    results.fail++;
    results.failures.push({ name, message: e.message });
  }
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'eq failed'}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function ok(value, msg) {
  if (!value) throw new Error(msg || 'expected truthy, got ' + JSON.stringify(value));
}

function includes(hay, needle, msg) {
  if (String(hay).indexOf(needle) === -1) {
    throw new Error(`${msg || 'includes failed'}\n    needle: ${needle}\n    hay:    ${String(hay).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(APP)) {
    console.error('app.html not found at ' + APP);
    process.exit(2);
  }
  const html = fs.readFileSync(APP, 'utf8');
  const blocks = scriptBlocks(html);
  if (!blocks.length) {
    console.error('no inline script blocks found in app.html');
    process.exit(2);
  }
  const src = blocks[0];

  const api = {
    html,
    src,
    markup: extractMarkup(html),
    extractFunction: (n) => extractFunction(src, n),
    functionNames: () => functionNames(src),
    sandbox: (names, opts) => sandbox(src, names, Object.assign({ markup: extractMarkup(html) }, opts || {})),
    test, eq, ok, includes, results,
    ROOT,
  };

  const filter = process.argv[2];
  const dir = __dirname;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => !filter || f.includes(filter))
    .sort();

  if (!files.length) {
    console.error('no test files matched' + (filter ? ` filter "${filter}"` : ''));
    process.exit(2);
  }

  console.log(`\nNudo Hub test harness`);
  console.log(`  app.html      ${(html.length / 1024).toFixed(0)} KB, ${html.split('\n').length} lines`);
  console.log(`  script blocks ${blocks.length}  (testing the largest: ${(src.length / 1024).toFixed(0)} KB)`);
  console.log(`  functions     ${functionNames(src).length} extracted-able\n`);

  for (const f of files) {
    console.log(`— ${f}`);
    const before = { p: results.pass, f: results.fail };
    require(path.join(dir, f))(api);
    console.log(`    ${results.pass - before.p} pass, ${results.fail - before.f} fail`);
  }

  console.log(`\n${results.pass} passed, ${results.fail} failed`);
  if (results.failures.length) {
    console.log('\nFAILURES:');
    for (const f of results.failures) console.log(`  ✗ ${f.name}\n    ${f.message}`);
    process.exit(1);
  }
  console.log('OK\n');
}

if (require.main === module) main();

module.exports = { scriptBlocks, extractFunction, functionNames, sandbox };

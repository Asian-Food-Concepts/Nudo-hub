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
    // const/let/var NAME = (  /  = async (  /  = function (
    '^[ \\t]*(?:const|let|var)[ \\t]+' + name + '[ \\t]*=[ \\t]*(?:async[ \\t]+)?(?:function[ \\t]*)?\\(',
  ];
  for (const p of patterns) {
    const m = new RegExp(p, 'm').exec(src);
    if (!m) continue;
    const braceStart = src.indexOf('{', m.index);
    if (braceStart === -1) continue;
    let depth = 0;
    for (let i = braceStart; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return src.slice(m.index, i + 1);
      }
    }
  }
  return null;
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

  // Minimal DOM stub: enough that a function which TOUCHES the DOM does not
  // throw at import time, while still failing loudly if it reads a missing id.
  const elements = {};
  ctx.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {} }, appendChild() {} },
    hidden: false,
    _elements: elements,
  };
  ctx.window = {
    addEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    // A function calling `window.atob(...)` needs it HERE, not only on the
    // context: a bare ctx.atob resolves for `atob(...)` but not `window.atob(...)`.
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };

  vm.createContext(ctx);

  // Resolve the transitive closure of dependencies.
  const wanted = [];
  const seen = new Set();
  function add(name) {
    if (seen.has(name) || !names.includes(name)) return;
    const body = extractFunction(src, name);
    if (!body) return;
    seen.add(name);
    // Register BEFORE recursing so mutual recursion terminates.
    wanted.push({ name, body });
    const called = new Set([...body.matchAll(/\b(\w+)\s*\(/g)].map((x) => x[1]));
    for (const c of called) add(c);
  }
  names.forEach(add);

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
    extractFunction: (n) => extractFunction(src, n),
    functionNames: () => functionNames(src),
    sandbox: (names, opts) => sandbox(src, names, opts),
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

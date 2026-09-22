/**
 * fakedom.js — a real, small DOM implementation for testing app.html.
 *
 * WHY THIS EXISTS
 * 75 of the 181 functions inside initApp touch the DOM, so a sandbox without one
 * can only test pure logic. That is why the first pass covered only the small
 * stateless helpers. This implements enough of the DOM that render/lookup/wire
 * functions can actually RUN and be asserted on.
 *
 * DESIGN RULES (learned the hard way)
 *  1. innerHTML must PARSE, not just store a string. The app renders a template,
 *     assigns it to innerHTML, then queries the elements inside it. A store-only
 *     stub makes every one of those lookups return null and turns "the app is
 *     correct" into "my stub is empty" — the most dangerous kind of false pass.
 *  2. Events must BUBBLE, because the app relies on delegation. The Cancelar bug
 *     was exactly this: the modal was a SIBLING of the delegated container, so
 *     the click never reached the handler. A non-bubbling stub cannot reproduce
 *     that, so it cannot protect against it.
 *  3. Unsupported selectors must THROW, never silently return []. A test that
 *     queries something this stub cannot parse has to find out.
 *
 * HONEST LIMITS (documented so no test is misled):
 *  - No LAYOUT. offsetWidth/Height and getBoundingClientRect return zeros. Any
 *    function that branches on a measured size cannot be tested here.
 *  - No real PAINT, so CSS is not applied and classList does not affect layout.
 *  - :nth-child and sibling combinators (+ ~) are not implemented.
 *  - setTimeout/setInterval are real timers (tests should drive them explicitly).
 */

// ---------------------------------------------------------------------------
// Tag tokenizer
// ---------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea']);

/** Tokenize markup into a node tree. Tolerant: bad nesting closes open tags. */
function parseHTML(html, doc) {
  const root = doc.createElement('#fragment');
  const stack = [root];
  let i = 0;
  const push = (node) => { stack[stack.length - 1].appendChild(node); return node; };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    if (lt > i) addText(html.slice(i, lt));

    // comment / doctype / cdata
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    // closing tag
    const close = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(html.slice(lt));
    if (close) {
      const name = close[1].toLowerCase();
      // COMPARE CASE-INSENSITIVELY. tagName is UPPERCASE ('LI') while this name is
      // lowercased, so `stack[k].tagName === name` was never true and no closing
      // tag ever matched. Everything nested one level too deep, which silently
      // broke tree mutation, sibling delegation and <title> parsing — the exact
      // class of "the stub is wrong, so the app looks wrong" failure.
      for (let k = stack.length - 1; k >= 1; k--) {
        if (String(stack[k].tagName).toLowerCase() === name) { stack.length = k; break; }
      }
      i = lt + close[0].length;
      continue;
    }
    // opening tag
    const open = /^<([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt));
    if (!open) { addText('<'); i = lt + 1; continue; }

    const name = open[1].toLowerCase();
    const el = doc.createElement(name);
    parseAttrs(open[2], el);
    push(el);
    i = lt + open[0].length;

    // SELF-CLOSING OR VOID: never push onto the stack, and never pop.
    //
    // FIXED: the old code did `push(el)` then `stack.pop()` for a void element.
    // `push` already appends to the CURRENT top, so the pop removed the PARENT
    // instead — and once the stack emptied, the next sibling hit
    // `undefined.appendChild`. Any form with an <input> before another element
    // (i.e. every form in the app) crashed the parser.
    const selfClosed = VOID.has(name) || /\/\s*$/.test(open[2] || '') || open[0].endsWith('/>');
    if (selfClosed) continue;

    if (RAW.has(name)) {
      const re = new RegExp('</' + name + '\\s*>', 'i');
      const rest = html.slice(i);
      const m = re.exec(rest);
      const raw = m ? rest.slice(0, m.index) : rest;
      if (raw) el.appendChild(doc.createTextNode(raw));
      i = m ? i + m.index + m[0].length : html.length;
      stack.pop();
      continue;
    }
    stack.push(el);
  }

  function addText(txt) {
    if (!txt) return;
    // Keep text only where it matters; whitespace-only nodes are noise and break
    // strict child comparisons in tests.
    const last = push(doc.createTextNode(txt));
    return last;
  }

  return root;
}

function parseAttrs(s, el) {
  const re = /([:@A-Za-z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1].toLowerCase();
    if (name === '/' || name === '') continue;
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    if (name === 'class') el.className = value;
    else if (name === 'id') el.id = value;
    else el.setAttribute(name, value);
  }
}

// ---------------------------------------------------------------------------
// Element
// ---------------------------------------------------------------------------

let SEQ = 0;
const FLAG_ATTRS = new Set(['checked', 'disabled', 'selected', 'multiple', 'readonly']);

class ClassList {
  constructor(el) { this._el = el; }
  get _set() {
    return new Set(String(this._el.className || '').split(/\s+/).filter(Boolean));
  }
  _write(s) { this._el._attributes.set('class', [...s].join(' ')); }
  add(...cs) { const s = this._set; cs.forEach((c) => s.add(c)); this._write(s); }
  remove(...cs) { const s = this._set; cs.forEach((c) => s.delete(c)); this._write(s); }
  toggle(c, force) {
    const s = this._set;
    const has = s.has(c);
    const on = force === undefined ? !has : !!force;
    if (on) s.add(c); else s.delete(c);
    this._write(s);
    return on;
  }
  contains(c) { return this._set.has(c); }
  replace(a, b) { const s = this._set; if (s.delete(a)) s.add(b); this._write(s); return true; }
  get length() { return this._set.size; }
  item(i) { return [...this._set][i]; }
  get value() { return String(this._el.className || ''); }
}

class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = tag === '#text' ? 3 : 1;
    this._doc = doc;
    this._attributes = new Map();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.parentElement = null;
    this._listeners = new Map();
    this.style = makeStyle(this);
    this.dataset = makeDataset(this);
    this._seq = ++SEQ;
  }

  get id() { return this._attributes.get('id') || ''; }
  set id(v) { this._attributes.set('id', String(v)); if (this._doc) this._doc._index(this); }

  get className() { return this._attributes.get('class') || ''; }
  set className(v) { this._attributes.set('class', String(v)); }

  get classList() { return this._classList || (this._classList = new ClassList(this)); }

  // -- attributes -----------------------------------------------------------
  setAttribute(n, v) {
    n = String(n).toLowerCase();
    this._attributes.set(n, String(v));
    if (n === 'id' && this._doc) this._doc._index(this);
    // PRESENCE-ONLY FLAGS. Only `checked` / `disabled` / `selected` / `multiple` /
    // `readonly` map straight to a boolean property. `value` is NOT one of them:
    // including it set `_value = true`, which then shadowed the real value and made
    // `input.value` return the BOOLEAN true instead of "RN" (so a :checked query
    // returned an input whose .value was useless). A value attribute is data, not a
    // flag — it is read through the normal `value` getter.
    if (FLAG_ATTRS.has(n)) this['_' + n] = true;
  }
  getAttribute(n) { const v = this._attributes.get(String(n).toLowerCase()); return v === undefined ? null : v; }
  hasAttribute(n) { return this._attributes.has(String(n).toLowerCase()); }
  removeAttribute(n) { this._attributes.delete(String(n).toLowerCase()); }
  getAttributeNames() { return [...this._attributes.keys()]; }

  // -- input-ish properties -------------------------------------------------
  get value() { return this._value !== undefined ? this._value : (this._attributes.get('value') || ''); }
  set value(v) { this._value = v === null || v === undefined ? '' : String(v); }
  get checked() { return !!this._checked; }
  set checked(v) { this._checked = !!v; }
  get disabled() { return !!this._disabled; }
  set disabled(v) { this._disabled = !!v; }
  get hidden() { return this._attributes.has('hidden'); }
  set hidden(v) { if (v) this._attributes.set('hidden', ''); else this._attributes.delete('hidden'); }
  get type() { return this._attributes.get('type') || 'text'; }
  set type(v) { this._attributes.set('type', String(v)); }
  get name() { return this._attributes.get('name') || ''; }
  set name(v) { this._attributes.set('name', String(v)); }
  get placeholder() { return this._attributes.get('placeholder') || ''; }
  get files() { return this._files || (this._files = []); }
  get form() { let p = this.parentNode; while (p) { if (p.tagName === 'FORM') return p; p = p.parentNode; } return null; }
  get options() { return this._all().filter((n) => n.tagName === 'OPTION'); }
  get selectedOptions() { return this.options.filter((o) => o.selected); }
  get selectedIndex() {
    const os = this.options;
    const i = os.findIndex((o) => o.selected);
    return i === -1 ? (os.length ? 0 : -1) : i;
  }
  get selected() { return !!this._selected; }
  set selected(v) { this._selected = !!v; }

  // -- tree -----------------------------------------------------------------
  appendChild(child) {
    if (child.nodeType === 11) { child.children.slice().forEach((c) => this.appendChild(c)); child.children.length = 0; return child; }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.parentElement = this.nodeType === 1 ? this : this.parentElement;
    this.children.push(child);
    return child;
  }
  append(...ns) { ns.forEach((n) => this.appendChild(typeof n === 'string' ? this._doc.createTextNode(n) : n)); }
  prepend(...ns) {
    ns.reverse().forEach((n) => {
      const node = typeof n === 'string' ? this._doc.createTextNode(n) : n;
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this; node.parentElement = this;
      this.children.unshift(node);
    });
  }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this; node.parentElement = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i === -1) this.children.push(node); else this.children.splice(i, 0, node);
    return node;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChild(n, o) { this.insertBefore(n, o); this.removeChild(o); return o; }
  replaceWith(n) { this.parentNode && this.parentNode.replaceChild(n, this); }
  cloneNode(deep) {
    const c = this._doc.createElement(this.tagName.toLowerCase());
    this._attributes.forEach((v, k) => c._attributes.set(k, v));
    c._value = this._value; c._checked = this._checked; c._disabled = this._disabled;
    if (deep) this.children.forEach((ch) => c.appendChild(ch.cloneNode(true)));
    return c;
  }
  contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return i > 0 ? p.children[i - 1] : null; }
  _all(out) {
    out = out || [];
    this.children.forEach((c) => { out.push(c); c._all(out); });
    return out;
  }
  getElementsByTagName(t) { return this._all().filter((n) => n.tagName === String(t).toUpperCase()); }
  getElementsByClassName(c) { return this._all().filter((n) => n.classList.contains(c)); }

  // -- content --------------------------------------------------------------
  get textContent() {
    if (this.nodeType === 3) return this._text || '';
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this.children.length = 0; if (v !== '' && v != null) this.appendChild(this._doc.createTextNode(String(v))); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.children.map((c) => c.outerHTML).join(''); }
  set innerHTML(html) {
    this.children.length = 0;
    if (html === '' || html == null) return;
    const frag = parseHTML(String(html), this._doc);
    frag.children.slice().forEach((c) => this.appendChild(c));
  }
  get outerHTML() {
    if (this.nodeType === 3) return escapeText(this._text || '');
    const attrs = [...this._attributes.entries()]
      .map(([k, v]) => (v === '' ? ' ' + k : ' ' + k + '="' + escapeAttr(v) + '"')).join('');
    const open = '<' + this.tagName.toLowerCase() + attrs + '>';
    if (VOID.has(this.tagName.toLowerCase())) return open;
    return open + this.innerHTML + '</' + this.tagName.toLowerCase() + '>';
  }
  insertAdjacentHTML(pos, html) {
    const frag = parseHTML(String(html), this._doc);
    const nodes = frag.children.slice();
    if (pos === 'beforeend') nodes.forEach((n) => this.appendChild(n));
    else if (pos === 'afterbegin') this.prepend(...nodes.reverse());
    else nodes.forEach((n) => this.parentNode && this.parentNode.insertBefore(n, pos === 'beforebegin' ? this : this.nextSibling));
  }

  // -- events (BUBBLING: see design rule 2) ---------------------------------
  addEventListener(type, fn, opts) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, opts: opts || {} });
  }
  removeEventListener(type, fn) {
    const l = this._listeners.get(type);
    if (l) this._listeners.set(type, l.filter((x) => x.fn !== fn));
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let node = this;
    while (node) {
      const l = node._listeners.get(ev.type) || [];
      for (const { fn } of l.slice()) {
        if (!ev._stopped) fn.call(node, ev);
      }
      if (ev._stopped) break;
      // An inline onClick handler (the app uses a few) must also fire.
      const inline = node['on' + ev.type];
      if (typeof inline === 'function' && !ev._stopped) inline.call(node, ev);
      node = node.parentNode;
    }
    return !ev.defaultPrevented;
  }
  click() { this.dispatchEvent(makeEvent('click')); }
  focus() { this._doc.activeElement = this; this.dispatchEvent(makeEvent('focus')); }
  blur() { if (this._doc.activeElement === this) this._doc.activeElement = this._doc.body; this.dispatchEvent(makeEvent('blur')); }
  select() { this.dispatchEvent(makeEvent('select')); }
  submit() { this.dispatchEvent(makeEvent('submit')); }

  // -- layout (NOT implemented — see HONEST LIMITS) -------------------------
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get scrollTop() { return this._scrollTop || 0; }
  set scrollTop(v) { this._scrollTop = v; }
  get scrollHeight() { return 0; }
  scrollIntoView() { this._scrolledIntoView = true; }
  getBoundingClientRectAsync() { return Promise.resolve(this.getBoundingClientRect()); }

  // -- selectors ------------------------------------------------------------
  matches(sel) { return compile(sel).some((m) => m(this, this._doc)); }
  closest(sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { const ms = compile(sel); return this._all().filter((n) => ms.some((m) => m(n, this._doc))); }
}

function makeStyle(el) {
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k === 'getPropertyValue') return (p) => t[p] || '';
      if (k === 'setProperty') return (p, v) => { t[p] = v; };
      if (k === 'removeProperty') return (p) => { delete t[p]; };
      if (k === 'cssText') return el.getAttribute('style') || '';
      return t[k];
    },
    set(t, k, v) {
      if (k === 'cssText') { el.setAttribute('style', String(v)); return true; }
      t[k] = v;
      el.setAttribute('style', Object.entries(t).map(([a, b]) => `${a}:${b}`).join(';'));
      return true;
    },
  });
}

function makeDataset(el) {
  return new Proxy({}, {
    get(_, k) { const v = el.getAttribute('data-' + camelToDash(String(k))); return v === null ? undefined : v; },
    set(_, k, v) { el.setAttribute('data-' + camelToDash(String(k)), String(v)); return true; },
    has(_, k) { return el.hasAttribute('data-' + camelToDash(String(k))); },
  });
}
const camelToDash = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

function makeEvent(type, init) {
  return Object.assign({
    type, bubbles: true, cancelable: true, defaultPrevented: false, _stopped: false,
    target: null, currentTarget: null,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
    stopImmediatePropagation() { this._stopped = true; },
  }, init || {});
}

// ---------------------------------------------------------------------------
// Selector engine (simple but strict)
// ---------------------------------------------------------------------------

const cache = new Map();
const UNSUPPORTED = /[+~]|:nth-|:not\(|:has\(|::/;

/** Compile a selector to an array of matchers. Throws on anything unsupported. */
function compile(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const s = String(sel).trim();
  if (s === '') throw new Error('fakedom: empty selector');
  if (UNSUPPORTED.test(s)) throw new Error('fakedom: unsupported selector "' + s + '"');
  const alternatives = splitTop(s, ',').map((part) => compileChain(part.trim()));
  cache.set(sel, alternatives);
  return alternatives;
}

function splitTop(s, sep) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if ('[('.includes(ch)) depth++;
    if (cr(ch, depth)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function cr(ch, depth) { return (ch === ']' || ch === ')') && depth > 0; }

/** A chain is [compound, combinator, compound, ...] read right-to-left at match time. */
function compileChain(chain) {
  const parts = chain.split(/\s*>\s*|\s+/).filter(Boolean);
  const combinators = [];
  const seq = [];
  const toks = chain.split(/(\s*>\s*|\s+)/).filter((x) => x !== '');
  toks.forEach((t) => (/^\s*>?\s*$/.test(t) ? combinators.push(t.trim() === '>' ? 'child' : 'desc') : seq.push(compileCompound(t))));
  return (el, doc) => {
    if (!seq.length) return false;
    if (!seq[seq.length - 1](el, doc)) return false;
    let node = el;
    for (let i = seq.length - 2; i >= 0; i--) {
      const comb = combinators[i] || 'desc';
      if (comb === 'child') {
        node = node.parentNode;
        if (!node || node.nodeType !== 1 || !seq[i](node, doc)) return false;
      } else {
        let p = node.parentNode;
        while (p && p.nodeType === 1 && !seq[i](p, doc)) p = p.parentNode;
        if (!p || p.nodeType !== 1) return false;
        node = p;
      }
    }
    return true;
  };
}

function compileCompound(tok) {
  const tests = [];
  // TAG/CLASS/ID MUST NOT INCLUDE `:`. The old character class was `[\w:-]+`,
  // which swallowed the colon, so `option:checked` parsed as ONE tag named
  // "OPTION:CHECKED" that could never match anything — and the pseudo-class
  // branch below was never reached. (Namespaced tags like `svg:rect` are not
  // used in this app; a pseudo-class is far more likely and far more damaging to
  // get wrong silently.)
  const re = /([#.]?[\w-]+|\[[^\]]+\]|:[\w-]+)/g;
  let m;
  while ((m = re.exec(tok)) !== null) {
    const t = m[1];
    if (t[0] === '#') { const id = t.slice(1); tests.push((e) => e.id === id); }
    else if (t[0] === '.') { const c = t.slice(1); tests.push((e) => e.classList && e.classList.contains(c)); }
    else if (t[0] === '[') {
      const am = /^\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\s*\]$/.exec(t);
      if (!am) throw new Error('fakedom: bad attribute selector "' + t + '"');
      const [, name, op, dq, sq, bare] = am;
      const want = dq !== undefined ? dq : sq !== undefined ? sq : bare;
      if (!op) tests.push((e) => e.hasAttribute(name));
      else if (op === '=') tests.push((e) => e.getAttribute(name) === want);
      else if (op === '*=') tests.push((e) => String(e.getAttribute(name) || '').includes(want));
      else if (op === '^=') tests.push((e) => String(e.getAttribute(name) || '').startsWith(want));
      else if (op === '$=') tests.push((e) => String(e.getAttribute(name) || '').endsWith(want));
      else if (op === '~=') tests.push((e) => String(e.getAttribute(name) || '').split(/\s+/).includes(want));
    }
    else if (t[0] === ':') {
      const p = t.slice(1);
      if (p === 'checked') {
        // BROWSER PARITY: CSS :checked matches an <option selected> as well as a
        // checked input. Matching only `e.checked` missed every option, so a test
        // asserting "the saved option is selected" reported 0 and looked like an
        // app bug.
        tests.push((e) => (e.tagName === 'OPTION' ? !!(e.selected || e.hasAttribute('selected')) : !!e.checked));
      }
      else if (p === 'disabled') tests.push((e) => !!e.disabled);
      else if (p === 'first-child') tests.push((e) => e.parentNode && e.parentNode.children[0] === e);
      else if (p === 'last-child') tests.push((e) => e.parentNode && e.parentNode.children[e.parentNode.children.length - 1] === e);
      else if (p === 'empty') tests.push((e) => e.children.length === 0);
      else throw new Error('fakedom: unsupported pseudo ":' + p + '"');
    }
    else tests.push((e) => e.tagName === t.toUpperCase());
  }
  if (!tests.length) throw new Error('fakedom: could not parse selector token "' + tok + '"');
  return (e) => tests.every((f) => f(e));
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

class Document extends Node {
  constructor(html) {
    super('#document', null);
    this._doc = this;
    this._byId = new Map();
    this._listeners = new Map();
    this.readyState = 'complete';
    this.hidden = false;
    this.visibilityState = 'visible';
    this.activeElement = null;
    this.title = '';

    const dom = html ? parseHTML(stripToBody(html), this) : new DocFragment(this);
    if (html) {
      dom.children.slice().forEach((c) => this.appendChild(c));
    } else {
      this.appendChild(this.createElement('html'));
    }
    this._reindex();
    this.head = this.querySelector('head') || this.createElement('head');
    this.documentElement = this.querySelector('html') || this.createElement('html');
    this.body = this.querySelector('body') || null;
    if (!this.body) {
      // BROWSER PARITY: a fragment like `<div id="app">` has no <body>, but a real
      // browser still puts it in the body. Leaving it as a sibling of body broke
      // every `document.body.querySelector(...)` and made body-scoped mutations
      // invisible. Adopt any stray element into a fabricated body.
      const body = this.createElement('body');
      const stray = this.children.filter((c) => c.nodeType === 1 && c.tagName !== 'HTML' && c.tagName !== 'HEAD');
      this.appendChild(body);
      stray.forEach((c) => body.appendChild(c));
      this.body = body;
    }
    if (this.documentElement && !this.documentElement.parentNode) this.appendChild(this.documentElement);
    this._reindex();
    this.activeElement = this.body;
  }
  _ensureBody() { const b = this.createElement('body'); this.appendChild(b); return b; }
  createElement(t) {
    if (t === '#fragment') return new DocFragment(this);
    return new Node(String(t).toLowerCase(), this);
  }
  createTextNode(t) { const n = new Node('#text', this); n.nodeType = 3; n._text = String(t); return n; }
  createDocumentFragment() { return new DocFragment(this); }
  _index(el) { if (el.id) this._byId.set(el.id, el); }
  _reindex() { this._byId.clear(); this._all([this]).forEach((n) => this._index(n)); }
  getElementById(id) { return this._byId.get(String(id)) || this._all([this]).find((n) => n.id === String(id)) || null; }
  getElementsByTagName(t) { return Node.prototype._all.call(this, []).filter((n) => n.tagName === String(t).toUpperCase()); }
  getElementsByClassName(c) { return this._all([]).filter((n) => n.classList.contains(c)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const ms = compile(sel);
    const out = this._all([]).filter((n) => ms.some((m) => m(n, this)));
    if (this.body && !out.includes(this.body)) {
      // body matches must be reachable too
      if (ms.some((m) => m(this.body, this))) out.unshift(this.body);
    }
    return out;
  }
  addEventListener(t, f) { if (!this._listeners.has(t)) this._listeners.set(t, []); this._listeners.get(t).push({ fn: f }); }
  removeEventListener(t, f) { const l = this._listeners.get(t); if (l) this._listeners.set(t, l.filter((x) => x.fn !== f)); }
  dispatchEvent(ev) {
    (this._listeners.get(ev.type) || []).slice().forEach(({ fn }) => fn.call(this, ev));
    return !ev.defaultPrevented;
  }
  execCommand() { return true; }
  createEvent() { return makeEvent('custom'); }
}

class DocFragment extends Node {
  constructor(doc) { super('#fragment', doc); this.nodeType = 11; }
}

function stripToBody(html) {
  // Keep head+body; drop the doctype/comments the tokenizer already ignores.
  return html;
}
function escapeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

module.exports = { Document, Node, parseHTML, makeEvent, compile };

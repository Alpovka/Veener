/**
 * The GUEST runtime. This file is bundled to a single script and evaluated INSIDE the QuickJS
 * interpreter, in the worker. Nothing here can touch the page, the network or the worker's own
 * globals: the only way out is `__glue`, a handful of functions the worker installs before this
 * script runs, and which this script captures and then deletes from the global object.
 *
 * It provides:
 *  - Preact exposed as `React` + hooks (generated code is written against React's API);
 *  - MiniDOM: a fake document. It draws nothing; every mutation becomes an "op" the host replays
 *    against the real DOM through an allowlist. Preact only needs a dozen DOM methods, all here.
 *  - shims for what QuickJS lacks and AI-written UI code commonly uses (timers, Intl-ish
 *    formatting, console, crypto.randomUUID, structuredClone);
 *  - the `veneer` capability object (`veneer.data(id)`, `veneer.action(id, args)`), which is the
 *    ONLY thing generated code can use to reach the host, and only for registered ids;
 *  - `__veneer_rt`, the entry points the worker calls (dispatch an event, push data, deliver an
 *    action result, flush ops). Generated code shares this realm and can call them too: that only
 *    lets it poke its own UI, which it can already do.
 */
import { h, render as preactRender, options, Fragment, Component, createContext, cloneElement } from 'preact';
import { useState, useEffect, useMemo, useCallback, useRef, useReducer, useContext, useLayoutEffect, useId } from 'preact/hooks';

const glue = globalThis.__glue;
delete globalThis.__glue;
if (!glue) throw new Error('guest: glue missing');

const post = (msg) => glue.post(JSON.stringify(msg));

// ---------------------------------------------------------------------------------------------
// Shims: the minimum AI-written React code tends to touch.
// ---------------------------------------------------------------------------------------------
const timerFns = new Map();
function setTimeoutShim(fn, ms, ...args) {
  if (typeof fn !== 'function') return 0;
  const id = glue.setTimer(() => {
    timerFns.delete(id);
    fn(...args);
  }, Math.max(0, Number(ms) || 0));
  timerFns.set(id, fn);
  return id;
}
function clearTimeoutShim(id) {
  timerFns.delete(id);
  glue.clearTimer(Number(id) || 0);
}
const intervals = new Map();
function setIntervalShim(fn, ms, ...args) {
  if (typeof fn !== 'function') return 0;
  const key = { id: 0 };
  const period = Math.max(16, Number(ms) || 0);
  const tick = () => {
    if (!intervals.has(key)) return;
    fn(...args);
    if (intervals.has(key)) key.id = glue.setTimer(tick, period);
  };
  key.id = glue.setTimer(tick, period);
  intervals.set(key, true);
  return key;
}
function clearIntervalShim(key) {
  if (key && typeof key === 'object' && intervals.has(key)) {
    intervals.delete(key);
    glue.clearTimer(key.id);
  }
}
globalThis.setTimeout = setTimeoutShim;
globalThis.clearTimeout = clearTimeoutShim;
globalThis.setInterval = setIntervalShim;
globalThis.clearInterval = clearIntervalShim;
globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
globalThis.requestAnimationFrame = (fn) => setTimeoutShim(() => fn(glue.now()), 16);
globalThis.cancelAnimationFrame = clearTimeoutShim;
globalThis.performance = { now: () => glue.now() };
const logTo = (level) => (...a) => glue.log(level, a.map((x) => (typeof x === 'string' ? x : safeStringify(x))).join(' '));
globalThis.console = { log: logTo('log'), info: logTo('log'), debug: logTo('log'), warn: logTo('warn'), error: logTo('error'), table: logTo('log'), group() {}, groupEnd() {} };
function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}
globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
globalThis.crypto = {
  randomUUID() {
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += hex[(Math.random() * 4) | 8];
      else s += hex[(Math.random() * 16) | 0];
    }
    return s;
  },
  getRandomValues(arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
    return arr;
  },
};
// No modal dialogs in a sandbox: the prompt asks the model for inline confirmation UI instead.
globalThis.alert = (m) => glue.log('warn', 'alert() is not available: ' + String(m));
globalThis.confirm = () => false;
globalThis.prompt = () => null;
globalThis.navigator = { language: 'en-US', languages: ['en-US'], userAgent: 'Veneer', onLine: true, clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') } };
// Browser APIs AI-written components reach for without needing them to do anything: observers
// never fire, media queries never match, idle callbacks run as timers. Present so code does not
// crash on `new ResizeObserver(...)`; inert so nothing can be measured or observed.
class InertObserver {
  constructor(cb) {
    this._cb = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver = InertObserver;
globalThis.IntersectionObserver = InertObserver;
globalThis.MutationObserver = InertObserver;
globalThis.matchMedia = (q) => ({ matches: false, media: String(q || ''), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
globalThis.requestIdleCallback = (fn) => setTimeoutShim(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1);
globalThis.cancelIdleCallback = clearTimeoutShim;
globalThis.getComputedStyle = (el) => ({ getPropertyValue: (p) => (el && el.style && typeof el.style.getPropertyValue === 'function' ? el.style.getPropertyValue(p) : ''), ...((el && el._styleStore) || {}) });
globalThis.Event = class Event {
  constructor(type, init) {
    this.type = String(type);
    this.bubbles = !!(init && init.bubbles);
    this.defaultPrevented = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {}
};
globalThis.CustomEvent = class CustomEvent extends globalThis.Event {
  constructor(type, init) {
    super(type, init);
    this.detail = init ? init.detail : undefined;
  }
};

// Minimal Intl: enough for the formatting AI code reaches for. Not locale-aware beyond en-US.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function group(n, minFrac, maxFrac) {
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(Math.max(minFrac, Math.min(maxFrac, decimalsOf(n, maxFrac))));
  const [int, frac] = fixed.split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + g + (frac ? '.' + frac : '');
}
function decimalsOf(n, max) {
  const s = String(n);
  const i = s.indexOf('.');
  return i === -1 ? 0 : Math.min(max, s.length - i - 1);
}
const CURRENCY = { USD: '$', EUR: '€', GBP: '£', TRY: '₺', JPY: '¥', INR: '₹' };
class NumberFormat {
  constructor(_locale, opts = {}) {
    this.o = opts || {};
  }
  format(n) {
    n = Number(n);
    if (!isFinite(n)) return String(n);
    const o = this.o;
    if (o.style === 'percent') return group(n * 100, o.minimumFractionDigits || 0, o.maximumFractionDigits == null ? 0 : o.maximumFractionDigits) + '%';
    const minF = o.minimumFractionDigits != null ? o.minimumFractionDigits : o.style === 'currency' ? 2 : 0;
    const maxF = o.maximumFractionDigits != null ? o.maximumFractionDigits : o.style === 'currency' ? 2 : 3;
    const body = group(n, minF, maxF);
    if (o.style === 'currency') {
      const sym = CURRENCY[o.currency] || (o.currency ? o.currency + ' ' : '$');
      return body.startsWith('-') ? '-' + sym + body.slice(1) : sym + body;
    }
    return body;
  }
  formatToParts(n) {
    return [{ type: 'literal', value: this.format(n) }];
  }
  resolvedOptions() {
    return { locale: 'en-US', ...this.o };
  }
}
function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmtDate(d, o = {}) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return 'Invalid Date';
  const dateStyle = o.dateStyle;
  const hasTime = o.hour || o.minute || o.timeStyle;
  const hasDate = o.year || o.month || o.day || o.weekday || dateStyle || !hasTime;
  let out = '';
  if (hasDate) {
    const month = o.month || (dateStyle === 'long' || dateStyle === 'full' ? 'long' : dateStyle === 'medium' ? 'short' : 'numeric');
    const day = o.day || 'numeric';
    const year = o.year || (dateStyle === 'short' ? '2-digit' : 'numeric');
    const wd = o.weekday || (dateStyle === 'full' ? 'long' : null);
    const m = month === 'long' ? MONTHS[d.getMonth()] : month === 'short' ? MONTHS[d.getMonth()].slice(0, 3) : month === '2-digit' ? pad2(d.getMonth() + 1) : String(d.getMonth() + 1);
    const dd = day === '2-digit' ? pad2(d.getDate()) : String(d.getDate());
    const yy = year === '2-digit' ? String(d.getFullYear()).slice(-2) : String(d.getFullYear());
    if (month === 'numeric' || month === '2-digit') out = o.year === undefined && !dateStyle && o.day === undefined && o.month === undefined ? `${m}/${dd}/${yy}` : [o.month || dateStyle ? m : null, o.day || dateStyle || (!o.month && !o.year) ? dd : null].filter(Boolean).join('/') + (o.year || dateStyle || (!o.month && !o.day) ? '/' + yy : '');
    else out = `${m} ${dd}` + (o.year || dateStyle || (!o.month && !o.day) ? `, ${yy}` : '');
    if (o.month && !o.day && !o.year) out = m;
    if (o.year && !o.month && !o.day) out = yy;
    if (wd) out = (wd === 'long' ? DAYS[d.getDay()] : DAYS[d.getDay()].slice(0, 3)) + (out ? ', ' + out : '');
  }
  if (hasTime) {
    const h24 = d.getHours();
    const h12 = o.hour12 === false ? h24 : h24 % 12 || 12;
    const t = `${o.hour12 === false ? pad2(h24) : h12}:${pad2(d.getMinutes())}` + (o.second || o.timeStyle === 'medium' ? ':' + pad2(d.getSeconds()) : '') + (o.hour12 === false ? '' : h24 < 12 ? ' AM' : ' PM');
    out = out ? out + ', ' + t : t;
  }
  return out;
}
class DateTimeFormat {
  constructor(_locale, opts = {}) {
    this.o = opts || {};
  }
  format(d) {
    return fmtDate(d instanceof Date ? d : new Date(d), this.o);
  }
  formatToParts(d) {
    return [{ type: 'literal', value: this.format(d) }];
  }
  resolvedOptions() {
    return { locale: 'en-US', timeZone: 'UTC', ...this.o };
  }
}
class RelativeTimeFormat {
  constructor() {}
  format(v, unit) {
    const n = Math.round(Math.abs(v));
    const u = String(unit).replace(/s$/, '') + (n === 1 ? '' : 's');
    return v < 0 ? `${n} ${u} ago` : `in ${n} ${u}`;
  }
}
class PluralRules {
  select(n) {
    return Number(n) === 1 ? 'one' : 'other';
  }
}
class Collator {
  compare(a, b) {
    return String(a).localeCompare(String(b));
  }
}
class ListFormat {
  format(list) {
    const a = Array.from(list).map(String);
    return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
}
globalThis.Intl = { NumberFormat, DateTimeFormat, RelativeTimeFormat, PluralRules, Collator, ListFormat };
Date.prototype.toLocaleDateString = function (_l, o) {
  return fmtDate(this, { ...(o || {}), hour: undefined, minute: undefined, timeStyle: undefined });
};
Date.prototype.toLocaleTimeString = function (_l, o) {
  return fmtDate(this, { hour: 'numeric', minute: '2-digit', ...(o || {}), year: undefined, month: undefined, day: undefined, dateStyle: undefined });
};
Date.prototype.toLocaleString = function (_l, o) {
  return fmtDate(this, o && Object.keys(o).length ? o : { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
Number.prototype.toLocaleString = function (_l, o) {
  return new NumberFormat('en-US', o).format(this);
};

// ---------------------------------------------------------------------------------------------
// MiniDOM: records ops. The host is the only thing that ever draws.
// ---------------------------------------------------------------------------------------------
let ops = [];
let nextId = 1;
const byId = new Map();
const SVG_NS = 'http://www.w3.org/2000/svg';
// Preact resolves event names with `('on' + name) in dom`; expose the ones we forward.
const EVENT_PROPS = ['click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'keyup', 'keypress', 'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'pointerenter', 'pointerleave', 'dragstart', 'dragover', 'dragenter', 'dragleave', 'drop', 'dragend', 'touchstart', 'touchend', 'wheel', 'scroll', 'contextmenu', 'toggle'];

class MiniNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
    this.id = nextId++;
    byId.set(this.id, this);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const c = this.parentNode.childNodes;
    return c[c.indexOf(this) + 1] || null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const c = this.parentNode.childNodes;
    return c[c.indexOf(this) - 1] || null;
  }
  get parentElement() {
    return this.parentNode;
  }
  get ownerDocument() {
    return document;
  }
  get isConnected() {
    let n = this;
    while (n) {
      if (n === root) return true;
      n = n.parentNode;
    }
    return false;
  }
  insertBefore(n, ref) {
    if (!(n instanceof MiniNode)) throw new TypeError('insertBefore: not a node');
    // A node that already has a parent is being MOVED (Preact reorders keyed lists this way).
    // Keep its subtree and tell the host to move it, instead of remove + recreate.
    const moving = !!n.parentNode;
    if (moving) {
      const old = n.parentNode.childNodes;
      old.splice(old.indexOf(n), 1);
      n.parentNode = null;
    }
    const c = this.childNodes;
    const i = ref ? c.indexOf(ref) : c.length;
    const at = i < 0 ? c.length : i;
    c.splice(at, 0, n);
    n.parentNode = this;
    if (moving) {
      ops.push({ t: 'mv', id: n.id, p: this.id, i: at });
      return n;
    }
    const op = { t: 'ins', id: n.id, p: this.id, i: at };
    if (n.nodeType === 1) {
      op.tag = n.localName;
      if (n.namespaceURI === SVG_NS) op.ns = 'svg';
    } else op.text = n.data;
    ops.push(op);
    return n;
  }
  appendChild(n) {
    return this.insertBefore(n, null);
  }
  removeChild(n) {
    const c = this.childNodes;
    const i = c.indexOf(n);
    if (i === -1) throw new Error('removeChild: not a child');
    c.splice(i, 1);
    n.parentNode = null;
    ops.push({ t: 'rm', id: n.id });
    forget(n);
    return n;
  }
  replaceChild(n, old) {
    this.insertBefore(n, old);
    this.removeChild(old);
    return old;
  }
  contains(n) {
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  hasChildNodes() {
    return this.childNodes.length > 0;
  }
  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== '' && v != null) this.appendChild(new MiniText(String(v)));
  }
}
function forget(n) {
  byId.delete(n.id);
  for (const c of n.childNodes) forget(c);
}
class MiniText extends MiniNode {
  constructor(d) {
    super(3);
    this._data = String(d);
    this.nodeName = '#text';
  }
  get data() {
    return this._data;
  }
  set data(v) {
    v = String(v);
    if (v === this._data) return;
    this._data = v;
    ops.push({ t: 'txt', id: this.id, text: v });
  }
  get nodeValue() {
    return this._data;
  }
  set nodeValue(v) {
    this.data = v;
  }
  get length() {
    return this._data.length;
  }
}
function camelToKebab(s) {
  return s.startsWith('--') ? s : s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}
class MiniElement extends MiniNode {
  constructor(tag, ns) {
    super(1);
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeName = this.tagName;
    this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this.attributes = {};
    this._listeners = {}; // Preact's own map of user handlers (`name + useCapture` keys)
    this._guestHandlers = {}; // our map of Preact's proxies, by DOM event name
    this._props = {};
    this._styleStore = {};
    for (const e of EVENT_PROPS) this['on' + e] = null;
    const el = this;
    const store = this._styleStore;
    this.style = new Proxy(store, {
      set(o, k, v) {
        if (k === 'cssText') {
          for (const key of Object.keys(o)) {
            delete o[key];
            ops.push({ t: 'style', id: el.id, n: key, v: '' });
          }
          String(v)
            .split(';')
            .forEach((decl) => {
              const idx = decl.indexOf(':');
              if (idx === -1) return;
              const prop = decl.slice(0, idx).trim();
              const val = decl.slice(idx + 1).trim();
              if (!prop) return;
              o[prop] = val;
              ops.push({ t: 'style', id: el.id, n: prop, v: val });
            });
          return true;
        }
        const val = v == null || v === false ? '' : String(v);
        o[k] = val;
        ops.push({ t: 'style', id: el.id, n: String(k), v: val });
        return true;
      },
      get(o, k) {
        if (k === 'setProperty') return (p, v) => {
          const val = v == null ? '' : String(v);
          o[p] = val;
          ops.push({ t: 'style', id: el.id, n: String(p), v: val });
        };
        if (k === 'removeProperty') return (p) => {
          delete o[p];
          ops.push({ t: 'style', id: el.id, n: String(p), v: '' });
        };
        if (k === 'getPropertyValue') return (p) => o[p] || o[camelToKebab(String(p))] || '';
        if (k === 'cssText') return Object.keys(o).map((p) => `${camelToKebab(p)}: ${o[p]}`).join('; ');
        return o[k];
      },
    });
  }
  setAttribute(k, v) {
    k = String(k);
    const val = v == null ? '' : String(v);
    this.attributes[k] = val;
    ops.push({ t: 'attr', id: this.id, n: k, v: val });
  }
  setAttributeNS(_ns, k, v) {
    this.setAttribute(k, v);
  }
  removeAttribute(k) {
    k = String(k);
    if (!(k in this.attributes)) return;
    delete this.attributes[k];
    ops.push({ t: 'attr', id: this.id, n: k, v: null });
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  hasAttribute(k) {
    return k in this.attributes;
  }
  // Preact derives the event name from the prop (`onClick` → `click`) only when `'onclick' in dom`;
  // anything else keeps React's casing (`onDoubleClick` → `DoubleClick`). Normalise to DOM names so
  // React-flavoured code Just Works, like preact/compat does.
  addEventListener(name, fn) {
    name = normEvent(name);
    this._guestHandlers[name] = fn;
    ops.push({ t: 'on', id: this.id, n: name, on: true });
  }
  removeEventListener(name) {
    name = normEvent(name);
    if (!(name in this._guestHandlers)) return;
    delete this._guestHandlers[name];
    ops.push({ t: 'on', id: this.id, n: name, on: false });
  }
  get className() {
    return this.attributes.class || '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get classList() {
    const el = this;
    return {
      add: (...c) => el.setAttribute('class', [...new Set(el.className.split(/\s+/).filter(Boolean).concat(c))].join(' ')),
      remove: (...c) => el.setAttribute('class', el.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' ')),
      contains: (c) => el.className.split(/\s+/).includes(c),
      toggle: (c) => (el.classList.contains(c) ? el.classList.remove(c) : el.classList.add(c)),
    };
  }
  get id() {
    return this._id;
  }
  set id(v) {
    // `id` is the internal node id; DOM ids go through setAttribute so the host can namespace them.
    if (this._id === undefined) this._id = v;
    else this.setAttribute('id', v);
  }
  // Preact sets these as properties (`name in dom`), not attributes: mirror them as `prop` ops so
  // the host can update live form controls.
  get value() {
    return this._props.value !== undefined ? this._props.value : this.attributes.value || '';
  }
  set value(v) {
    this._props.value = v == null ? '' : String(v);
    ops.push({ t: 'prop', id: this.id, n: 'value', v: this._props.value });
  }
  get checked() {
    return !!this._props.checked;
  }
  set checked(v) {
    this._props.checked = !!v;
    ops.push({ t: 'prop', id: this.id, n: 'checked', v: !!v });
  }
  get selected() {
    return !!this._props.selected;
  }
  set selected(v) {
    this._props.selected = !!v;
    ops.push({ t: 'prop', id: this.id, n: 'selected', v: !!v });
  }
  set innerHTML(_v) {
    // Never: the host allowlist has no way to render raw HTML safely, and the scanner already
    // refuses dangerouslySetInnerHTML. Ignoring keeps a stray use from crashing the whole view.
    glue.log('warn', 'innerHTML is not supported in the sandbox');
  }
  get innerHTML() {
    return '';
  }
  focus() {
    document.activeElement = this;
    ops.push({ t: 'focus', id: this.id });
  }
  blur() {
    if (document.activeElement === this) document.activeElement = null;
  }
  click() {
    const fn = this._guestHandlers.click;
    if (fn) fn.call(this, makeEvent(this, 'click', {}));
  }
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  select() {}
  setSelectionRange() {}
  matches() {
    return false;
  }
  closest() {
    return null;
  }
  getAttributeNames() {
    return Object.keys(this.attributes);
  }
  dispatchEvent(ev) {
    const fn = ev && this._guestHandlers[normEvent(ev.type)];
    if (fn) fn.call(this, ev);
    return true;
  }
  get scrollTop() {
    return 0;
  }
  set scrollTop(_v) {}
  get scrollLeft() {
    return 0;
  }
  set scrollLeft(_v) {}
  get scrollHeight() {
    return 0;
  }
  get scrollWidth() {
    return 0;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  get offsetWidth() {
    return 0;
  }
  get offsetHeight() {
    return 0;
  }
  get clientWidth() {
    return 0;
  }
  get clientHeight() {
    return 0;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  get dataset() {
    const el = this;
    return new Proxy(
      {},
      {
        get: (_o, k) => el.attributes['data-' + camelToKebab(String(k))],
        set: (_o, k, v) => (el.setAttribute('data-' + camelToKebab(String(k)), v), true),
      }
    );
  }
}
function normEvent(name) {
  name = String(name).toLowerCase();
  if (name === 'doubleclick') return 'dblclick';
  return name;
}

const document = {
  createElement: (t) => new MiniElement(t),
  createElementNS: (ns, t) => new MiniElement(t, ns === SVG_NS ? SVG_NS : undefined),
  createTextNode: (d) => new MiniText(d),
  createComment: () => new MiniText(''),
  createDocumentFragment: () => new MiniElement('#fragment'),
  get body() {
    return root;
  },
  get documentElement() {
    return root;
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
};
const root = new MiniElement('#root');
globalThis.document = document;
// `instanceof` checks in AI-written code (`el instanceof HTMLElement`) resolve against the MiniDOM.
globalThis.Node = MiniNode;
globalThis.Element = MiniElement;
globalThis.HTMLElement = MiniElement;
globalThis.HTMLInputElement = MiniElement;
globalThis.SVGElement = MiniElement;
globalThis.Text = MiniText;

// Preact scheduling on top of the glue timers; rendering is debounced to a microtask so it happens
// inside the same VM entry that caused it and the worker flushes one batch of ops.
options.requestAnimationFrame = (cb) => setTimeoutShim(cb, 0);
options.debounceRendering = (cb) => Promise.resolve().then(cb);

// ---------------------------------------------------------------------------------------------
// State carry-over. Every new UI runs in a fresh interpreter, which would throw away whatever the
// user was doing (half-typed text, an expanded row) on every small edit. So `useState` is wrapped:
// each call gets a stable key — component name, vnode key, hook index — and records its latest
// value. Before the old interpreter is terminated the host asks for a snapshot of those values,
// and hands it to the next one, whose `useState` uses the carried value as the initial value when
// the key exists and the type matches. An edit that changes hook order simply falls back to the
// code's own initial values for the shifted hooks. Only JSON-safe values travel.
// ---------------------------------------------------------------------------------------------
let restoreMap = {};
const liveState = new Map();
let curName = '';
let curKey = '';
let hookIdx = 0;
const prevBeforeRender = options.__r;
options.__r = (vnode) => {
  if (prevBeforeRender) prevBeforeRender(vnode);
  const t = vnode && vnode.type;
  curName = (t && (t.displayName || t.name)) || 'anon';
  curKey = vnode && vnode.key != null ? '@' + String(vnode.key) : '';
  hookIdx = 0;
};
function useStateCarried(init) {
  const key = curName + curKey + '#' + hookIdx++;
  // React semantics: a lazy initialiser runs exactly once, on mount. Running it here (instead of
  // inside useState) costs nothing extra and lets the carried value be type-checked against it.
  const base = typeof init === 'function' ? init() : init;
  let initial = base;
  if (Object.prototype.hasOwnProperty.call(restoreMap, key)) {
    const carried = restoreMap[key];
    if (base === undefined || base === null || carried === null || typeof carried === typeof base) initial = carried;
  }
  const pair = useState(() => initial);
  liveState.set(key, pair[0]);
  return pair;
}
function snapshotState() {
  const out = {};
  let size = 0;
  for (const [k, v] of liveState) {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    try {
      const s = JSON.stringify(v);
      if (s === undefined) continue;
      size += s.length;
      if (size > 200000) break;
      out[k] = JSON.parse(s);
    } catch (e) {
      /* cyclic or unserialisable: skip */
    }
  }
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------------------------
// Event dispatch (host → guest). The host sends a plain JSON payload; we build a synthetic event.
// ---------------------------------------------------------------------------------------------
const dragStore = new Map();
const dataTransfer = {
  setData: (k, v) => dragStore.set(String(k), String(v)),
  getData: (k) => dragStore.get(String(k)) || '',
  clearData: () => dragStore.clear(),
  effectAllowed: 'all',
  dropEffect: 'move',
  types: [],
  files: [],
  setDragImage() {},
};
function makeEvent(el, name, p) {
  p = p || {};
  if (p.value !== undefined) el._props.value = String(p.value);
  if (p.checked !== undefined) el._props.checked = !!p.checked;
  const ev = {
    type: name,
    target: el,
    currentTarget: el,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    timeStamp: glue.now(),
    isTrusted: true,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
    key: p.key,
    code: p.code,
    keyCode: p.keyCode,
    which: p.keyCode,
    shiftKey: !!p.shiftKey,
    ctrlKey: !!p.ctrlKey,
    metaKey: !!p.metaKey,
    altKey: !!p.altKey,
    repeat: !!p.repeat,
    clientX: p.clientX || 0,
    clientY: p.clientY || 0,
    pageX: p.clientX || 0,
    pageY: p.clientY || 0,
    button: p.button || 0,
    buttons: p.buttons || 0,
    detail: p.detail || 0,
    deltaY: p.deltaY || 0,
    deltaX: p.deltaX || 0,
    dataTransfer,
    nativeEvent: null,
    persist() {},
  };
  ev.nativeEvent = ev;
  return ev;
}
function dispatch(id, name, payload) {
  const el = byId.get(Number(id));
  if (!el || el.nodeType !== 1) return false;
  if (name === 'dragstart') dragStore.clear();
  // React semantics: `onChange` on text controls fires per keystroke. The host sends `input`;
  // fall through to a `change` listener when there is no `input` one (what preact/compat does).
  // Preact's proxy looks the user handler up by `event.type`, so the synthetic event must carry
  // the name the handler was registered under.
  let reg = name;
  let fn = el._guestHandlers[name];
  if (!fn && name === 'input' && el._guestHandlers.change) {
    reg = 'change';
    fn = el._guestHandlers.change;
  }
  if (!fn) {
    // still let value/checked land so later reads are consistent
    if (payload && (payload.value !== undefined || payload.checked !== undefined)) makeEvent(el, name, payload);
    return false;
  }
  const ev = makeEvent(el, reg, payload);
  fn.call(el, ev);
  return ev.defaultPrevented;
}

// ---------------------------------------------------------------------------------------------
// The capability surface: veneer.data / veneer.action
// ---------------------------------------------------------------------------------------------
let dataCache = {};
let actionIds = [];
let dataIds = [];
let actionTimeoutMs = 30000;
const pending = new Map();
let callSeq = 0;
const MAX_PENDING = 64;
const dataListeners = new Set();

const veneer = Object.freeze({
  action(id, args) {
    return new Promise((resolve, reject) => {
      if (!actionIds.includes(id)) return reject(new Error('Action "' + String(id) + '" is not registered.'));
      if (pending.size >= MAX_PENDING) return reject(new Error('Too many pending actions.'));
      const callId = ++callSeq;
      const timer = setTimeoutShim(() => {
        if (pending.has(callId)) {
          pending.delete(callId);
          reject(new Error('Action "' + id + '" timed out.'));
        }
      }, actionTimeoutMs);
      pending.set(callId, { resolve, reject, timer });
      let safeArgs = {};
      try {
        safeArgs = args === undefined ? {} : JSON.parse(JSON.stringify(args));
      } catch (e) {
        pending.delete(callId);
        clearTimeoutShim(timer);
        return reject(new Error('Action arguments must be JSON-serializable.'));
      }
      post({ type: 'action', callId, action: String(id), args: safeArgs });
    });
  },
  data(sourceId) {
    if (!dataIds.includes(sourceId)) throw new Error('Data source "' + String(sourceId) + '" is not registered.');
    return dataCache[sourceId] !== undefined ? dataCache[sourceId] : [];
  },
});

// ---------------------------------------------------------------------------------------------
// React surface for generated code
// ---------------------------------------------------------------------------------------------
class ErrorBoundary extends Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    post({ type: 'error', kind: 'render', message: String((err && err.message) || err) });
  }
  render() {
    if (this.state.err) {
      return h('div', { className: 'p-6 text-sm text-muted', style: { padding: '24px', fontFamily: 'ui-sans-serif, system-ui' } }, "Couldn't render this view. Try asking again.");
    }
    return this.props.children;
  }
}
function VeneerRoot(props) {
  const [, force] = useState(0);
  // Layout effect, not effect: Preact defers `useEffect` to a requestAnimationFrame timer, and a
  // data push arriving before that timer fires would otherwise be missed. This subscribes
  // synchronously at commit.
  useLayoutEffect(() => {
    const fn = () => force((x) => x + 1);
    dataListeners.add(fn);
    return () => dataListeners.delete(fn);
  }, []);
  // A fresh vnode each time: Preact skips diffing an identical child reference, which would keep
  // the generated component from re-running (and re-reading veneer.data) after a data push.
  const el = props.el;
  const child = el && typeof el === 'object' && 'type' in el ? cloneElement(el) : el;
  return h(ErrorBoundary, null, child);
}
let mounted = false;
function renderRoot(el) {
  mounted = true;
  preactRender(h(VeneerRoot, { el }), root);
}

const React = {
  createElement: h,
  Fragment,
  Component,
  createContext,
  useState: useStateCarried,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  useContext,
  useLayoutEffect,
  useId,
  memo: (c) => c,
  forwardRef: (c) => c,
  Children: { map: (c, f) => (Array.isArray(c) ? c : c == null ? [] : [c]).map(f), toArray: (c) => (Array.isArray(c) ? c : c == null ? [] : [c]), count: (c) => (Array.isArray(c) ? c.length : c == null ? 0 : 1) },
  isValidElement: (v) => !!v && typeof v === 'object' && 'type' in v && 'props' in v,
  version: '18.0.0-veneer',
};
const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: false, configurable: false, enumerable: true });
define('React', Object.freeze(React));
for (const k of ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer', 'useContext', 'useLayoutEffect', 'useId', 'Fragment']) define(k, React[k]);
define('veneer', veneer);
define('render', (el) => renderRoot(el));

// ---------------------------------------------------------------------------------------------
// Entry points for the worker
// ---------------------------------------------------------------------------------------------
define(
  '__veneer_rt',
  Object.freeze({
    configure(json) {
      const c = JSON.parse(json);
      actionIds = Array.isArray(c.actionIds) ? c.actionIds.map(String) : [];
      dataIds = Array.isArray(c.dataIds) ? c.dataIds.map(String) : [];
      actionTimeoutMs = Number(c.actionTimeoutMs) || 30000;
      dataCache = c.data && typeof c.data === 'object' ? c.data : {};
      restoreMap = c.restore && typeof c.restore === 'object' && !Array.isArray(c.restore) ? c.restore : {};
    },
    /** JSON of every live `useState` value, keyed for the next interpreter (see useStateCarried). */
    snapshot() {
      return snapshotState();
    },
    setData(json) {
      dataCache = JSON.parse(json) || {};
      for (const fn of dataListeners) fn();
    },
    dispatch(id, name, json) {
      return dispatch(id, String(name), json ? JSON.parse(json) : {});
    },
    actionResult(callId, ok, json) {
      const p = pending.get(Number(callId));
      if (!p) return;
      pending.delete(Number(callId));
      clearTimeoutShim(p.timer);
      const v = json ? JSON.parse(json) : undefined;
      if (ok) p.resolve(v);
      else p.reject(new Error(typeof v === 'string' ? v : 'action failed'));
    },
    flushOps() {
      const out = JSON.stringify({ root: root.id, ops });
      ops = [];
      return out;
    },
    mounted() {
      return mounted;
    },
    fallback(message) {
      preactRender(h('div', { style: { padding: '24px', color: '#64748b', fontFamily: 'ui-sans-serif, system-ui', fontSize: '14px' } }, message || "Couldn't render this view. Try asking again."), root);
    },
  })
);

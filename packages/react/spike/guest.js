// Guest runtime bundled INTO the interpreter for the spike: Preact + a minimal fake DOM that
// records ops. Kept tiny on purpose; M1 replaces it with the real MiniDOM.
import { h, render, options, Fragment } from 'preact';
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';

const ops = [];
let nextId = 1;
class Node {
  constructor(type) { this.nodeType = type; this.parentNode = null; this.childNodes = []; this.id = nextId++; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { if (!this.parentNode) return null; const c = this.parentNode.childNodes; return c[c.indexOf(this) + 1] || null; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const c = this.childNodes; const i = ref ? c.indexOf(ref) : c.length; c.splice(i, 0, n); n.parentNode = this;
    ops.push({ t: 'ins', id: n.id, parent: this.id, index: i, tag: n.localName, text: n.data });
    return n;
  }
  appendChild(n) { return this.insertBefore(n, null); }
  removeChild(n) { const c = this.childNodes; c.splice(c.indexOf(n), 1); n.parentNode = null; ops.push({ t: 'rm', id: n.id }); return n; }
}
class Text extends Node {
  constructor(d) { super(3); this._data = d; }
  get data() { return this._data; }
  set data(v) { this._data = String(v); ops.push({ t: 'txt', id: this.id, text: this._data }); }
  get nodeValue() { return this._data; } set nodeValue(v) { this.data = v; }
}
// Preact picks the event name via `('on' + name).toLowerCase() in dom`; expose known event props.
const EVENT_PROPS = ['click','dblclick','input','change','submit','keydown','keyup','focus','blur','mouseenter','mouseleave','pointerdown','pointerup','dragstart','dragover','drop','dragend','scroll'];
class Element extends Node {
  constructor(tag) {
    super(1); this.localName = tag; this.attributes = {}; this.listeners = {};
    for (const e of EVENT_PROPS) this['on' + e] = null;
    const el = this;
    this.style = new Proxy({}, { set(o, k, v) { o[k] = v; ops.push({ t: 'style', id: el.id, prop: k, value: v }); return true; },
      get(o, k) { if (k === 'setProperty') return (k2, v) => { o[k2] = v; ops.push({ t: 'style', id: el.id, prop: k2, value: v }); }; return o[k]; } });
  }
  setAttribute(k, v) { this.attributes[k] = String(v); ops.push({ t: 'attr', id: this.id, name: k, value: String(v) }); }
  removeAttribute(k) { delete this.attributes[k]; ops.push({ t: 'attr', id: this.id, name: k, value: null }); }
  addEventListener(name, fn) { this.listeners[name] = fn; ops.push({ t: 'on', id: this.id, name, on: true }); }
  removeEventListener(name) { delete this.listeners[name]; ops.push({ t: 'on', id: this.id, name, on: false }); }
  set className(v) { this.setAttribute('class', v); } get className() { return this.attributes.class || ''; }
  set textContent(v) { for (const c of [...this.childNodes]) this.removeChild(c); if (v !== '') this.appendChild(new Text(String(v))); }
}
const document = { createElement: (t) => new Element(t), createElementNS: (_, t) => new Element(t), createTextNode: (d) => new Text(d) };
const root = new Element('root');
globalThis.document = document;
// Preact scheduling: no real rAF/setTimeout in QuickJS; glue supplies __timers.
options.requestAnimationFrame = (cb) => globalThis.setTimeout(cb, 0);
options.debounceRendering = (cb) => Promise.resolve().then(cb);

const React = { createElement: h, Fragment, useState, useEffect, useMemo, useCallback, useRef };
globalThis.React = React; globalThis.useState = useState; globalThis.useEffect = useEffect; globalThis.useMemo = useMemo; globalThis.useCallback = useCallback; globalThis.useRef = useRef;
globalThis.render = (el) => render(el, root);
globalThis.__flushOps = () => { const out = JSON.stringify(ops); ops.length = 0; return out; };
globalThis.__dispatch = (id, name, detail) => {
  const find = (n) => n.id === id ? n : n.childNodes.map(find).find(Boolean);
  const el = find(root); if (!el || !el.listeners[name]) return false;
  el.listeners[name].call(el, { type: name, target: { value: detail && detail.value }, preventDefault() {} }); return true;
};

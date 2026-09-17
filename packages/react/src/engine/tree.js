/**
 * The host-side mirror of the guest's MiniDOM: a map of nodes rebuilt from ops. Preact commits
 * children before parents and may emit an attribute/listener op for a node before its `ins`, so
 * every op may reference a node that does not exist yet; placeholders are created on demand.
 */
import { CAPS } from './sanitize.js';

export function createTree() {
  const nodes = new Map();
  let root = null;
  let count = 0;
  const focusQueue = [];

  function ensure(id) {
    let n = nodes.get(id);
    if (!n) {
      n = { id, tag: null, ns: undefined, text: undefined, attrs: {}, style: {}, props: {}, listeners: new Set(), children: [], parent: null };
      nodes.set(id, n);
      count++;
    }
    return n;
  }
  function detach(n) {
    if (n.parent == null) return;
    const p = nodes.get(n.parent);
    if (p) {
      const i = p.children.indexOf(n.id);
      if (i !== -1) p.children.splice(i, 1);
    }
    n.parent = null;
  }
  function attach(n, pid, index) {
    const p = ensure(pid);
    const at = Math.max(0, Math.min(p.children.length, Number(index) || 0));
    p.children.splice(at, 0, n.id);
    n.parent = pid;
  }
  function forget(n) {
    nodes.delete(n.id);
    count--;
    for (const cid of n.children) {
      const c = nodes.get(cid);
      if (c) forget(c);
    }
  }

  /** Apply one batch. Returns { ok: true } or { error } for a structural violation (flood, garbage). */
  function apply(batch) {
    if (!batch || !Array.isArray(batch.ops)) return { error: 'bad batch' };
    if (typeof batch.root === 'number') root = batch.root;
    for (const op of batch.ops) {
      if (!op || typeof op.id !== 'number') return { error: 'bad op' };
      switch (op.t) {
        case 'ins': {
          const n = ensure(op.id);
          if (typeof op.text === 'string') n.text = op.text.slice(0, CAPS.maxTextChars);
          else if (typeof op.tag === 'string') {
            n.tag = op.tag.toLowerCase();
            n.ns = op.ns === 'svg' ? 'svg' : undefined;
          } else return { error: 'ins without tag or text' };
          if (typeof op.p !== 'number') return { error: 'ins without parent' };
          detach(n);
          attach(n, op.p, op.i);
          break;
        }
        case 'mv': {
          const n = nodes.get(op.id);
          if (!n || typeof op.p !== 'number') break;
          detach(n);
          attach(n, op.p, op.i);
          break;
        }
        case 'rm': {
          const n = nodes.get(op.id);
          if (!n) break;
          detach(n);
          forget(n);
          break;
        }
        case 'txt': {
          const n = ensure(op.id);
          n.text = typeof op.text === 'string' ? op.text.slice(0, CAPS.maxTextChars) : '';
          break;
        }
        case 'attr': {
          const n = ensure(op.id);
          if (typeof op.n !== 'string') break;
          if (op.v == null) delete n.attrs[op.n];
          else if (Object.keys(n.attrs).length < CAPS.maxAttrs || op.n in n.attrs) n.attrs[op.n] = String(op.v);
          break;
        }
        case 'style': {
          const n = ensure(op.id);
          if (typeof op.n !== 'string') break;
          if (op.v == null || op.v === '') delete n.style[op.n];
          else if (Object.keys(n.style).length < CAPS.maxStyleProps || op.n in n.style) n.style[op.n] = String(op.v);
          break;
        }
        case 'on': {
          const n = ensure(op.id);
          if (typeof op.n !== 'string') break;
          if (op.on) n.listeners.add(op.n);
          else n.listeners.delete(op.n);
          break;
        }
        case 'prop': {
          const n = ensure(op.id);
          if (op.n === 'value') n.props.value = String(op.v == null ? '' : op.v);
          else if (op.n === 'checked' || op.n === 'selected') n.props[op.n] = !!op.v;
          break;
        }
        case 'focus':
          focusQueue.push(op.id);
          break;
        default:
          return { error: 'unknown op ' + String(op.t) };
      }
      if (count > CAPS.maxNodes) return { error: 'too many nodes (' + count + ')', flood: true };
    }
    return { ok: true };
  }

  return {
    nodes,
    apply,
    get root() {
      return root;
    },
    get size() {
      return count;
    },
    takeFocus() {
      return focusQueue.splice(0);
    },
  };
}

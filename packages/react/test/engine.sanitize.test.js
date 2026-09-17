import { describe, it, expect } from 'vitest';
import { sanitizeTag, sanitizeAttrs, sanitizeClass, sanitizeStyle, eventPayload, isTextControl } from '../src/engine/sanitize.js';
import { createTree } from '../src/engine/tree.js';

describe('host allowlist (wall 2)', () => {
  it('renders layout, text, form and table elements; drops anything that can load a URL; demotes links', () => {
    for (const ok of ['div', 'span', 'button', 'input', 'table', 'td', 'ul', 'li', 'h1', 'form', 'select', 'option', 'textarea', 'details', 'progress']) expect(sanitizeTag(ok)).toEqual({ tag: ok });
    for (const drop of ['img', 'iframe', 'script', 'style', 'link', 'meta', 'video', 'audio', 'embed', 'object', 'base', 'template', 'canvas']) expect(sanitizeTag(drop)).toEqual({ drop: true });
    expect(sanitizeTag('a')).toEqual({ demote: 'span' });
    expect(sanitizeTag('dialog')).toEqual({ demote: 'span' });
    expect(sanitizeTag('marquee-ish-unknown')).toEqual({ demote: 'div' });
    expect(sanitizeTag('IMG')).toEqual({ drop: true });
  });
  it('allows a plain-shapes SVG subset and refuses use/image/foreignObject', () => {
    for (const ok of ['svg', 'path', 'circle', 'rect', 'g', 'text', 'defs', 'stop']) expect(sanitizeTag(ok, 'svg').tag).toBeTruthy();
    expect(sanitizeTag('lineargradient', 'svg')).toEqual({ tag: 'linearGradient' });
    for (const drop of ['use', 'image', 'foreignobject', 'clippath', 'mask', 'pattern', 'a', 'script', 'div']) expect(sanitizeTag(drop, 'svg')).toEqual({ drop: true });
  });

  it('maps attributes to React props, namespaces ids, and never lets a URL-bearing attribute through', () => {
    const p = sanitizeAttrs('input', { placeholder: 'Add…', type: 'file', tabIndex: '2', 'aria-label': 'x', 'data-role': 'k', id: 'title', htmlFor: 'q', href: 'https://evil', src: 'x', onclick: 'alert(1)', srcdoc: '<x>', formaction: 'https://evil', autoFocus: 'true', contentEditable: 'true', popover: '' });
    expect(p).toEqual({ placeholder: 'Add…', type: 'text', tabIndex: '2', 'aria-label': 'x', 'data-role': 'k', id: 'v-title', htmlFor: 'v-q' });
    expect(sanitizeAttrs('input', { type: 'password' }).type).toBe('text');
    expect(sanitizeAttrs('input', { type: 'checkbox', checked: 'true', disabled: 'false' })).toEqual({ type: 'checkbox', checked: true, disabled: false });
    expect(sanitizeAttrs('button', { type: 'weird' }).type).toBe('button');
    expect(sanitizeAttrs('label', { for: 'a b' }).htmlFor).toBe('v-a v-b');
    expect(sanitizeAttrs('div', { 'aria-labelledby': 'h', 'data-x': 'javascript:alert(1)', 'data-bad name': '1' })).toEqual({ 'aria-labelledby': 'v-h' });
    expect(sanitizeAttrs('circle', { fill: 'url(#g)', stroke: '#fff', 'stroke-width': '2', cx: '5' })).toEqual({ stroke: '#fff', strokeWidth: '2', cx: '5' });
    expect(sanitizeAttrs('svg', { viewBox: '0 0 10 10', xmlns: 'http://www.w3.org/2000/svg' })).toEqual({ viewBox: '0 0 10 10' });
  });

  it('prefixes class tokens and drops arbitrary-value abuse', () => {
    expect(sanitizeClass('grid gap-4 bg-primary hover:opacity-90 text-[11px]')).toBe('v:grid v:gap-4 v:bg-primary v:hover:opacity-90 v:text-[11px]');
    expect(sanitizeClass('bg-[url(https://evil)] grid')).toBe('v:grid');
    expect(sanitizeClass('')).toBeUndefined();
  });

  it('keeps inline styles to an allowlist with a value grammar; fixed → absolute; z-index capped; no url()/host vars', () => {
    const s = sanitizeStyle({ display: 'flex', position: 'fixed', zIndex: '99999', backgroundImage: 'url(https://evil/x.png)', background: 'linear-gradient(red, blue)', color: 'var(--veneer-primary)', width: 'var(--secret-host-width)', behavior: 'url(x.htc)', '--gap': '4px', '--bad name': '1', content: '"x"', 'margin-top': '4px', WebkitLineClamp: '2' });
    expect(s).toEqual({ display: 'flex', position: 'absolute', zIndex: '100', background: 'linear-gradient(red, blue)', color: 'var(--veneer-primary)', '--gap': '4px', marginTop: '4px', WebkitLineClamp: '2' });
    expect(sanitizeStyle({ color: 'red; background: url(x)' })).toEqual({});
    expect(sanitizeStyle({ transform: 'translateX(4px)', clipPath: 'url(#c)' })).toEqual({ transform: 'translateX(4px)' });
  });

  it('builds a plain event payload and classifies text controls', () => {
    const p = eventPayload({ target: { value: 'hi', checked: true }, key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: false, ctrlKey: false, metaKey: true, altKey: false, clientX: 1, clientY: 2, button: 0, buttons: 1 });
    expect(p).toMatchObject({ value: 'hi', checked: true, key: 'Enter', metaKey: true, clientX: 1, button: 0 });
    expect(isTextControl('input', undefined)).toBe(true);
    expect(isTextControl('input', 'checkbox')).toBe(false);
    expect(isTextControl('textarea')).toBe(true);
    expect(isTextControl('select')).toBe(false);
  });
});

describe('host tree mirror', () => {
  it('accepts children-before-parent and listener-before-insert ordering, moves keep subtrees, removes forget them', () => {
    const t = createTree();
    const r = t.apply({
      root: 1,
      ops: [
        { t: 'on', id: 9, n: 'click', on: true },
        { t: 'ins', id: 4, p: 3, i: 0, text: 'A' },
        { t: 'ins', id: 3, p: 2, i: 0, tag: 'li' },
        { t: 'ins', id: 6, p: 5, i: 0, text: 'B' },
        { t: 'ins', id: 5, p: 2, i: 1, tag: 'li' },
        { t: 'ins', id: 2, p: 1, i: 0, tag: 'ul' },
        { t: 'ins', id: 9, p: 1, i: 1, tag: 'button' },
        { t: 'attr', id: 9, n: 'class', v: 'bg-primary' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(t.nodes.get(2).children).toEqual([3, 5]);
    expect(t.nodes.get(9).listeners.has('click')).toBe(true);
    expect(t.nodes.get(9).attrs.class).toBe('bg-primary');
    // move B before A, keeping B's text child
    t.apply({ ops: [{ t: 'mv', id: 5, p: 2, i: 0 }] });
    expect(t.nodes.get(2).children).toEqual([5, 3]);
    expect(t.nodes.get(5).children).toEqual([6]);
    // remove the list: subtree gone
    t.apply({ ops: [{ t: 'rm', id: 2 }] });
    expect(t.nodes.has(2)).toBe(false);
    expect(t.nodes.has(6)).toBe(false);
    expect(t.nodes.get(1).children).toEqual([9]);
  });
  it('flags a node flood and rejects garbage', () => {
    const t = createTree();
    const ops = [];
    for (let i = 2; i < 6100; i++) ops.push({ t: 'ins', id: i, p: 1, i: 0, text: 'x' });
    const r = t.apply({ root: 1, ops });
    expect(r.error).toMatch(/too many nodes/);
    expect(r.flood).toBe(true);
    expect(createTree().apply({ ops: [{ t: 'zap', id: 1 }] }).error).toMatch(/unknown op/);
    expect(createTree().apply({ ops: [{ t: 'ins', id: 'x' }] }).error).toMatch(/bad op/);
  });
});

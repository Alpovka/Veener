/**
 * The host allowlist: what the page is willing to draw from the ops the worker sends. This is
 * wall 2 of the engine. Anything drawn into the page that could load a URL would do so with the
 * user's cookies, so the list is deliberately long and boring, and everything not on it is dropped
 * before it exists in the DOM.
 *
 * Shape: ops describe a tree of tags, attributes, inline styles, class names and listeners. We
 * decide, per item, whether it may reach React, and under which prop name.
 */
import { safeClassTokens } from './classGrammar.js';

export const CLASS_PREFIX = 'v';
export const ID_PREFIX = 'v-';
export const CAPS = { maxNodes: 6000, maxTextChars: 20000, maxAttrs: 64, maxStyleProps: 64, maxAttrChars: 2000, maxStyleChars: 500, maxZIndex: 100 };

const HTML_ELEMENTS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'button', 'input', 'textarea', 'select', 'option', 'optgroup', 'label', 'form', 'fieldset', 'legend', 'datalist',
  'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'address', 'figure', 'figcaption', 'menu',
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'code', 'pre', 'kbd', 'samp', 'var', 'blockquote', 'q', 'cite', 'abbr', 'time', 'data', 'sub', 'sup', 'del', 'ins', 'bdi', 'bdo',
  'hr', 'br', 'wbr', 'dl', 'dt', 'dd', 'details', 'summary', 'progress', 'meter', 'output',
]);
const SVG_ELEMENTS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'tspan', 'ellipse', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'symbol']);
// Rendered as a plain inline container so their text stays visible, without the dangerous part.
const DEMOTE = new Set(['a', 'dialog', 'area', 'map', 'font', 'center', 'big', 'tt', 'nobr', 'marquee', 'blink']);
// Never rendered, subtree dropped.
const DROP = new Set(['img', 'picture', 'source', 'track', 'video', 'audio', 'iframe', 'frame', 'frameset', 'embed', 'object', 'param', 'link', 'script', 'style', 'base', 'meta', 'template', 'slot', 'canvas', 'noscript', 'applet', 'portal', 'html', 'head', 'body', 'title', 'use', 'image', 'foreignobject', 'clippath', 'mask', 'pattern', 'filter', 'marker', 'animate', 'set', 'animatemotion', 'animatetransform', 'script', 'math']);
const SVG_CASE = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', foreignobject: 'foreignObject', clippath: 'clipPath' };

/**
 * Host policy for the two things the allowlist refuses by default because they load or follow a
 * URL: `<img src>` and `<a href>`. Each list holds URL prefixes (`https://cdn.example.com/`), or the
 * keywords `'same-origin'` (the host page's own origin), `'https:'` (any https URL) and, for images
 * only, `'data:'` (inline base64 raster/svg images). Empty lists keep the default: images dropped,
 * links demoted to plain text.
 */
export const DEFAULT_ALLOW = Object.freeze({ images: [], links: [] });
export function normalizeAllow(allow) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).map((x) => x.trim()) : typeof v === 'string' && v ? [v.trim()] : []);
  return { images: list(allow && allow.images), links: list(allow && allow.links) };
}
const pageOrigin = () => (typeof location !== 'undefined' && location.origin ? location.origin : 'http://localhost');
/** Absolute, normalised URL when `value` is allowed by `rules`, else null. */
export function allowedUrl(value, rules, kind) {
  if (!rules || !rules.length) return null;
  const v = String(value == null ? '' : value).trim();
  if (!v || v.length > CAPS.maxAttrChars) return null;
  if (/^data:/i.test(v)) {
    return kind === 'image' && rules.includes('data:') && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(v) ? v : null;
  }
  let u;
  try {
    u = new URL(v, pageOrigin() + '/');
  } catch (e) {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  const same = u.origin === pageOrigin();
  for (const rule of rules) {
    if (rule === 'same-origin' && same) return u.href;
    if (rule === 'https:' && u.protocol === 'https:') return u.href;
    if (/^https?:\/\/[^/]+/i.test(rule) && u.href.startsWith(rule)) return u.href;
  }
  return null;
}
export function isSameOrigin(href) {
  try {
    return new URL(href).origin === pageOrigin();
  } catch (e) {
    return false;
  }
}

/** @returns {{ tag: string } | { drop: true } | { demote: string }} */
export function sanitizeTag(tag, ns, allow = DEFAULT_ALLOW) {
  const t = String(tag || '').toLowerCase();
  if (t === 'img' && allow && allow.images && allow.images.length) return { tag: 'img' };
  if (DROP.has(t)) return { drop: true };
  if (ns === 'svg') {
    if (SVG_ELEMENTS.has(t)) return { tag: SVG_CASE[t] || t };
    return { drop: true };
  }
  if (HTML_ELEMENTS.has(t)) return { tag: t };
  if (t === 'svg') return { tag: 'svg' };
  if (t === 'a' && allow && allow.links && allow.links.length) return { tag: 'a' };
  if (DEMOTE.has(t)) return { demote: 'span' };
  return { demote: 'div' };
}

// Attribute names as Preact emitted them (any casing) → React prop. Absent = dropped.
const ATTR = {
  id: 'id', role: 'role', title: 'title', lang: 'lang', dir: 'dir', hidden: 'hidden', tabindex: 'tabIndex', draggable: 'draggable',
  spellcheck: 'spellCheck', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint', autocomplete: 'autoComplete', autocapitalize: 'autoCapitalize', autocorrect: 'autoCorrect',
  name: 'name', placeholder: 'placeholder', type: 'type', value: 'value', defaultvalue: 'defaultValue', defaultchecked: 'defaultChecked', checked: 'checked', disabled: 'disabled',
  readonly: 'readOnly', required: 'required', min: 'min', max: 'max', step: 'step', minlength: 'minLength', maxlength: 'maxLength', pattern: 'pattern', size: 'size',
  rows: 'rows', cols: 'cols', wrap: 'wrap', multiple: 'multiple', selected: 'selected', for: 'htmlFor', htmlfor: 'htmlFor', list: 'list', open: 'open',
  colspan: 'colSpan', rowspan: 'rowSpan', scope: 'scope', headers: 'headers', abbr: 'abbr', span: 'span', start: 'start', reversed: 'reversed', datetime: 'dateTime',
  label: 'label', optimum: 'optimum', low: 'low', high: 'high', form: 'form', width: 'width', height: 'height', nowrap: 'noWrap', align: 'align', valign: 'vAlign',
  // svg
  viewbox: 'viewBox', fill: 'fill', stroke: 'stroke', 'stroke-width': 'strokeWidth', strokewidth: 'strokeWidth', 'stroke-linecap': 'strokeLinecap', strokelinecap: 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin', strokelinejoin: 'strokeLinejoin', 'stroke-dasharray': 'strokeDasharray', strokedasharray: 'strokeDasharray', 'stroke-dashoffset': 'strokeDashoffset', strokedashoffset: 'strokeDashoffset',
  'stroke-opacity': 'strokeOpacity', strokeopacity: 'strokeOpacity', 'stroke-miterlimit': 'strokeMiterlimit', strokemiterlimit: 'strokeMiterlimit', 'fill-opacity': 'fillOpacity', fillopacity: 'fillOpacity', 'fill-rule': 'fillRule', fillrule: 'fillRule',
  opacity: 'opacity', d: 'd', cx: 'cx', cy: 'cy', r: 'r', rx: 'rx', ry: 'ry', x: 'x', y: 'y', x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2', points: 'points', transform: 'transform',
  'text-anchor': 'textAnchor', textanchor: 'textAnchor', 'dominant-baseline': 'dominantBaseline', dominantbaseline: 'dominantBaseline', 'font-size': 'fontSize', fontsize: 'fontSize', 'font-weight': 'fontWeight', fontweight: 'fontWeight',
  'font-family': 'fontFamily', fontfamily: 'fontFamily', offset: 'offset', 'stop-color': 'stopColor', stopcolor: 'stopColor', 'stop-opacity': 'stopOpacity', stopopacity: 'stopOpacity',
  gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', preserveaspectratio: 'preserveAspectRatio', 'vector-effect': 'vectorEffect', vectoreffect: 'vectorEffect', pathlength: 'pathLength',
  'stroke-linecap ': 'strokeLinecap', dx: 'dx', dy: 'dy', 'letter-spacing': 'letterSpacing', 'text-decoration': 'textDecoration', 'paint-order': 'paintOrder', 'shape-rendering': 'shapeRendering',
};
const ID_REF_ATTRS = new Set(['id', 'htmlFor', 'list', 'form', 'headers']);
const ID_REF_ARIA = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto']);
const INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'tel', 'url', 'date', 'datetime-local', 'month', 'week', 'time', 'range', 'color', 'checkbox', 'radio', 'hidden', 'submit', 'button', 'reset']);
const PAINT_ATTRS = new Set(['fill', 'stroke', 'stopColor', 'd', 'transform', 'gradientTransform', 'points']);
const URLISH = /url\s*\(|javascript:|data:|vbscript:|<|>|\\|expression\s*\(/i;
const SAFE_NAME = /^[a-z][a-z0-9-]{0,60}$/;

function prefixIds(v) {
  return String(v)
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => (id.startsWith(ID_PREFIX) ? id : ID_PREFIX + id))
    .join(' ');
}

/** attrs: { name: value } as recorded by the guest → React props (never class/style/events). */
export function sanitizeAttrs(tag, attrs, allow = DEFAULT_ALLOW) {
  const out = {};
  let count = 0;
  if (tag === 'img') {
    // Only reachable when the host allowed images. Never eager, never with referrer, never a drag source.
    out.alt = '';
    out.loading = 'lazy';
    out.decoding = 'async';
    out.referrerPolicy = 'no-referrer';
    out.draggable = false;
  }
  for (const rawName of Object.keys(attrs || {})) {
    if (++count > CAPS.maxAttrs) break;
    const lower = String(rawName).toLowerCase();
    let value = attrs[rawName];
    if (value == null) continue;
    value = String(value);
    if (value.length > CAPS.maxAttrChars) value = value.slice(0, CAPS.maxAttrChars);
    if (lower === 'class' || lower === 'classname' || lower === 'style') continue; // handled elsewhere
    if (lower.startsWith('on')) continue;
    if (tag === 'img' && lower === 'src') {
      const ok = allowedUrl(value, allow && allow.images, 'image');
      if (ok) out.src = ok;
      continue;
    }
    if (tag === 'img' && lower === 'alt') {
      out.alt = value;
      continue;
    }
    if (tag === 'a' && lower === 'href') {
      const ok = allowedUrl(value, allow && allow.links, 'link');
      if (ok) {
        out.href = ok;
        if (!isSameOrigin(ok)) {
          out.target = '_blank';
          out.rel = 'noopener noreferrer nofollow';
        }
      }
      continue;
    }
    if (lower.startsWith('aria-')) {
      if (!SAFE_NAME.test(lower.slice(5))) continue;
      out[lower] = ID_REF_ARIA.has(lower) ? prefixIds(value) : value;
      continue;
    }
    if (lower.startsWith('data-')) {
      if (!SAFE_NAME.test(lower.slice(5)) || URLISH.test(value)) continue;
      out[lower] = value;
      continue;
    }
    const prop = ATTR[lower];
    if (!prop) continue; // href, src, srcset, action, formaction, ping, poster, cite, xlink:href, is, popover*, contenteditable, autofocus, target, rel, download… all land here
    if (prop === 'type' && tag === 'input') {
      const t = value.toLowerCase();
      out.type = INPUT_TYPES.has(t) ? t : 'text'; // file / image / password never
      continue;
    }
    if (prop === 'type' && tag === 'button') {
      out.type = /^(submit|reset|button)$/i.test(value) ? value.toLowerCase() : 'button';
      continue;
    }
    if (prop === 'autoComplete') {
      out.autoComplete = /^(on|off|name|email|username|tel|organization|street-address|postal-code|country|bday|nickname)$/i.test(value) ? value : 'off';
      continue;
    }
    if (PAINT_ATTRS.has(prop) && URLISH.test(value)) continue;
    if (ID_REF_ATTRS.has(prop)) {
      out[prop] = prefixIds(value);
      continue;
    }
    if (prop === 'draggable') {
      out.draggable = value === 'true' || value === '';
      continue;
    }
    if (prop === 'hidden' || prop === 'disabled' || prop === 'readOnly' || prop === 'required' || prop === 'multiple' || prop === 'open' || prop === 'reversed' || prop === 'noWrap') {
      out[prop] = value !== 'false';
      continue;
    }
    if (prop === 'checked' || prop === 'selected' || prop === 'defaultChecked') {
      out[prop] = value !== 'false';
      continue;
    }
    if (URLISH.test(value) && prop !== 'title' && prop !== 'placeholder' && prop !== 'label' && prop !== 'value' && prop !== 'defaultValue') continue;
    out[prop] = value;
  }
  return out;
}

/** Class attribute → prefixed className the scoped stylesheet targets. */
export function sanitizeClass(value) {
  const tokens = safeClassTokens(value);
  if (!tokens.length) return undefined;
  return tokens.map((t) => `${CLASS_PREFIX}:${t}`).join(' ');
}

// Inline styles: property allowlist (React camelCase) + value grammar.
const STYLE_PROPS = new Set(
  (
    'display position top right bottom left inset insetInline insetBlock zIndex float clear overflow overflowX overflowY overflowWrap ' +
    'width height minWidth minHeight maxWidth maxHeight margin marginTop marginRight marginBottom marginLeft marginInline marginBlock padding paddingTop paddingRight paddingBottom paddingLeft paddingInline paddingBlock boxSizing ' +
    'flex flexDirection flexWrap flexFlow flexGrow flexShrink flexBasis alignItems alignContent alignSelf justifyContent justifyItems justifySelf gap rowGap columnGap order ' +
    'grid gridTemplateColumns gridTemplateRows gridTemplateAreas gridTemplate gridAutoColumns gridAutoRows gridAutoFlow gridColumn gridColumnStart gridColumnEnd gridRow gridRowStart gridRowEnd gridArea placeItems placeContent placeSelf ' +
    'aspectRatio objectFit objectPosition visibility opacity cursor pointerEvents userSelect resize verticalAlign whiteSpace wordBreak textOverflow hyphens tabSize ' +
    'textAlign textDecoration textDecorationLine textDecorationColor textDecorationStyle textDecorationThickness textUnderlineOffset textTransform textIndent letterSpacing lineHeight fontSize fontWeight fontStyle fontFamily fontVariant fontVariantNumeric fontFeatureSettings fontStretch ' +
    'color background backgroundColor backgroundImage backgroundSize backgroundPosition backgroundRepeat backgroundClip backgroundOrigin backgroundAttachment ' +
    'border borderTop borderRight borderBottom borderLeft borderWidth borderTopWidth borderRightWidth borderBottomWidth borderLeftWidth borderStyle borderColor borderTopColor borderRightColor borderBottomColor borderLeftColor borderInline borderBlock borderCollapse borderSpacing ' +
    'borderRadius borderTopLeftRadius borderTopRightRadius borderBottomLeftRadius borderBottomRightRadius outline outlineColor outlineStyle outlineWidth outlineOffset boxShadow textShadow ' +
    'transform transformOrigin transformStyle perspective transition transitionProperty transitionDuration transitionTimingFunction transitionDelay animation animationName animationDuration animationTimingFunction animationDelay animationIterationCount animationDirection animationFillMode willChange ' +
    'backdropFilter filter mixBlendMode isolation clipPath listStyle listStyleType listStylePosition appearance WebkitAppearance accentColor caretColor scrollBehavior scrollSnapType scrollSnapAlign scrollbarWidth scrollbarGutter columns columnCount ' +
    'WebkitLineClamp WebkitBoxOrient lineClamp WebkitFontSmoothing MozOsxFontSmoothing textRendering contain content strokeWidth stroke fill emptyCells tableLayout captionSide direction unicodeBidi writingMode textWrap'
  ).split(/\s+/)
);
const STYLE_VALUE_BAD = /url\s*\(|image-set\s*\(|src\s*\(|element\s*\(|expression\s*\(|attr\s*\(|env\s*\(|@import|javascript:|\\|[<>;{}]/i;
const VAR_RE = /var\s*\(\s*--([a-z0-9-]+)/gi;

function kebabToCamel(p) {
  return p.startsWith('--') ? p : p.replace(/^-(webkit|moz|ms)-/, (m, v) => (v === 'ms' ? 'ms' : v[0].toUpperCase() + v.slice(1))).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** style map as recorded (prop name in either casing) → React style object. */
export function sanitizeStyle(style) {
  const out = {};
  let count = 0;
  for (const rawProp of Object.keys(style || {})) {
    if (++count > CAPS.maxStyleProps) break;
    let value = style[rawProp];
    if (value == null || value === '') continue;
    value = String(value);
    if (value.length > CAPS.maxStyleChars || STYLE_VALUE_BAD.test(value)) continue;
    // custom properties: only the brand namespace or the generated UI's own (no `var(--host-secret)` reads)
    let prop = String(rawProp);
    if (prop.startsWith('--')) {
      if (!/^--[a-z][a-z0-9-]{0,60}$/.test(prop)) continue;
      out[prop] = value;
      continue;
    }
    prop = kebabToCamel(prop);
    if (!STYLE_PROPS.has(prop)) continue;
    let ok = true;
    for (const m of value.matchAll(VAR_RE)) {
      if (!/^(veneer-|v-)/.test(m[1])) ok = false; // reading arbitrary host variables is not allowed
    }
    if (!ok) continue;
    if (prop === 'position' && /fixed/i.test(value)) value = 'absolute';
    if (prop === 'zIndex') {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n)) continue;
      value = String(Math.max(-1, Math.min(CAPS.maxZIndex, n)));
    }
    if (prop === 'content') continue; // pseudo-only; meaningless inline and a string-injection surface
    out[prop] = value;
  }
  return out;
}

// DOM listener name → React prop
export const EVENT_PROP = {
  click: 'onClick', dblclick: 'onDoubleClick', input: 'onInput', change: 'onChange', submit: 'onSubmit', keydown: 'onKeyDown', keyup: 'onKeyUp', keypress: 'onKeyPress',
  focus: 'onFocus', blur: 'onBlur', focusin: 'onFocus', focusout: 'onBlur', mouseenter: 'onMouseEnter', mouseleave: 'onMouseLeave', mouseover: 'onMouseOver', mouseout: 'onMouseOut',
  mousedown: 'onMouseDown', mouseup: 'onMouseUp', pointerdown: 'onPointerDown', pointerup: 'onPointerUp', pointerenter: 'onPointerEnter', pointerleave: 'onPointerLeave',
  dragstart: 'onDragStart', dragover: 'onDragOver', dragenter: 'onDragEnter', dragleave: 'onDragLeave', drop: 'onDrop', dragend: 'onDragEnd', touchstart: 'onTouchStart', touchend: 'onTouchEnd',
  contextmenu: 'onContextMenu', toggle: 'onToggle', wheel: 'onWheel',
};
const TEXT_CONTROL = /^(text|search|email|number|tel|url|date|datetime-local|month|week|time|range|color|hidden)$/;

/** Is this element a control whose text value lives in the DOM (no round-trip for typing)? */
export function isTextControl(tag, type) {
  return tag === 'textarea' || (tag === 'input' && (!type || TEXT_CONTROL.test(type)));
}

/** Build the plain-JSON payload the guest receives for a DOM event. */
export function eventPayload(e) {
  const t = e.target || {};
  const p = {};
  if (typeof t.value === 'string') p.value = t.value.slice(0, 20000);
  if (typeof t.checked === 'boolean') p.checked = t.checked;
  if (typeof e.key === 'string') {
    p.key = e.key;
    p.code = e.code;
    p.keyCode = e.keyCode;
    p.repeat = !!e.repeat;
  }
  if ('shiftKey' in e) {
    p.shiftKey = !!e.shiftKey;
    p.ctrlKey = !!e.ctrlKey;
    p.metaKey = !!e.metaKey;
    p.altKey = !!e.altKey;
  }
  if (typeof e.clientX === 'number') {
    p.clientX = e.clientX;
    p.clientY = e.clientY;
    p.button = e.button;
    p.buttons = e.buttons;
  }
  if (typeof e.deltaY === 'number') {
    p.deltaY = e.deltaY;
    p.deltaX = e.deltaX;
  }
  if (typeof e.detail === 'number') p.detail = e.detail;
  return p;
}

// The host `allow` policy: the only way <img> and <a href> ever reach the page.
import { describe, it, expect } from 'vitest';
import { sanitizeTag, sanitizeAttrs, normalizeAllow, allowedUrl, DEFAULT_ALLOW } from '../src/engine/sanitize.js';

// Node has no `location`; the sanitizer treats http://localhost as the page origin there.
describe('allow policy: images and links', () => {
  it('drops images and demotes links by default', () => {
    expect(sanitizeTag('img')).toEqual({ drop: true });
    expect(sanitizeTag('a')).toEqual({ demote: 'span' });
    expect(sanitizeTag('img', undefined, DEFAULT_ALLOW)).toEqual({ drop: true });
  });
  it('normalises the policy', () => {
    expect(normalizeAllow(undefined)).toEqual({ images: [], links: [] });
    expect(normalizeAllow({ images: 'same-origin', links: ['https://a.b/', 3, ''] })).toEqual({ images: ['same-origin'], links: ['https://a.b/'] });
  });
  it('keeps <img> only for allowed sources, with safe defaults', () => {
    const allow = normalizeAllow({ images: ['same-origin', 'https://cdn.example.com/img/'] });
    expect(sanitizeTag('img', undefined, allow)).toEqual({ tag: 'img' });
    const ok = sanitizeAttrs('img', { src: '/pics/a.png', alt: 'A', width: '40', onload: 'x()' }, allow);
    expect(ok).toMatchObject({ src: 'http://localhost/pics/a.png', alt: 'A', width: '40', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer', draggable: false });
    expect(ok.onload).toBeUndefined();
    expect(sanitizeAttrs('img', { src: 'https://cdn.example.com/img/x.jpg' }, allow).src).toBe('https://cdn.example.com/img/x.jpg');
    expect(sanitizeAttrs('img', { src: 'https://cdn.example.com/other/x.jpg' }, allow).src).toBeUndefined();
    expect(sanitizeAttrs('img', { src: 'https://evil.example/x.jpg' }, allow).src).toBeUndefined();
    expect(sanitizeAttrs('img', { src: 'javascript:alert(1)' }, allow).src).toBeUndefined();
    expect(sanitizeAttrs('img', { src: 'data:image/png;base64,iVBORw0KGgo=' }, allow).src).toBeUndefined();
    expect(sanitizeAttrs('img', { srcset: '/a.png 1x' }, allow).srcset).toBeUndefined();
  });
  it('allows inline data images only when listed, and only real base64 image types', () => {
    const allow = normalizeAllow({ images: ['data:'] });
    expect(allowedUrl('data:image/png;base64,iVBORw0KGgo=', allow.images, 'image')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(allowedUrl('data:text/html;base64,PHNjcmlwdD4=', allow.images, 'image')).toBeNull();
    expect(allowedUrl('data:image/svg+xml,<svg onload=alert(1)>', allow.images, 'image')).toBeNull();
    expect(allowedUrl('data:image/png;base64,iVBORw0KGgo=', allow.images, 'link')).toBeNull();
  });
  it('keeps <a href> only for allowed destinations; cross-origin links open safely in a new tab', () => {
    const allow = normalizeAllow({ links: ['same-origin', 'https://docs.example.com/'] });
    expect(sanitizeTag('a', undefined, allow)).toEqual({ tag: 'a' });
    const same = sanitizeAttrs('a', { href: '/tasks/1', title: 'open' }, allow);
    expect(same).toMatchObject({ href: 'http://localhost/tasks/1', title: 'open' });
    expect(same.target).toBeUndefined();
    const ext = sanitizeAttrs('a', { href: 'https://docs.example.com/page', target: '_top', download: 'x' }, allow);
    expect(ext).toMatchObject({ href: 'https://docs.example.com/page', target: '_blank', rel: 'noopener noreferrer nofollow' });
    expect(ext.download).toBeUndefined();
    expect(sanitizeAttrs('a', { href: 'https://evil.example/' }, allow).href).toBeUndefined();
    expect(sanitizeAttrs('a', { href: 'javascript:alert(1)' }, allow).href).toBeUndefined();
    expect(sanitizeAttrs('a', { href: 'https://user:pw@docs.example.com/' }, allow).href).toBeUndefined();
  });
  it('tolerates messy policies and values without throwing', () => {
    const allow = normalizeAllow({ images: ['same-origin'], links: ['same-origin'] });
    expect(sanitizeAttrs('img', { src: 'http://[bad' }, allow).src).toBeUndefined();
    expect(sanitizeAttrs('a', { href: '' }, allow).href).toBeUndefined();
    expect(() => sanitizeAttrs('a', { href: 'x'.repeat(5000) }, allow)).not.toThrow();
  });
  it("'https:' allows any https destination but never http or other schemes", () => {
    const allow = normalizeAllow({ links: ['https:'] });
    expect(allowedUrl('https://anywhere.example/x', allow.links, 'link')).toBe('https://anywhere.example/x');
    expect(allowedUrl('http://anywhere.example/x', allow.links, 'link')).toBeNull();
    expect(allowedUrl('ftp://anywhere.example/x', allow.links, 'link')).toBeNull();
  });
});

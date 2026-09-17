'use client';
import React from 'react';

/**
 * The Veneer mark: three stacked layers forming a "V" — a thin, beautiful surface
 * (the veneer) laid over the real material underneath (your app + its capabilities).
 */
export function VeneerLogo({ size = 28, withWordmark = false, color = '#4f46e5' }) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Veneer"
    >
      <defs>
        <linearGradient id="leftMain" x1="118" y1="88" x2="267" y2="432" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7D5CFF"/>
          <stop offset="0.48" stopColor="#6131E8"/>
          <stop offset="1" stopColor="#912CFF"/>
        </linearGradient>
        <linearGradient id="rightMain" x1="394" y1="88" x2="245" y2="432" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8A6BFF"/>
          <stop offset="0.48" stopColor="#6E37F2"/>
          <stop offset="1" stopColor="#9A33FF"/>
        </linearGradient>
        <linearGradient id="leftEdge" x1="117" y1="89" x2="228" y2="302" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#916FFF"/>
          <stop offset="1" stopColor="#3E1A91"/>
        </linearGradient>
        <linearGradient id="rightEdge" x1="395" y1="89" x2="284" y2="302" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9A7AFF"/>
          <stop offset="1" stopColor="#44209A"/>
        </linearGradient>
        <linearGradient id="core" x1="256" y1="248" x2="256" y2="421" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#321568"/>
          <stop offset="0.55" stopColor="#6B2CE8"/>
          <stop offset="1" stopColor="#9D33FF"/>
        </linearGradient>
        <filter id="softDepth" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#160D40" floodOpacity="0.22"/>
        </filter>
      </defs>
      <g filter="url(#softDepth)">
        <path d="M96 64 L211 167 L256 256 L181 191 Z" fill="url(#leftEdge)"/>
        <path d="M96 64 L181 191 L256 416 L150 237 Z" fill="url(#leftMain)"/>
        <path d="M416 64 L301 167 L256 256 L331 191 Z" fill="url(#rightEdge)"/>
        <path d="M416 64 L331 191 L256 416 L362 237 Z" fill="url(#rightMain)"/>
        <path d="M211 167 L256 256 L301 167 L331 191 L256 416 L181 191 Z" fill="url(#core)" opacity="0.97"/>
        <path d="M96 64 L211 167 L256 256 L181 191 Z" fill="#FFFFFF" opacity="0.06"/>
        <path d="M416 64 L301 167 L256 256 L331 191 Z" fill="#FFFFFF" opacity="0.07"/>
      </g>
    </svg>
  );

  if (!withWordmark) return mark;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {mark}
      <span style={{ fontWeight: 700, fontSize: size * 0.72, letterSpacing: '-0.02em', color: '#0f172a' }}>
        Veneer
      </span>
    </span>
  );
}

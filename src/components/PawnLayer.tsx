import { memo, useCallback } from 'react';
import type { PawnColorId, SanitizedPlayer } from '@engine/types';
import { paletteOf } from './geometry';

export interface PawnRefs {
  anchor: HTMLDivElement | null;
  lift: HTMLDivElement | null;
  token: HTMLDivElement | null;
  ripple: HTMLDivElement | null;
}

export type PawnRefMap = Record<string, PawnRefs>;

interface Props {
  players: SanitizedPlayer[];
  activeId: string | null;
  refs: { current: PawnRefMap };
  dizzyIds: string[];
}

export function PawnToken({ color, size = 40, initial }: { color: PawnColorId; size?: number; initial?: string }) {
  const pal = paletteOf(color);
  const gid = `pawn-g-${color}`;
  return (
    <svg className="pawn-svg" viewBox="0 0 40 52" width={size} height={(size * 52) / 40} aria-hidden="true">
      <defs>
        <radialGradient id={`${gid}-head`} cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.18" stopColor={pal.light} />
          <stop offset="0.6" stopColor={pal.primary} />
          <stop offset="1" stopColor={pal.dark} />
        </radialGradient>
        <linearGradient id={`${gid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={pal.dark} />
          <stop offset="0.28" stopColor={pal.light} />
          <stop offset="0.55" stopColor={pal.primary} />
          <stop offset="1" stopColor={pal.dark} />
        </linearGradient>
      </defs>
      {/* base */}
      <ellipse cx="20" cy="45" rx="16" ry="5.5" fill={pal.dark} />
      <path d="M4 42.5 C4 39 36 39 36 42.5 L36 45 C36 48.5 4 48.5 4 45 Z" fill={`url(#${gid}-body)`} />
      <ellipse cx="20" cy="41.6" rx="15.6" ry="4.4" fill={pal.primary} />
      <ellipse cx="17" cy="40.8" rx="9" ry="1.6" fill="#fff" opacity="0.35" />
      {/* body */}
      <path d="M11.5 41 C13.5 33 15 27 15.5 22 L24.5 22 C25 27 26.5 33 28.5 41 Z" fill={`url(#${gid}-body)`} />
      {/* collar */}
      <ellipse cx="20" cy="22.2" rx="7.4" ry="2.4" fill={pal.dark} />
      <ellipse cx="20" cy="21.4" rx="7.2" ry="2.1" fill={`url(#${gid}-body)`} />
      {/* head */}
      <circle cx="20" cy="12.5" r="9.2" fill={`url(#${gid}-head)`} />
      <circle cx="20" cy="12.5" r="9.2" fill="none" stroke={pal.dark} strokeOpacity="0.5" strokeWidth="0.8" />
      <ellipse cx="16.6" cy="8.6" rx="3.2" ry="2.2" fill="#fff" opacity="0.75" transform="rotate(-25 16.6 8.6)" />
      <path d="M12.8 17 A 9.2 9.2 0 0 0 27.2 17" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.9" />
      {initial ? (
        <text x="20" y="34.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#fff" opacity="0.92" fontFamily="Fredoka, Nunito, sans-serif">
          {initial}
        </text>
      ) : null}
    </svg>
  );
}

function PawnLayerImpl({ players, activeId, refs, dizzyIds }: Props) {
  const setRef = useCallback(
    (id: string, key: keyof PawnRefs) => (el: HTMLDivElement | null) => {
      const entry = refs.current[id] ?? (refs.current[id] = { anchor: null, lift: null, token: null, ripple: null });
      entry[key] = el;
    },
    [refs],
  );

  return (
    <div className="pawn-layer" aria-hidden="true">
      {players.map((p) => {
        const pal = paletteOf(p.color);
        const isActive = p.id === activeId;
        const dizzy = dizzyIds.includes(p.id);
        return (
          <div
            key={p.id}
            ref={setRef(p.id, 'anchor')}
            className={`pawn-anchor${isActive ? ' is-active' : ''}${p.disconnected ? ' is-away' : ''}`}
            style={{ ['--pc' as string]: pal.primary, ['--pglow' as string]: pal.glow }}
            data-player={p.id}
          >
            <div className="pawn-ground">
              <div className="pawn-halo" />
              <div className="pawn-ripple" ref={setRef(p.id, 'ripple')} />
              <div className="pawn-shadow" />
              <div className="pawn-bulge" />
            </div>
            <div className="pawn-lift" ref={setRef(p.id, 'lift')}>
              <div className="pawn-token" ref={setRef(p.id, 'token')}>
                <PawnToken color={p.color} initial={p.name.trim().charAt(0).toUpperCase()} />
              </div>
              {dizzy && (
                <div className="pawn-dizzy">
                  <span>★</span>
                  <span>✦</span>
                  <span>★</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const PawnLayer = memo(PawnLayerImpl);
export default PawnLayer;

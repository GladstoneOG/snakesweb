import { memo } from 'react';
import type { PortalLink } from '@engine/types';
import {
  getLadderGeometry,
  getSnakeGeometry,
  ladderVariant,
  snakeVariant,
  type LadderGeometry,
  type Pt,
} from './geometry';

export interface ActivePortal {
  id: string;
  type: 'snake' | 'ladder';
}

interface Props {
  portals: PortalLink[];
  active: ActivePortal | null;
}

const f = (n: number) => Math.round(n * 100) / 100;
const line = (a: Pt, b: Pt) => ({ x1: f(a.x), y1: f(a.y), x2: f(b.x), y2: f(b.y) });

function Ladder({ portal, active }: { portal: PortalLink; active: boolean }) {
  const g: LadderGeometry = getLadderGeometry(portal);
  const v = ladderVariant(portal);
  const shadowRails = (
    <>
      <line {...line(g.railA[0], g.railA[1])} />
      <line {...line(g.railB[0], g.railB[1])} />
      {g.rungs.map((r, i) => (
        <line key={i} {...line(r[0], r[1])} className="ladder-shadow-rung" />
      ))}
    </>
  );
  // bamboo node rings along rails
  const nodes: Pt[] = [];
  if (v.bamboo) {
    for (const rail of [g.railA, g.railB]) {
      const segs = Math.max(2, Math.round(Math.hypot(rail[1].x - rail[0].x, rail[1].y - rail[0].y) / 4.2));
      for (let k = 1; k < segs; k++) {
        const t = k / segs;
        nodes.push({ x: rail[0].x + (rail[1].x - rail[0].x) * t, y: rail[0].y + (rail[1].y - rail[0].y) * t });
      }
    }
  }
  return (
    <g className={`ladder ladder-v${portal.styleVariant % 4}${active ? ' is-active' : ''}`} data-portal={portal.id}>
      <g className="ladder-shadow" transform="translate(0.7 0.95)">
        {shadowRails}
      </g>
      {g.rungs.map((r, i) => (
        <g key={i}>
          <line {...line(r[0], r[1])} stroke={v.railDark} strokeWidth={0.78} strokeLinecap="round" />
          <line {...line(r[0], r[1])} stroke={v.rung} strokeWidth={0.52} strokeLinecap="round" />
        </g>
      ))}
      {[g.railA, g.railB].map((rail, i) => (
        <g key={i}>
          <line {...line(rail[0], rail[1])} stroke={v.railDark} strokeWidth={1.05} strokeLinecap="round" />
          <line {...line(rail[0], rail[1])} stroke={v.rail} strokeWidth={0.78} strokeLinecap="round" />
          <line
            {...line(rail[0], rail[1])}
            stroke={v.railLight}
            strokeWidth={0.22}
            strokeLinecap="round"
            transform="translate(-0.12 -0.14)"
            opacity={0.9}
          />
        </g>
      ))}
      {nodes.map((p, i) => (
        <circle key={i} cx={f(p.x)} cy={f(p.y)} r={0.46} fill="none" stroke={v.railDark} strokeWidth={0.18} />
      ))}
      {/* golden shimmer overlay, opacity-animated when climbed */}
      <g className="ladder-shimmer">
        <line {...line(g.railA[0], g.railA[1])} />
        <line {...line(g.railB[0], g.railB[1])} />
        {g.rungs.map((r, i) => (
          <line key={i} {...line(r[0], r[1])} />
        ))}
      </g>
    </g>
  );
}

function Snake({ portal, active, index }: { portal: PortalLink; active: boolean; index: number }) {
  const g = getSnakeGeometry(portal);
  const v = snakeVariant(portal);
  const variant = portal.styleVariant % 4;
  const clipId = `snake-clip-${portal.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${index}`;
  const gradId = `snake-grad-${variant}`;
  const delay = `${(index * 0.73) % 3.1}s`;
  return (
    <g
      className={`snake snake-v${variant}${active ? ' is-active' : ''}`}
      data-portal={portal.id}
      style={{ ['--snake-delay' as string]: delay }}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={g.bodyPath} />
        </clipPath>
      </defs>
      {/* cast shadow */}
      <path d={g.bodyPath} className="snake-shadow" transform="translate(0.6 0.9)" />
      <g className="snake-body">
        <path d={g.bodyPath} fill={`url(#${gradId})`} stroke={v.bodyDark} strokeWidth={0.28} strokeLinejoin="round" />
        <g clipPath={`url(#${clipId})`}>
          {variant === 0 && (
            <>
              <path d={g.spinePath} fill="none" stroke={v.pattern} strokeWidth={1.5} strokeDasharray="1.1 1.25" strokeLinecap="round" opacity={0.85} />
              <path d={g.spinePath} fill="none" stroke={v.pattern2} strokeWidth={0.45} strokeDasharray="1.1 1.25" strokeDashoffset={-0.2} strokeLinecap="round" opacity={0.7} />
            </>
          )}
          {variant === 1 && (
            <>
              <path d={g.spinePath} fill="none" stroke={v.pattern} strokeWidth={5} strokeDasharray="0.9 2.3" />
              <path d={g.spinePath} fill="none" stroke={v.pattern2} strokeWidth={5} strokeDasharray="0.35 2.85" strokeDashoffset={-0.27} />
            </>
          )}
          {variant === 2 && (
            <>
              <path d={g.spinePath} fill="none" stroke={v.pattern} strokeWidth={5} strokeDasharray="0.35 1.8" opacity={0.55} />
              <path d={g.spinePath} fill="none" stroke={v.pattern2} strokeWidth={0.4} opacity={0.55} />
            </>
          )}
          {variant === 3 && (
            <path d={g.spinePath} fill="none" stroke={v.pattern} strokeWidth={1.7} strokeDasharray="1.6 1.3" strokeLinecap="round" opacity={0.75} />
          )}
          <path d={g.bodyPath} fill={`url(#snake-scales)`} opacity={0.32} />
          <path d={g.spinePath} fill="none" stroke="#fff" strokeWidth={0.32} opacity={0.35} transform="translate(-0.25 -0.3)" />
        </g>
      </g>
      {/* head */}
      <g transform={`translate(${f(g.head.x)} ${f(g.head.y)}) rotate(${f(g.headAngle)})`}>
        <g className="snake-head">
          {variant === 2 && (
            <ellipse cx={-0.7} cy={0} rx={1.6} ry={2.55} fill={v.body} stroke={v.bodyDark} strokeWidth={0.26} />
          )}
          {variant === 2 && <ellipse cx={-0.7} cy={0} rx={0.9} ry={1.7} fill={v.belly} opacity={0.55} />}
          <g className="snake-tongue">
            <path d="M 2.1 0 L 3.5 0 M 3.5 0 L 4.15 -0.55 M 3.5 0 L 4.15 0.55" stroke="#e23a4e" strokeWidth={0.26} strokeLinecap="round" fill="none" />
          </g>
          <g className="snake-jaw snake-jaw-lower">
            <path d="M -0.8 0 Q 0.6 1.75 2.15 0.55 Q 2.5 0.15 2.3 0 Z" fill={v.bodyDark} />
          </g>
          <path className="snake-mouth" d="M 0.4 0 L 2.6 -0.75 L 2.6 0.75 Z" fill="#5a0d1c" />
          <g className="snake-jaw snake-jaw-upper">
            <path
              d="M -1.2 0 C -1.2 -1.45 0.3 -1.75 1.35 -1.45 C 2.25 -1.2 2.75 -0.55 2.75 0 C 2.75 0.55 2.25 1.2 1.35 1.45 C 0.3 1.75 -1.2 1.45 -1.2 0 Z"
              fill={`url(#${gradId})`}
              stroke={v.bodyDark}
              strokeWidth={0.26}
            />
            <ellipse cx={0.6} cy={0} rx={1.1} ry={0.5} fill={v.bodyLight} opacity={0.45} />
            <circle cx={2.35} cy={-0.32} r={0.11} fill={v.bodyDark} />
            <circle cx={2.35} cy={0.32} r={0.11} fill={v.bodyDark} />
          </g>
          {[-0.82, 0.82].map((y) => (
            <g key={y} transform={`translate(1.05 ${y})`}>
              <g className="snake-eye">
                <circle r={0.52} fill={v.eye} stroke={v.bodyDark} strokeWidth={0.14} />
                <ellipse rx={0.14} ry={0.38} fill="#120a06" />
                <circle cx={-0.16} cy={-0.16} r={0.12} fill="#fff" opacity={0.9} />
              </g>
            </g>
          ))}
        </g>
      </g>
    </g>
  );
}

function SnakesAndLaddersLayerImpl({ portals, active }: Props) {
  const ladders = portals.filter((p) => p.type === 'ladder');
  const snakes = portals.filter((p) => p.type === 'snake');
  return (
    <svg className="portal-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="snake-scales" patternUnits="userSpaceOnUse" width="1.1" height="0.9">
          <path d="M 0 0.9 Q 0.55 0.15 1.1 0.9" fill="none" stroke="#000" strokeWidth={0.12} opacity={0.6} />
          <path d="M -0.55 0.45 Q 0 -0.3 0.55 0.45 M 0.55 0.45 Q 1.1 -0.3 1.65 0.45" fill="none" stroke="#fff" strokeWidth={0.08} opacity={0.5} />
        </pattern>
        {[
          ['#7fd88a', '#2fa35a', '#135530'],
          ['#ff8f72', '#e2513b', '#7d1f14'],
          ['#c79af2', '#8e4fd0', '#3f1a6e'],
          ['#ffe08a', '#e0ac34', '#7c5210'],
        ].map(([l, m, d], i) => (
          <linearGradient key={i} id={`snake-grad-${i}`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor={l} />
            <stop offset="0.45" stopColor={m} />
            <stop offset="1" stopColor={d} />
          </linearGradient>
        ))}
      </defs>
      <g className="ladders">
        {ladders.map((p) => (
          <Ladder key={p.id} portal={p} active={active?.id === p.id} />
        ))}
      </g>
      <g className="snakes">
        {snakes.map((p, i) => (
          <Snake key={p.id} portal={p} index={i} active={active?.id === p.id} />
        ))}
      </g>
    </svg>
  );
}

export const SnakesAndLaddersLayer = memo(SnakesAndLaddersLayerImpl);
export default SnakesAndLaddersLayer;

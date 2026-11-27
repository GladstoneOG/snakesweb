/**
 * Board geometry helpers shared by the SVG snakes/ladders layer, pawn layer and move animator.
 * All coordinates are in board-percent space (0..100), matching `getTileCoords`.
 */
import { getTileCoords, PAWN_PALETTES } from '@engine/boards';
import type { PawnColorId, PortalLink } from '@engine/types';

export interface Pt {
  x: number;
  y: number;
}

export function tileCenter(tile: number): Pt {
  const c = getTileCoords(tile);
  return { x: c.x, y: c.y };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const ptStr = (p: Pt) => `${fmt(p.x)} ${fmt(p.y)}`;

/** Catmull-Rom spline through points, emitted as cubic Bézier `C` segments (no leading M). */
export function bezierSegments(points: Pt[], tension = 1): string {
  if (points.length < 2) return '';
  let d = '';
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension };
    d += ` C ${ptStr(c1)} ${ptStr(c2)} ${ptStr(p2)}`;
  }
  return d;
}

export function smoothPath(points: Pt[]): string {
  if (!points.length) return '';
  return `M ${ptStr(points[0])}${bezierSegments(points)}`;
}

/** Arc-length parameterised polyline sampler. */
export class PolylineSampler {
  private readonly pts: Pt[];
  private readonly cum: number[];
  readonly length: number;

  constructor(points: Pt[]) {
    this.pts = points.length ? points : [{ x: 0, y: 0 }];
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  at(t: number): Pt {
    const pts = this.pts;
    if (pts.length === 1 || this.length === 0) return { ...pts[0] };
    const target = clamp(t, 0, 1) * this.length;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < target) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const k = (target - this.cum[lo]) / seg;
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * k, y: pts[lo].y + (pts[hi].y - pts[lo].y) * k };
  }
}

/* ------------------------------------------------------------------ */
/* Snakes                                                              */
/* ------------------------------------------------------------------ */

export interface SnakeVariant {
  name: string;
  body: string;
  bodyLight: string;
  bodyDark: string;
  belly: string;
  pattern: string;
  pattern2: string;
  eye: string;
}

export const SNAKE_VARIANTS: SnakeVariant[] = [
  { name: 'Emerald Viper', body: '#2fa35a', bodyLight: '#7fd88a', bodyDark: '#135530', belly: '#d4f0a0', pattern: '#0f4426', pattern2: '#a8e070', eye: '#ffd84a' },
  { name: 'Coral King Snake', body: '#e2513b', bodyLight: '#ff8f72', bodyDark: '#7d1f14', belly: '#ffe2a8', pattern: '#2a1712', pattern2: '#f6d04d', eye: '#fff1b0' },
  { name: 'Amethyst Cobra', body: '#8e4fd0', bodyLight: '#c79af2', bodyDark: '#3f1a6e', belly: '#ecd9ff', pattern: '#3a1564', pattern2: '#e3c6ff', eye: '#ff6a8a' },
  { name: 'Golden Python', body: '#e0ac34', bodyLight: '#ffe08a', bodyDark: '#7c5210', belly: '#fff2c4', pattern: '#6b3e0e', pattern2: '#fff0b0', eye: '#e8422c' },
];

export function snakeVariant(p: PortalLink): SnakeVariant {
  const i = ((p.styleVariant % 4) + 4) % 4;
  return SNAKE_VARIANTS[i];
}

export interface SnakeGeometry {
  spine: Pt[];
  spinePath: string;
  bodyPath: string;
  head: Pt;
  headAngle: number;
  tail: Pt;
  sampler: PolylineSampler;
}

const snakeCache = new Map<string, SnakeGeometry>();

export function getSnakeGeometry(p: PortalLink): SnakeGeometry {
  const key = `${p.id}:${p.from}:${p.to}:${p.styleVariant}`;
  const hit = snakeCache.get(key);
  if (hit) return hit;

  const A = tileCenter(p.from); // head
  const B = tileCenter(p.to); // tail
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const L = Math.hypot(dx, dy) || 1;
  const d = { x: dx / L, y: dy / L };
  const n = { x: -d.y, y: d.x };
  const rnd = seededRandom(hashString(p.id + ':' + p.from + ':' + p.to));
  const waves = clamp(Math.round(L / 13) + 1, 2, 5);
  const amp = Math.min(3.4, 1.5 + L * 0.045) * (rnd() < 0.5 ? -1 : 1);
  const bow = (rnd() - 0.5) * Math.min(L * 0.22, 9);
  const N = 44;

  const spine: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const env = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI * t), 0.6);
    const off = amp * Math.sin(t * waves * Math.PI) * env + bow * Math.sin(Math.PI * t);
    spine.push({
      x: clamp(A.x + d.x * L * t + n.x * off, 1.5, 98.5),
      y: clamp(A.y + d.y * L * t + n.y * off, 1.5, 98.5),
    });
  }

  // Width profile: thick behind the head, tapering to a pointed tail.
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(N, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const neck = t < 0.07 ? 0.82 + 0.18 * (t / 0.07) : 1;
    const w = (0.35 + 2.55 * Math.pow(1 - t, 0.7)) * neck;
    left.push({ x: spine[i].x + nx * (w / 2), y: spine[i].y + ny * (w / 2) });
    right.push({ x: spine[i].x - nx * (w / 2), y: spine[i].y - ny * (w / 2) });
  }
  const last = spine[N];
  const before = spine[N - 1];
  const el = Math.hypot(last.x - before.x, last.y - before.y) || 1;
  const tip = { x: last.x + ((last.x - before.x) / el) * 1.1, y: last.y + ((last.y - before.y) / el) * 1.1 };
  const leftPts = [...left, tip];
  const rightRev = [tip, ...right.reverse()];
  const bodyPath = `M ${ptStr(leftPts[0])}${bezierSegments(leftPts)} L ${ptStr(rightRev[0])}${bezierSegments(rightRev)} Z`;

  const h0 = spine[0];
  const h1 = spine[2];
  const headAngle = (Math.atan2(h0.y - h1.y, h0.x - h1.x) * 180) / Math.PI;

  const geom: SnakeGeometry = {
    spine,
    spinePath: smoothPath(spine),
    bodyPath,
    head: h0,
    headAngle,
    tail: tip,
    sampler: new PolylineSampler(spine),
  };
  snakeCache.set(key, geom);
  return geom;
}

/* ------------------------------------------------------------------ */
/* Ladders                                                             */
/* ------------------------------------------------------------------ */

export interface LadderVariant {
  name: string;
  rail: string;
  railLight: string;
  railDark: string;
  rung: string;
  bamboo: boolean;
}

export const LADDER_VARIANTS: LadderVariant[] = [
  { name: 'Cedar', rail: '#b9743f', railLight: '#e7a96c', railDark: '#6e3c18', rung: '#c98a52', bamboo: false },
  { name: 'Bamboo', rail: '#c9b04f', railLight: '#f0dc86', railDark: '#7a6620', rung: '#d8c06a', bamboo: true },
  { name: 'Birch', rail: '#e2d2b0', railLight: '#fff6e0', railDark: '#9a8460', rung: '#ead9b5', bamboo: false },
  { name: 'Painted Oak', rail: '#c0503c', railLight: '#ee8a6f', railDark: '#6c2318', rung: '#e7c072', bamboo: false },
];

export function ladderVariant(p: PortalLink): LadderVariant {
  const i = ((p.styleVariant % 4) + 4) % 4;
  return LADDER_VARIANTS[i];
}

export interface LadderGeometry {
  railA: [Pt, Pt];
  railB: [Pt, Pt];
  rungs: [Pt, Pt][];
  bottom: Pt;
  top: Pt;
  angle: number;
  sampler: PolylineSampler;
}

const ladderCache = new Map<string, LadderGeometry>();

export function getLadderGeometry(p: PortalLink): LadderGeometry {
  const key = `${p.id}:${p.from}:${p.to}`;
  const hit = ladderCache.get(key);
  if (hit) return hit;
  const A = tileCenter(p.from);
  const B = tileCenter(p.to);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const L = Math.hypot(dx, dy) || 1;
  const d = { x: dx / L, y: dy / L };
  const n = { x: -d.y, y: d.x };
  const ext = 1.4;
  const half = 1.65;
  const a = { x: A.x - d.x * ext, y: A.y - d.y * ext };
  const b = { x: B.x + d.x * ext, y: B.y + d.y * ext };
  const railA: [Pt, Pt] = [
    { x: a.x + n.x * half, y: a.y + n.y * half },
    { x: b.x + n.x * half, y: b.y + n.y * half },
  ];
  const railB: [Pt, Pt] = [
    { x: a.x - n.x * half, y: a.y - n.y * half },
    { x: b.x - n.x * half, y: b.y - n.y * half },
  ];
  const total = L + ext * 2;
  const count = Math.max(2, Math.floor(total / 2.5));
  const rungs: [Pt, Pt][] = [];
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count;
    const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    rungs.push([
      { x: c.x + n.x * half, y: c.y + n.y * half },
      { x: c.x - n.x * half, y: c.y - n.y * half },
    ]);
  }
  const geom: LadderGeometry = {
    railA,
    railB,
    rungs,
    bottom: A,
    top: B,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    sampler: new PolylineSampler([A, B]),
  };
  ladderCache.set(key, geom);
  return geom;
}

/* ------------------------------------------------------------------ */
/* Pawn clustering                                                     */
/* ------------------------------------------------------------------ */

const CLUSTER_OFFSETS: Pt[][] = [
  [{ x: 0, y: 0 }],
  [{ x: -1.9, y: 0.2 }, { x: 1.9, y: -0.2 }],
  [{ x: -1.9, y: 1.1 }, { x: 1.9, y: 1.1 }, { x: 0, y: -1.5 }],
  [{ x: -1.9, y: -1.3 }, { x: 1.9, y: -1.3 }, { x: -1.9, y: 1.6 }, { x: 1.9, y: 1.6 }],
  [{ x: -2.2, y: -1.4 }, { x: 2.2, y: -1.4 }, { x: 0, y: 0 }, { x: -2.2, y: 1.7 }, { x: 2.2, y: 1.7 }],
  [{ x: -2.4, y: -1.4 }, { x: 0, y: -1.6 }, { x: 2.4, y: -1.4 }, { x: -2.4, y: 1.6 }, { x: 0, y: 1.8 }, { x: 2.4, y: 1.6 }],
];

export function computePawnPositions(
  players: { id: string }[],
  tiles: Record<string, number>,
): Record<string, Pt> {
  const groups = new Map<number, string[]>();
  for (const p of players) {
    const t = tiles[p.id] ?? 0;
    const g = groups.get(t);
    if (g) g.push(p.id);
    else groups.set(t, [p.id]);
  }
  const out: Record<string, Pt> = {};
  groups.forEach((ids, tile) => {
    const c = tileCenter(tile);
    const offs = CLUSTER_OFFSETS[Math.min(ids.length, 6) - 1];
    ids.forEach((id, i) => {
      const o = offs[i % offs.length];
      const scale = tile === 0 ? 1.15 : 1;
      out[id] = { x: c.x + o.x * scale, y: c.y + o.y * scale };
    });
  });
  return out;
}

export function paletteOf(color: PawnColorId) {
  return (
    PAWN_PALETTES[color] ?? { label: color, primary: '#888', dark: '#444', light: '#ccc', glow: 'rgba(255,255,255,0.5)' }
  );
}

export const EMOTE_GLYPHS: Record<string, string> = {
  dice: '🎲',
  snake: '🐍',
  ladder: '🚀',
  laugh: '😂',
  fire: '🔥',
  cry: '😭',
  clap: '👏',
  crown: '👑',
};

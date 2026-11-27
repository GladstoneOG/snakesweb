import type { BoardPresetId, GameRules, PawnColorId, PortalLink } from './types';

export interface TileCoord {
  tile: number;
  x: number;
  y: number;
  row: number;
  col: number;
  direction: 'right' | 'left';
}

export const PAWN_COLOR_ORDER: readonly PawnColorId[] = [
  'ruby',
  'sapphire',
  'emerald',
  'amber',
  'plum',
  'teal',
] as const;

export const PAWN_PALETTES: Record<
  PawnColorId,
  { label: string; primary: string; dark: string; light: string; glow: string }
> = {
  ruby: {
    label: 'Ruby',
    primary: '#e11d48',
    dark: '#881337',
    light: '#fda4af',
    glow: 'rgba(225, 29, 72, 0.5)',
  },
  sapphire: {
    label: 'Sapphire',
    primary: '#2563eb',
    dark: '#1e3a8a',
    light: '#93c5fd',
    glow: 'rgba(37, 99, 235, 0.5)',
  },
  emerald: {
    label: 'Emerald',
    primary: '#059669',
    dark: '#064e3b',
    light: '#6ee7b7',
    glow: 'rgba(5, 150, 105, 0.5)',
  },
  amber: {
    label: 'Amber',
    primary: '#d97706',
    dark: '#78350f',
    light: '#fcd34d',
    glow: 'rgba(217, 119, 6, 0.52)',
  },
  plum: {
    label: 'Plum',
    primary: '#9333ea',
    dark: '#581c87',
    light: '#d8b4fe',
    glow: 'rgba(147, 51, 234, 0.5)',
  },
  teal: {
    label: 'Teal',
    primary: '#0d9488',
    dark: '#134e4a',
    light: '#5eead4',
    glow: 'rgba(13, 148, 136, 0.5)',
  },
};

export const DEFAULT_RULES: GameRules = {
  boardPreset: 'classic',
  exactFinishBounce: true,
  extraRollOnSix: true,
  tripleSixPenalty: true,
  enableBump: true,
  turnDuration: 15,
};

/**
 * Returns percentage coordinates (0..100) for a 10x10 serpentine Snakes & Ladders board.
 * - Tile 1 is bottom-left (x=5, y=95), going right to Tile 10 (x=95, y=95).
 * - Tile 11 is (x=95, y=85), going left to Tile 20 (x=5, y=85).
 * - Tile 100 is top-left (x=5, y=5).
 * - Tile 0 is centered on Tile 1 (x=5, y=95) so starting pawns sit cleanly inside Tile 1.
 */
export function getTileCoords(tile: number): TileCoord {
  if (tile <= 0) {
    return {
      tile: 0,
      x: 5,
      y: 95,
      row: 0,
      col: 0,
      direction: 'right',
    };
  }

  const clamped = Math.min(100, Math.floor(tile));
  const index = clamped - 1;
  const row = Math.floor(index / 10);
  const isEvenRow = row % 2 === 0;
  const col = isEvenRow ? index % 10 : 9 - (index % 10);

  return {
    tile: clamped,
    x: col * 10 + 5,
    y: (9 - row) * 10 + 5,
    row,
    col,
    direction: isEvenRow ? 'right' : 'left',
  };
}

const CLASSIC_PORTALS: readonly PortalLink[] = [
  // 8 balanced ladders
  { id: 'L1', type: 'ladder', from: 4, to: 14, styleVariant: 0 },
  { id: 'L2', type: 'ladder', from: 9, to: 31, styleVariant: 1 },
  { id: 'L3', type: 'ladder', from: 21, to: 42, styleVariant: 2 },
  { id: 'L4', type: 'ladder', from: 28, to: 84, styleVariant: 3 },
  { id: 'L5', type: 'ladder', from: 36, to: 57, styleVariant: 0 },
  { id: 'L6', type: 'ladder', from: 51, to: 67, styleVariant: 1 },
  { id: 'L7', type: 'ladder', from: 71, to: 91, styleVariant: 2 },
  { id: 'L8', type: 'ladder', from: 80, to: 99, styleVariant: 3 },
  // 8 classic snakes
  { id: 'S1', type: 'snake', from: 98, to: 79, styleVariant: 0 },
  { id: 'S2', type: 'snake', from: 95, to: 75, styleVariant: 1 },
  { id: 'S3', type: 'snake', from: 93, to: 73, styleVariant: 2 },
  { id: 'S4', type: 'snake', from: 87, to: 24, styleVariant: 3 },
  { id: 'S5', type: 'snake', from: 64, to: 60, styleVariant: 0 },
  { id: 'S6', type: 'snake', from: 62, to: 19, styleVariant: 1 },
  { id: 'S7', type: 'snake', from: 54, to: 34, styleVariant: 2 },
  { id: 'S8', type: 'snake', from: 17, to: 7, styleVariant: 3 },
];

const SERPENTS_DEN_PORTALS: readonly PortalLink[] = [
  // 8 high-volatility comeback ladders
  { id: 'DL1', type: 'ladder', from: 3, to: 38, styleVariant: 0 },
  { id: 'DL2', type: 'ladder', from: 8, to: 45, styleVariant: 1 },
  { id: 'DL3', type: 'ladder', from: 15, to: 56, styleVariant: 2 },
  { id: 'DL4', type: 'ladder', from: 22, to: 78, styleVariant: 3 },
  { id: 'DL5', type: 'ladder', from: 34, to: 86, styleVariant: 0 },
  { id: 'DL6', type: 'ladder', from: 49, to: 90, styleVariant: 1 },
  { id: 'DL7', type: 'ladder', from: 61, to: 94, styleVariant: 2 },
  { id: 'DL8', type: 'ladder', from: 74, to: 96, styleVariant: 3 },
  // 9 treacherous snakes including the iconic 99 -> 12 plunge
  { id: 'DS1', type: 'snake', from: 99, to: 12, styleVariant: 0 },
  { id: 'DS2', type: 'snake', from: 97, to: 41, styleVariant: 1 },
  { id: 'DS3', type: 'snake', from: 92, to: 52, styleVariant: 2 },
  { id: 'DS4', type: 'snake', from: 88, to: 27, styleVariant: 3 },
  { id: 'DS5', type: 'snake', from: 83, to: 31, styleVariant: 0 },
  { id: 'DS6', type: 'snake', from: 77, to: 18, styleVariant: 1 },
  { id: 'DS7', type: 'snake', from: 68, to: 25, styleVariant: 2 },
  { id: 'DS8', type: 'snake', from: 59, to: 16, styleVariant: 3 },
  { id: 'DS9', type: 'snake', from: 44, to: 6, styleVariant: 1 },
];

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createMulberry32(seedNum: number): () => number {
  let a = seedNum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileRow(tile: number): number {
  return Math.floor((tile - 1) / 10);
}

function generateShuffledPortals(seed: string): PortalLink[] {
  const rand = createMulberry32(hashSeed(`snakesweb:${seed || 'default'}`));
  const used = new Set<number>([1, 100]);
  const portals: PortalLink[] = [];

  const randInt = (min: number, max: number) =>
    min + Math.floor(rand() * (max - min + 1));

  // 8 balanced ladders across zoned starting bands
  const ladderBands: Array<[number, number, number, number]> = [
    [2, 10, 14, 34],
    [8, 19, 24, 48],
    [16, 29, 36, 62],
    [24, 39, 48, 84],
    [35, 49, 56, 78],
    [45, 59, 66, 88],
    [56, 72, 76, 95],
    [68, 84, 86, 99],
  ];

  for (let i = 0; i < ladderBands.length; i++) {
    const [fromMin, fromMax, toMin, toMax] = ladderBands[i];
    let placed = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const from = randInt(fromMin, fromMax);
      const to = randInt(Math.max(toMin, from + 10), toMax);
      if (from < 2 || to > 99 || from >= to) continue;
      if (used.has(from) || used.has(to)) continue;
      if (tileRow(to) - tileRow(from) < 1) continue;
      used.add(from);
      used.add(to);
      portals.push({
        id: `RL${i + 1}`,
        type: 'ladder',
        from,
        to,
        styleVariant: i % 4,
      });
      placed = true;
      break;
    }
    if (!placed) {
      // Fallback scan guaranteeing 8 ladders with unique endpoints and row span >= 1
      outer: for (let from = 2; from <= 88; from++) {
        if (used.has(from)) continue;
        for (let to = from + 11; to <= 99; to++) {
          if (used.has(to)) continue;
          if (tileRow(to) - tileRow(from) < 1) continue;
          used.add(from);
          used.add(to);
          portals.push({
            id: `RL${i + 1}`,
            type: 'ladder',
            from,
            to,
            styleVariant: i % 4,
          });
          break outer;
        }
      }
    }
  }

  // 8 balanced snakes across zoned head bands
  const snakeBands: Array<[number, number, number, number]> = [
    [94, 99, 62, 82],
    [86, 97, 45, 75],
    [78, 92, 24, 64],
    [68, 84, 28, 56],
    [56, 74, 18, 46],
    [45, 64, 14, 36],
    [32, 52, 8, 25],
    [16, 34, 2, 12],
  ];

  for (let i = 0; i < snakeBands.length; i++) {
    const [fromMin, fromMax, toMin, toMax] = snakeBands[i];
    let placed = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const from = randInt(fromMin, fromMax);
      const to = randInt(toMin, Math.min(toMax, from - 10));
      if (from > 99 || to < 2 || from <= to) continue;
      if (used.has(from) || used.has(to)) continue;
      if (tileRow(from) - tileRow(to) < 1) continue;
      used.add(from);
      used.add(to);
      portals.push({
        id: `RS${i + 1}`,
        type: 'snake',
        from,
        to,
        styleVariant: i % 4,
      });
      placed = true;
      break;
    }
    if (!placed) {
      outer: for (let from = 99; from >= 13; from--) {
        if (used.has(from)) continue;
        for (let to = from - 11; to >= 2; to--) {
          if (used.has(to)) continue;
          if (tileRow(from) - tileRow(to) < 1) continue;
          used.add(from);
          used.add(to);
          portals.push({
            id: `RS${i + 1}`,
            type: 'snake',
            from,
            to,
            styleVariant: i % 4,
          });
          break outer;
        }
      }
    }
  }

  return portals;
}

export function getPortalsForRules(preset: BoardPresetId, seed: string): PortalLink[] {
  switch (preset) {
    case 'serpents_den':
      return SERPENTS_DEN_PORTALS.map((p) => ({ ...p }));
    case 'shuffled':
      return generateShuffledPortals(seed);
    case 'classic':
    default:
      return CLASSIC_PORTALS.map((p) => ({ ...p }));
  }
}

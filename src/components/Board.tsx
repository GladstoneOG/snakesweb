import { memo, useMemo, forwardRef, type ReactNode } from 'react';
import { getTileCoords } from '@engine/boards';
import type { PortalLink, SanitizedPlayer } from '@engine/types';
import { SnakesAndLaddersLayer, type ActivePortal } from './SnakesAndLaddersLayer';
import { PawnLayer, type PawnRefMap } from './PawnLayer';
import { Crown, Sparkles } from 'lucide-react';

export interface FxItem {
  id: string;
  kind: 'sparkle' | 'callout' | 'banner' | 'dust';
  x: number;
  y: number;
  text?: string;
  tone?: 'good' | 'bad' | 'epic' | 'neutral' | 'gold';
}

const TILE_TONES = ['sage', 'terracotta', 'sky'] as const;

function tileClass(tile: number, row: number, col: number): string {
  if (tile === 100) return 'tile tile-crown';
  if (tile === 25 || tile === 50 || tile === 75) return 'tile tile-gold';
  if ((row + col) % 2 === 0) return `tile tile-ivory${row % 2 ? ' tile-ivory-alt' : ''}`;
  const tone = TILE_TONES[(Math.floor((row * 10 + col) / 2) + row) % 3];
  return `tile tile-${tone}`;
}

const TileGrid = memo(function TileGrid({ portals }: { portals: PortalLink[] }) {
  const portalStarts = useMemo(() => {
    const m = new Map<number, 'snake' | 'ladder'>();
    for (const p of portals) m.set(p.from, p.type);
    return m;
  }, [portals]);

  const tiles = useMemo(() => Array.from({ length: 100 }, (_, i) => getTileCoords(i + 1)), []);
  const start = useMemo(() => getTileCoords(0), []);

  return (
    <div className="tile-grid">
      {tiles.map((c) => {
        const mark = portalStarts.get(c.tile);
        const turn = c.tile % 10 === 0 && c.tile < 100;
        return (
          <div
            key={c.tile}
            className={`${tileClass(c.tile, c.row, c.col)}${mark ? ` has-${mark}` : ''}`}
            style={{ left: `${c.x - 5}%`, top: `${c.y - 5}%` }}
          >
            <span className="tile-num">{c.tile}</span>
            {c.tile === 100 && (
              <span className="tile-crown-icon">
                <Crown />
              </span>
            )}
            {(c.tile === 25 || c.tile === 50 || c.tile === 75) && (
              <span className="tile-gold-icon">
                <Sparkles />
              </span>
            )}
            {turn && <span className="tile-chevron">▲</span>}
          </div>
        );
      })}
      <div className="start-pad" style={{ left: `${start.x}%`, top: `${start.y}%` }}>
        <span>START</span>
      </div>
    </div>
  );
});

interface BoardProps {
  portals: PortalLink[];
  players: SanitizedPlayer[];
  activeId: string | null;
  activePortal: ActivePortal | null;
  pawnRefs: { current: PawnRefMap };
  dizzyIds: string[];
  fx: FxItem[];
  overlay?: ReactNode;
}

export const Board = forwardRef<HTMLDivElement, BoardProps>(function Board(
  { portals, players, activeId, activePortal, pawnRefs, dizzyIds, fx, overlay },
  ref,
) {
  return (
    <div className="board-frame">
      <div className="board-frame-inlay" />
      <div className="board-surface" ref={ref}>
        <TileGrid portals={portals} />
        <SnakesAndLaddersLayer portals={portals} active={activePortal} />
        <PawnLayer players={players} activeId={activeId} refs={pawnRefs} dizzyIds={dizzyIds} />
        <div className="fx-layer" aria-hidden="true">
          {fx.map((item) => {
            const style = { left: `${item.x}%`, top: `${item.y}%` };
            if (item.kind === 'sparkle') {
              return (
                <div key={item.id} className={`fx-sparkle fx-${item.tone ?? 'gold'}`} style={style}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <i key={i} style={{ ['--a' as string]: `${i * 36}deg`, ['--d' as string]: `${(i % 3) * 40}ms` }} />
                  ))}
                </div>
              );
            }
            if (item.kind === 'dust') {
              return (
                <div key={item.id} className="fx-dust" style={style}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <i key={i} style={{ ['--a' as string]: `${i * 60 + 15}deg` }} />
                  ))}
                </div>
              );
            }
            if (item.kind === 'banner') {
              return (
                <div key={item.id} className={`fx-banner fx-${item.tone ?? 'gold'}`}>
                  <span>{item.text}</span>
                </div>
              );
            }
            return (
              <div key={item.id} className={`fx-callout fx-${item.tone ?? 'neutral'}`} style={style}>
                <span>{item.text}</span>
              </div>
            );
          })}
        </div>
        {overlay}
      </div>
    </div>
  );
});

export default Board;

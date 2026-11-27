import { useMemo } from 'react';
import { Crown, RotateCcw, Home, Sparkles, Flame, ShieldAlert, TrendingUp, Dices } from 'lucide-react';
import type { ClientIntent, SanitizedPlayer, SanitizedRoomState } from '@engine/types';
import { PawnToken } from './PawnLayer';
import { paletteOf } from './geometry';
import { sfx } from './platform';

export interface VictoryModalProps {
  room: SanitizedRoomState;
  open: boolean;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
}

interface Superlative {
  key: string;
  title: string;
  player: SanitizedPlayer;
  detail: string;
  tone: 'good' | 'bad' | 'epic' | 'brass';
}

function buildSuperlatives(players: SanitizedPlayer[]): Superlative[] {
  if (!players.length) return [];
  const out: Superlative[] = [];

  const topClimber = [...players].sort((a, b) => b.stats.laddersClimbed - a.stats.laddersClimbed)[0];
  if (topClimber && topClimber.stats.laddersClimbed > 0) {
    out.push({
      key: 'climber',
      title: 'Sky Climber',
      player: topClimber,
      detail: `${topClimber.stats.laddersClimbed} ladder${topClimber.stats.laddersClimbed === 1 ? '' : 's'} climbed`,
      tone: 'good',
    });
  }

  const snakeMagnet = [...players].sort((a, b) => b.stats.snakesBitten - a.stats.snakesBitten)[0];
  if (snakeMagnet && snakeMagnet.stats.snakesBitten > 0) {
    out.push({
      key: 'snakes',
      title: 'Serpent Magnet',
      player: snakeMagnet,
      detail: `Bitten ${snakeMagnet.stats.snakesBitten} time${snakeMagnet.stats.snakesBitten === 1 ? '' : 's'}`,
      tone: 'bad',
    });
  }

  const sixRoller = [...players].sort((a, b) => b.stats.sixes - a.stats.sixes)[0];
  if (sixRoller && sixRoller.stats.sixes > 0) {
    out.push({
      key: 'sixes',
      title: 'Lucky Sixes',
      player: sixRoller,
      detail: `${sixRoller.stats.sixes} six${sixRoller.stats.sixes === 1 ? '' : 'es'} rolled`,
      tone: 'brass',
    });
  }

  const bumper = [...players].sort((a, b) => b.stats.bumpsGiven - a.stats.bumpsGiven)[0];
  if (bumper && bumper.stats.bumpsGiven > 0) {
    out.push({
      key: 'bumps',
      title: 'Bumper Champion',
      player: bumper,
      detail: `${bumper.stats.bumpsGiven} rival${bumper.stats.bumpsGiven === 1 ? '' : 's'} bumped`,
      tone: 'epic',
    });
  }

  return out.slice(0, 4);
}

export function VictoryModal({ room, open, onIntent, onLeave }: VictoryModalProps) {
  const viewer = useMemo(
    () => room.players.find((p) => p.id === room.viewerId) ?? null,
    [room.players, room.viewerId],
  );
  const canManage = !viewer || viewer.isHost || room.mode !== 'multiplayer';

  const ranked = useMemo(() => {
    const byId = new Map(room.players.map((p) => [p.id, p]));
    const ordered: SanitizedPlayer[] = [];
    for (const id of room.podium) {
      const p = byId.get(id);
      if (p) {
        ordered.push(p);
        byId.delete(id);
      }
    }
    const rest = [...byId.values()].sort((a, b) => b.tile - a.tile);
    return [...ordered, ...rest];
  }, [room.players, room.podium]);

  const winner =
    room.players.find((p) => p.id === room.winnerId) ?? ranked[0] ?? null;

  const superlatives = useMemo(() => buildSuperlatives(room.players), [room.players]);

  if (!open || !winner) return null;

  // Visual podium ordering: 2nd (left), 1st (center), 3rd (right)
  const podiumSlots = [
    ranked[1] ? { rank: 2, player: ranked[1] } : null,
    ranked[0] ? { rank: 1, player: ranked[0] } : null,
    ranked[2] ? { rank: 3, player: ranked[2] } : null,
  ].filter(Boolean) as { rank: 1 | 2 | 3; player: SanitizedPlayer }[];

  const winnerPal = paletteOf(winner.color);

  return (
    <div className="modal-backdrop victory-backdrop" role="dialog" aria-modal="true" aria-labelledby="victory-title">
      <div className="modal panel victory-modal">
        <div className="victory-hero">
          <div className="victory-crown-badge" aria-hidden="true">
            <Crown />
          </div>
          <p className="victory-kicker">Match #{room.matchNumber} Complete</p>
          <h2 id="victory-title" className="victory-title">
            {winner.name} Wins!
          </h2>
          <p className="victory-sub">
            Reached tile 100 in {room.turnNumber} turn{room.turnNumber === 1 ? '' : 's'} &bull;{' '}
            <strong style={{ color: winnerPal.dark }}>
              {winner.wins} total win{winner.wins === 1 ? '' : 's'}
            </strong>
          </p>
        </div>

        <div className="podium" aria-label="Final podium">
          {podiumSlots.map(({ rank, player }) => {
            const pal = paletteOf(player.color);
            return (
              <div
                key={player.id}
                className={`podium-col podium-rank-${rank}`}
                style={{ ['--pc' as string]: pal.primary }}
              >
                <div className="podium-pawn">
                  <PawnToken
                    color={player.color}
                    size={rank === 1 ? 46 : 36}
                    initial={player.name.trim().charAt(0).toUpperCase()}
                  />
                </div>
                <div className="podium-name" title={player.name}>
                  {player.name}
                </div>
                <div className="podium-tile">Tile {player.tile}</div>
                <div className="podium-step">
                  <span className="podium-medal">{rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {ranked.length > 3 && (
          <div className="victory-others">
            {ranked.slice(3).map((p, idx) => (
              <div key={p.id} className="victory-other-row">
                <span className="victory-other-rank">#{idx + 4}</span>
                <span
                  className="avatar victory-mini-avatar"
                  style={{ ['--c' as string]: paletteOf(p.color).primary }}
                >
                  {p.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="grow">{p.name}</span>
                <span className="chip">Tile {p.tile}</span>
              </div>
            ))}
          </div>
        )}

        {superlatives.length > 0 && (
          <div className="victory-awards">
            <div className="panel-title">
              <Sparkles size={16} />
              <span>Match Highlights</span>
            </div>
            <div className="awards-grid">
              {superlatives.map((s) => (
                <div key={s.key} className={`award-card award-${s.tone}`}>
                  <div className="award-icon">
                    {s.key === 'climber' && <TrendingUp size={16} />}
                    {s.key === 'snakes' && <ShieldAlert size={16} />}
                    {s.key === 'sixes' && <Dices size={16} />}
                    {s.key === 'bumps' && <Flame size={16} />}
                  </div>
                  <div className="award-body">
                    <div className="award-title">{s.title}</div>
                    <div className="award-player">{s.player.name}</div>
                    <div className="award-detail">{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="victory-actions">
          {canManage ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-lg grow"
                onClick={() => {
                  sfx.buttonClick();
                  onIntent({ type: 'REMATCH' });
                }}
              >
                <RotateCcw />
                <span>Rematch</span>
              </button>
              <button
                type="button"
                className="btn btn-wood"
                onClick={() => {
                  sfx.buttonClick();
                  onIntent({ type: 'RETURN_TO_LOBBY' });
                }}
              >
                <Home />
                <span>Lobby</span>
              </button>
            </>
          ) : (
            <div className="victory-wait">
              <span>Waiting for host to start a rematch or return to lobby…</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  sfx.buttonClick();
                  onLeave();
                }}
              >
                Leave
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default VictoryModal;

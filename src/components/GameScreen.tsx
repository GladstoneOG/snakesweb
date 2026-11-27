import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Bot,
  Crown,
  LogOut,
  ScrollText,
  Sparkles,
  TriangleAlert,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import type {
  ClientIntent,
  EmoteId,
  SanitizedPlayer,
  SanitizedRoomState,
  TurnMoveEvent,
} from '@engine/types';
import type { LocalTransportState } from '@net/session';
import { Board, type FxItem } from './Board';
import { DiceTray, type DiceTrayHandle } from './DiceTray';
import { EmoteBar } from './EmoteBar';
import { Confetti } from './Confetti';
import { VictoryModal } from './VictoryModal';
import { SettingsMenu } from './SettingsMenu';
import type { PawnRefMap } from './PawnLayer';
import type { ActivePortal } from './SnakesAndLaddersLayer';
import {
  computePawnPositions,
  EMOTE_GLYPHS,
  getLadderGeometry,
  getSnakeGeometry,
  paletteOf,
  tileCenter,
  type Pt,
} from './geometry';
import { haptics, music, reducedMotion, sfx } from './platform';

export interface GameScreenProps {
  room: SanitizedRoomState;
  transport: LocalTransportState;
  error: string | null;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
}

interface FloatingEmote {
  id: string;
  playerId: string;
  emote: EmoteId;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

function setAnchorPos(refs: PawnRefMap, playerId: string, pt: Pt) {
  const entry = refs[playerId];
  if (!entry?.anchor) return;
  entry.anchor.style.transform = `translate3d(${(pt.x * 10 - 50).toFixed(2)}%, ${(pt.y * 10 - 50).toFixed(2)}%, 0)`;
}

function resetPawnMotion(refs: PawnRefMap, playerId: string) {
  const entry = refs[playerId];
  if (!entry) return;
  entry.anchor?.classList.remove('is-moving');
  if (entry.lift) entry.lift.style.transform = 'translate3d(0, 0, 0)';
  if (entry.token) entry.token.style.transform = 'scale(1, 1)';
}

function triggerRipple(refs: PawnRefMap, playerId: string) {
  const r = refs[playerId]?.ripple;
  if (!r) return;
  r.classList.remove('is-popping');
  // force reflow to restart animation
  void r.offsetWidth;
  r.classList.add('is-popping');
}

function animateRaf(
  durationMs: number,
  isCancelled: () => boolean,
  onFrame: (t: number) => void,
): Promise<void> {
  if (durationMs <= 16 || reducedMotion()) {
    if (!isCancelled()) onFrame(1);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      if (isCancelled()) {
        resolve();
        return;
      }
      const t = Math.max(0, Math.min(1, (now - start) / durationMs));
      onFrame(t);
      if (t < 1) {
        window.requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    window.requestAnimationFrame(tick);
  });
}

export function GameScreen({ room, transport, error, onIntent, onLeave }: GameScreenProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const diceRef = useRef<DiceTrayHandle | null>(null);
  const pawnRefs = useRef<PawnRefMap>({});
  const visualTilesRef = useRef<Record<string, number>>({});
  const prevSeqRef = useRef<number | null>(null);
  const animTokenRef = useRef(0);
  const roomRef = useRef(room);
  roomRef.current = room;

  const [animating, setAnimating] = useState(false);
  const [completedSeq, setCompletedSeq] = useState<number>(() => room.lastMove?.seq ?? 0);
  const [visualTiles, setVisualTiles] = useState<Record<string, number>>(() =>
    Object.fromEntries(room.players.map((p) => [p.id, p.tile])),
  );
  const [rollPending, setRollPending] = useState(false);
  const [activePortal, setActivePortal] = useState<ActivePortal | null>(null);
  const [dizzyIds, setDizzyIds] = useState<string[]>([]);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [showVictory, setShowVictory] = useState(() => room.phase === 'gameover');
  const [showConfetti, setShowConfetti] = useState(false);
  const [floatingEmotes, setFloatingEmotes] = useState<FloatingEmote[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const fxSeqRef = useRef(0);
  const lastEmoteIdRef = useRef<string | null>(room.lastEmote?.id ?? null);
  const serverOffsetRef = useRef(room.serverNow - Date.now());
  serverOffsetRef.current = room.serverNow - Date.now();

  // Switch tabletop music to game scene
  useEffect(() => {
    music.setScene('game');
  }, []);

  const viewer = useMemo(
    () => room.players.find((p) => p.id === room.viewerId) ?? null,
    [room.players, room.viewerId],
  );
  const activePlayer = room.players[room.turnIndex] ?? null;

  // Synchronous render-time lock so pawn halo, roster highlight, timer & HUD
  // never flash to the next player before the current move's animation finishes
  const unplayedMove = room.lastMove && room.lastMove.seq > completedSeq ? room.lastMove : null;
  const isMoveInFlight = Boolean(animating || unplayedMove);
  const activeMovePlayerId = isMoveInFlight ? (room.lastMove?.playerId ?? null) : null;
  const displayTurnPlayer = activeMovePlayerId
    ? (room.players.find((p) => p.id === activeMovePlayerId) ?? activePlayer)
    : activePlayer;

  const isLocalTurn = Boolean(
    room.phase === 'playing' &&
      activePlayer &&
      !activePlayer.isBot &&
      (room.mode === 'couch' || activePlayer.id === room.viewerId),
  );

  const canRoll = isLocalTurn && !isMoveInFlight && !rollPending;

  // Helpers to spawn transient on-board FX
  const pushFx = useCallback((item: Omit<FxItem, 'id'>, ttlMs = 1350) => {
    const id = `fx-${++fxSeqRef.current}`;
    setFx((prev) => [...prev, { ...item, id }]);
    window.setTimeout(() => {
      setFx((prev) => prev.filter((f) => f.id !== id));
    }, ttlMs);
  }, []);

  const shakeBoard = useCallback(() => {
    const el = boardRef.current;
    if (!el || reducedMotion()) return;
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
    window.setTimeout(() => el.classList.remove('is-shaking'), 460);
  }, []);

  // Snap every pawn to a tiles map
  const snapPawns = useCallback((players: SanitizedPlayer[], tilesMap: Record<string, number>) => {
    const pos = computePawnPositions(players, tilesMap);
    for (const p of players) {
      const pt = pos[p.id];
      if (pt) setAnchorPos(pawnRefs.current, p.id, pt);
      resetPawnMotion(pawnRefs.current, p.id);
    }
  }, []);

  // Sync visual tiles & snap on initial mount, rejoin, rematch, or roster changes when idle
  useEffect(() => {
    const nextTiles: Record<string, number> = {};
    for (const p of room.players) nextTiles[p.id] = p.tile;

    if (prevSeqRef.current === null) {
      // Initial mount / rejoin: snap directly without replaying historical move
      const initialSeq = room.lastMove?.seq ?? 0;
      prevSeqRef.current = initialSeq;
      setCompletedSeq(initialSeq);
      visualTilesRef.current = nextTiles;
      setVisualTiles(nextTiles);
      snapPawns(room.players, nextTiles);
      if (room.phase === 'gameover') setShowVictory(true);
      return;
    }

    // Rematch / new game reset
    if (room.lastMove === null) {
      prevSeqRef.current = 0;
      animTokenRef.current++;
      setCompletedSeq(0);
      setAnimating(false);
      setRollPending(false);
      setActivePortal(null);
      setDizzyIds([]);
      setShowVictory(false);
      setShowConfetti(false);
      visualTilesRef.current = nextTiles;
      setVisualTiles(nextTiles);
      snapPawns(room.players, nextTiles);
      return;
    }

    if (!animating && (room.lastMove?.seq ?? 0) <= prevSeqRef.current) {
      visualTilesRef.current = nextTiles;
      setVisualTiles(nextTiles);
      snapPawns(room.players, nextTiles);
      if (room.phase === 'gameover') setShowVictory(true);
    }
  }, [room.players, room.lastMove, room.phase, room.matchNumber, animating, snapPawns]);

  // Turn transition chime when it becomes local player's turn (after move choreography settles)
  const prevTurnKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isMoveInFlight) return;
    const key = `${room.matchNumber}:${room.turnNumber}:${room.turnIndex}:${room.lastMove?.seq ?? 0}`;
    if (prevTurnKeyRef.current === null) {
      prevTurnKeyRef.current = key;
      return;
    }
    if (prevTurnKeyRef.current !== key) {
      prevTurnKeyRef.current = key;
      setRollPending(false);
      if (isLocalTurn) {
        sfx.yourTurn();
        haptics.yourTurn();
      }
    }
  }, [room.matchNumber, room.turnNumber, room.turnIndex, room.lastMove?.seq, isLocalTurn, isMoveInFlight]);

  // Clear pending roll flag if server reports an error
  useEffect(() => {
    if (error) setRollPending(false);
  }, [error]);

  // Floating emotes on room.lastEmote
  useEffect(() => {
    const ev = room.lastEmote;
    if (!ev || ev.id === lastEmoteIdRef.current) return;
    lastEmoteIdRef.current = ev.id;
    if (ev.playerId !== room.viewerId) {
      sfx.emote();
    }
    const item: FloatingEmote = { id: ev.id, playerId: ev.playerId, emote: ev.emote };
    setFloatingEmotes((prev) => [...prev.filter((e) => e.playerId !== ev.playerId), item]);
    const t = window.setTimeout(() => {
      setFloatingEmotes((prev) => prev.filter((e) => e.id !== item.id));
    }, 2400);
    return () => window.clearTimeout(t);
  }, [room.lastEmote, room.viewerId]);

  // Turn countdown ticker + final-5s audio ticks (paused while a move is animating)
  const lastTickSecRef = useRef<number | null>(null);
  useEffect(() => {
    if (isMoveInFlight || !room.turnDeadline || room.rules.turnDuration <= 0 || room.phase !== 'playing') {
      lastTickSecRef.current = null;
      return;
    }
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const remMs = room.turnDeadline! - (now + serverOffsetRef.current);
      const secs = Math.ceil(remMs / 1000);
      if (isLocalTurn && secs >= 1 && secs <= 5 && secs !== lastTickSecRef.current) {
        lastTickSecRef.current = secs;
        sfx.timerTick(secs);
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [room.turnDeadline, room.rules.turnDuration, room.phase, isLocalTurn, isMoveInFlight]);

  // Sequenced Move Animator — watches room.lastMove.seq
  useEffect(() => {
    const move: TurnMoveEvent | null = room.lastMove;
    if (!move || prevSeqRef.current === null || move.seq <= prevSeqRef.current) return;

    prevSeqRef.current = move.seq;
    const token = ++animTokenRef.current;
    const isCancelled = () => animTokenRef.current !== token;

    setAnimating(true);
    setRollPending(false);

    const runSequence = async () => {
      const playersSnapshot = roomRef.current.players;
      // Establish pre-move board state
      const tiles: Record<string, number> = { ...visualTilesRef.current };
      for (const p of playersSnapshot) {
        if (tiles[p.id] === undefined) tiles[p.id] = p.tile;
      }
      tiles[move.playerId] = move.startTile;
      for (const b of move.bumped) {
        tiles[b.playerId] = b.fromTile;
      }
      visualTilesRef.current = { ...tiles };
      setVisualTiles({ ...tiles });
      snapPawns(playersSnapshot, tiles);

      // (a) 3D Dice roll animation
      if (diceRef.current) {
        await diceRef.current.playRoll(move.physicsSeed || `seq-${move.seq}`, move.dice);
      } else {
        sfx.diceLand(move.dice);
        await sleep(320);
      }
      if (isCancelled()) return;
      await sleep(reducedMotion() ? 60 : 120);
      if (isCancelled()) return;

      // (b) Step-by-step parabolic pawn hopping (or triple-six bust)
      if (move.tripleSixBust) {
        sfx.bounceBack();
        pushFx({ kind: 'banner', x: 50, y: 46, text: 'TRIPLE 6 BUST!', tone: 'bad' }, 1450);
        await sleep(reducedMotion() ? 220 : 620);
        if (isCancelled()) return;
      } else {
        const rawSteps = move.stepPath.length > 0 ? move.stepPath : [move.landedTile];
        const steps = rawSteps[0] === move.startTile ? rawSteps.slice(1) : rawSteps;
        let curTile = move.startTile;
        const moverEntry = pawnRefs.current[move.playerId];
        moverEntry?.anchor?.classList.add('is-moving');

        for (let i = 0; i < steps.length; i++) {
          if (isCancelled()) return;
          const nextTile = steps[i];
          const fromPos = computePawnPositions(playersSnapshot, { ...tiles, [move.playerId]: curTile })[move.playerId] ?? tileCenter(curTile);
          const toPos = computePawnPositions(playersSnapshot, { ...tiles, [move.playerId]: nextTile })[move.playerId] ?? tileCenter(nextTile);

          const hopDur = reducedMotion() ? 45 : 175;
          const arcPx = 22;
          await animateRaf(hopDur, isCancelled, (t) => {
            const e = easeOutCubic(t);
            const pt = {
              x: fromPos.x + (toPos.x - fromPos.x) * e,
              y: fromPos.y + (toPos.y - fromPos.y) * e,
            };
            setAnchorPos(pawnRefs.current, move.playerId, pt);
            const lift = pawnRefs.current[move.playerId]?.lift;
            const tok = pawnRefs.current[move.playerId]?.token;
            const arc = Math.sin(t * Math.PI);
            if (lift) {
              lift.style.transform = `translate3d(0, ${(-arc * arcPx).toFixed(1)}px, 0)`;
            }
            if (tok) {
              let sx = 1;
              let sy = 1;
              if (t < 0.25) {
                sx = 0.88;
                sy = 1.14;
              } else if (t > 0.84) {
                sx = 1.18;
                sy = 0.84;
              }
              tok.style.transform = `scale(${sx}, ${sy})`;
            }
          });
          if (isCancelled()) return;

          // Settle & ripple
          tiles[move.playerId] = nextTile;
          visualTilesRef.current[move.playerId] = nextTile;
          setVisualTiles({ ...tiles });
          const tok = pawnRefs.current[move.playerId]?.token;
          if (tok) tok.style.transform = 'scale(1, 1)';
          triggerRipple(pawnRefs.current, move.playerId);
          sfx.pawnHop(i);
          haptics.hop();

          if (move.bouncedFrom100 && nextTile === 100 && i < steps.length - 1) {
            sfx.bounceBack();
            const c100 = tileCenter(100);
            pushFx({ kind: 'callout', x: c100.x + 8, y: c100.y + 4, text: 'BOUNCE!', tone: 'gold' }, 1100);
            await sleep(reducedMotion() ? 40 : 120);
          }

          curTile = nextTile;
          if (!reducedMotion() && i < steps.length - 1) {
            await sleep(32);
          }
        }
        moverEntry?.anchor?.classList.remove('is-moving');
      }

      // (c) Portal traversal (Ladder climb or Snake slide)
      if (move.portal) {
        await sleep(reducedMotion() ? 40 : 140);
        if (isCancelled()) return;
        const portal = move.portal;
        const span = Math.abs(portal.to - portal.from);
        setActivePortal({ id: portal.id, type: portal.type });

        if (portal.type === 'ladder') {
          const geom = getLadderGeometry(portal);
          sfx.ladderClimb(span);
          haptics.ladder();
          pushFx({ kind: 'sparkle', x: geom.bottom.x, y: geom.bottom.y, tone: 'gold' }, 800);
          pushFx(
            {
              kind: 'callout',
              x: (geom.bottom.x + geom.top.x) * 0.5,
              y: Math.min(geom.bottom.y, geom.top.y) + 4,
              text: `+${span} CLIMB!`,
              tone: 'good',
            },
            1400,
          );

          const climbDur = Math.min(1050, Math.max(540, 480 + span * 8));
          const entry = pawnRefs.current[move.playerId];
          entry?.anchor?.classList.add('is-moving');
          await animateRaf(climbDur, isCancelled, (t) => {
            const p = geom.sampler.at(easeInOutSine(t));
            setAnchorPos(pawnRefs.current, move.playerId, p);
            const lift = pawnRefs.current[move.playerId]?.lift;
            const tok = pawnRefs.current[move.playerId]?.token;
            const bob = Math.abs(Math.sin(t * Math.PI * 5)) * 5;
            const sway = Math.sin(t * Math.PI * 5) * 6;
            if (lift) lift.style.transform = `translate3d(0, ${(-bob).toFixed(1)}px, 0)`;
            if (tok) tok.style.transform = `rotate(${sway.toFixed(1)}deg) scale(1.06)`;
          });
          if (isCancelled()) return;
          resetPawnMotion(pawnRefs.current, move.playerId);
          pushFx({ kind: 'sparkle', x: geom.top.x, y: geom.top.y, tone: 'good' }, 850);
          triggerRipple(pawnRefs.current, move.playerId);
        } else {
          const geom = getSnakeGeometry(portal);
          sfx.snakeBite(span);
          haptics.snake();
          shakeBoard();
          pushFx(
            {
              kind: 'callout',
              x: geom.head.x,
              y: geom.head.y,
              text: `-${span} SNAKE!`,
              tone: 'bad',
            },
            1450,
          );

          const slideDur = Math.min(1180, Math.max(620, 560 + span * 9));
          const entry = pawnRefs.current[move.playerId];
          entry?.anchor?.classList.add('is-moving');
          await animateRaf(slideDur, isCancelled, (t) => {
            const p = geom.sampler.at(easeInOutSine(t));
            setAnchorPos(pawnRefs.current, move.playerId, p);
            const tok = pawnRefs.current[move.playerId]?.token;
            const wiggle = Math.sin(t * Math.PI * 8) * 12;
            const squish = 0.78 + 0.22 * Math.abs(Math.cos(t * Math.PI));
            if (tok) tok.style.transform = `rotate(${wiggle.toFixed(1)}deg) scale(${squish.toFixed(2)})`;
          });
          if (isCancelled()) return;
          resetPawnMotion(pawnRefs.current, move.playerId);
          pushFx({ kind: 'dust', x: geom.tail.x, y: geom.tail.y }, 550);
          triggerRipple(pawnRefs.current, move.playerId);

          // Dizzy stars over bitten pawn
          setDizzyIds((prev) => (prev.includes(move.playerId) ? prev : [...prev, move.playerId]));
          window.setTimeout(() => {
            setDizzyIds((prev) => prev.filter((id) => id !== move.playerId));
          }, 1650);
        }

        tiles[move.playerId] = move.finalTile;
        visualTilesRef.current[move.playerId] = move.finalTile;
        setVisualTiles({ ...tiles });
        setActivePortal(null);
      }

      // (d) Bumped rival pawns knocked back
      if (move.bumped.length > 0) {
        if (isCancelled()) return;
        sfx.bump();
        haptics.bump();
        const hitPt = tileCenter(move.finalTile);
        pushFx({ kind: 'callout', x: hitPt.x, y: hitPt.y, text: 'BUMPED!', tone: 'epic' }, 1300);

        await Promise.all(
          move.bumped.map(async (b) => {
            const fromPt = tileCenter(b.fromTile);
            const toPt = tileCenter(b.toTile);
            const entry = pawnRefs.current[b.playerId];
            entry?.anchor?.classList.add('is-moving');
            await animateRaf(380, isCancelled, (t) => {
              const e = easeOutCubic(t);
              const pt = {
                x: fromPt.x + (toPt.x - fromPt.x) * e,
                y: fromPt.y + (toPt.y - fromPt.y) * e,
              };
              setAnchorPos(pawnRefs.current, b.playerId, pt);
              const lift = pawnRefs.current[b.playerId]?.lift;
              const tok = pawnRefs.current[b.playerId]?.token;
              const arc = Math.sin(t * Math.PI) * 28;
              if (lift) lift.style.transform = `translate3d(0, ${(-arc).toFixed(1)}px, 0)`;
              if (tok) tok.style.transform = `rotate(${(t * -360).toFixed(0)}deg)`;
            });
            resetPawnMotion(pawnRefs.current, b.playerId);
            tiles[b.playerId] = b.toTile;
            visualTilesRef.current[b.playerId] = b.toTile;
            setVisualTiles({ ...tiles });
            pushFx({ kind: 'dust', x: toPt.x, y: toPt.y }, 480);
          }),
        );
        if (isCancelled()) return;
      }

      // Final authoritative snap to clustered positions
      const latestPlayers = roomRef.current.players;
      const finalTiles: Record<string, number> = {};
      for (const p of latestPlayers) finalTiles[p.id] = p.tile;
      visualTilesRef.current = finalTiles;
      setVisualTiles(finalTiles);
      snapPawns(latestPlayers, finalTiles);

      // (e) Extra roll flare or Victory celebration
      if (move.wonGame) {
        sfx.victory();
        haptics.win();
        setShowConfetti(true);
        pushFx({ kind: 'banner', x: 50, y: 44, text: `${move.playerName} WINS!`, tone: 'gold' }, 1800);
        await sleep(reducedMotion() ? 200 : 850);
        if (isCancelled()) return;
        setShowVictory(true);
      } else if (move.grantedExtraRoll) {
        sfx.bonusSix();
        pushFx({ kind: 'banner', x: 50, y: 46, text: 'BONUS ROLL!', tone: 'gold' }, 1350);
        await sleep(reducedMotion() ? 80 : 280);
      }

      if (!isCancelled()) {
        setCompletedSeq(move.seq);
        setAnimating(false);
      }
    };

    void runSequence();
  }, [room.lastMove, pushFx, shakeBoard, snapPawns]);

  const handleRoll = useCallback(() => {
    if (!canRoll) return;
    setRollPending(true);
    onIntent({ type: 'ROLL_DICE' });
  }, [canRoll, onIntent]);

  const handleEmote = useCallback(
    (emote: EmoteId) => {
      onIntent({ type: 'SEND_EMOTE', emote });
    },
    [onIntent],
  );

  // Compute active countdown progress (0..1) and remaining seconds
  const turnTimer = useMemo(() => {
    const dur = room.rules.turnDuration;
    if (isMoveInFlight || !room.turnDeadline || dur <= 0 || room.phase !== 'playing') return null;
    const remMs = Math.max(0, room.turnDeadline - (nowMs + serverOffsetRef.current));
    const secs = Math.ceil(remMs / 1000);
    const ratio = Math.min(1, Math.max(0, remMs / (dur * 1000)));
    return { secs, ratio, urgent: secs <= 5 };
  }, [isMoveInFlight, room.turnDeadline, room.rules.turnDuration, room.phase, nowMs]);

  const turnLabel = useMemo(() => {
    if (room.phase === 'gameover' && !isMoveInFlight) {
      const w = room.players.find((p) => p.id === room.winnerId);
      return w ? `${w.name} Wins!` : 'Match Over';
    }
    if (!displayTurnPlayer) return 'Waiting…';
    if (room.mode === 'couch' && !displayTurnPlayer.isBot) {
      return `${displayTurnPlayer.name}'s Turn`;
    }
    if (displayTurnPlayer.id === room.viewerId) return 'Your Turn!';
    return `${displayTurnPlayer.name}'s Turn`;
  }, [room.phase, room.players, room.winnerId, room.mode, room.viewerId, displayTurnPlayer, isMoveInFlight]);

  const turnSub = useMemo(() => {
    if ((room.phase !== 'playing' && !isMoveInFlight) || !displayTurnPlayer) return undefined;
    const shownTile = isMoveInFlight
      ? (visualTiles[displayTurnPlayer.id] ?? displayTurnPlayer.tile)
      : displayTurnPlayer.tile;
    if (displayTurnPlayer.isBot) {
      return isMoveInFlight ? 'Bot is moving…' : 'Bot is thinking…';
    }
    if (room.mode === 'couch') return 'Pass & Play — tap or press Space';
    if (displayTurnPlayer.id === room.viewerId) {
      return !isMoveInFlight && room.consecutiveSixes > 0
        ? `Streak: ${room.consecutiveSixes} six${room.consecutiveSixes > 1 ? 'es' : ''}`
        : `Square ${shownTile} of 100`;
    }
    return `Square ${shownTile} of 100`;
  }, [room.phase, room.mode, room.viewerId, room.consecutiveSixes, displayTurnPlayer, isMoveInFlight, visualTiles]);

  const recentActivity = useMemo(() => [...room.activity].slice(-14).reverse(), [room.activity]);
  const latestActivity = recentActivity[0] ?? null;

  return (
    <div className="game-screen">
      {/* Top Bar */}
      <header className="game-topbar">
        <div className="row game-brand">
          <button
            type="button"
            className="icon-btn game-leave-btn"
            aria-label="Leave match"
            title="Leave match"
            onClick={() => {
              sfx.buttonClick();
              onLeave();
            }}
          >
            <LogOut />
          </button>
          <div className="game-brand-text">
            <span className="wordmark game-wordmark">
              Snakes <span className="amp">&amp;</span> Ladders
            </span>
            <div className="game-meta-row">
              {room.mode === 'multiplayer' ? (
                <span className="chip chip-brass">Room {room.code}</span>
              ) : (
                <span className="chip chip-brass">
                  {room.mode === 'solo' ? 'Solo vs Bots' : 'Pass & Play'}
                </span>
              )}
              <span className="chip game-turn-chip">Turn {room.turnNumber}</span>
            </div>
          </div>
        </div>

        <div className="row game-top-actions">
          {room.mode === 'multiplayer' && (
            <span
              className={`transport-pill is-${transport}`}
              title={`Connection: ${transport}`}
            >
              {transport === 'reconnecting' || transport === 'connecting' ? (
                <WifiOff size={14} />
              ) : (
                <Wifi size={14} />
              )}
              <span>
                {transport === 'online'
                  ? 'Live'
                  : transport === 'reconnecting'
                    ? 'Reconnecting…'
                    : transport === 'connecting'
                      ? 'Connecting…'
                      : 'Local'}
              </span>
            </span>
          )}

          {room.mode === 'multiplayer' && viewer && room.phase === 'playing' && (
            <button
              type="button"
              className={`btn btn-sm ${viewer.autoPlay ? 'btn-primary' : 'btn-wood'} autoplay-btn`}
              aria-pressed={Boolean(viewer.autoPlay)}
              title="Let a bot auto-roll for your seat"
              onClick={() => {
                sfx.buttonClick();
                onIntent({ type: 'TOGGLE_AUTOPLAY' });
              }}
            >
              <Zap />
              <span>{viewer.autoPlay ? 'Auto ON' : 'Auto'}</span>
            </button>
          )}

          <SettingsMenu />
        </div>
      </header>

      {(error || transport === 'reconnecting') && (
        <div className="game-alerts">
          {transport === 'reconnecting' && (
            <div className="alert alert-info" role="status">
              <WifiOff />
              <span>Connection hiccup — reconnecting to the room…</span>
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              <TriangleAlert />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* Main Responsive 3-Column Tabletop Grid */}
      <main className="game-layout">
        {/* Left Roster (Desktop) / Compact Horizontal Strip (Mobile Portrait) */}
        <aside className="roster-col" aria-label="Players">
          <div className="roster-list">
            {room.players.map((p) => {
              const isTurn =
                displayTurnPlayer?.id === p.id && (room.phase === 'playing' || isMoveInFlight);
              const isViewer = p.id === room.viewerId;
              const pal = paletteOf(p.color);
              const emote = floatingEmotes.find((e) => e.playerId === p.id);
              const shownTile = isMoveInFlight ? (visualTiles[p.id] ?? p.tile) : p.tile;
              const progressPct = Math.min(100, Math.max(0, shownTile));
              const ringCircumference = 2 * Math.PI * 19;
              const ringOffset =
                isTurn && turnTimer ? ringCircumference * (1 - turnTimer.ratio) : 0;

              return (
                <div
                  key={p.id}
                  className={`roster-card${isTurn ? ' is-turn' : ''}${isViewer ? ' is-you' : ''}${p.disconnected ? ' is-away' : ''}`}
                  style={{ ['--pc' as string]: pal.primary, ['--pglow' as string]: pal.glow }}
                >
                  {emote && (
                    <div key={emote.id} className="emote-bubble" aria-live="polite">
                      <span>{EMOTE_GLYPHS[emote.emote]}</span>
                    </div>
                  )}

                  <div className="roster-avatar-wrap">
                    <span
                      className="avatar roster-avatar"
                      style={{ ['--c' as string]: pal.primary }}
                    >
                      {p.isBot ? <Bot /> : p.name.trim().charAt(0).toUpperCase()}
                    </span>
                    {isTurn && turnTimer && (
                      <svg
                        className={`timer-ring${turnTimer.urgent ? ' is-urgent' : ''}`}
                        viewBox="0 0 44 44"
                        aria-label={`${turnTimer.secs} seconds remaining`}
                      >
                        <circle className="timer-ring-track" cx="22" cy="22" r="19" />
                        <circle
                          className="timer-ring-arc"
                          cx="22"
                          cy="22"
                          r="19"
                          strokeDasharray={ringCircumference}
                          strokeDashoffset={ringOffset}
                        />
                      </svg>
                    )}
                  </div>

                  <div className="roster-info">
                    <div className="roster-name-row">
                      <span className="roster-name" title={p.name}>
                        {p.name}
                      </span>
                      {isViewer && room.mode !== 'couch' && (
                        <span className="roster-tag">You</span>
                      )}
                      {p.isHost && <Crown className="roster-crown" size={13} />}
                      {p.autoPlay && <Zap className="roster-auto" size={12} />}
                    </div>

                    <div className="roster-bar" aria-hidden="true">
                      <div
                        className="roster-bar-fill"
                        style={{ transform: `scaleX(${progressPct / 100})` }}
                      />
                    </div>

                    <div className="roster-sub-row">
                      <span className="roster-tile">
                        {shownTile <= 1 ? 'Tile 1' : `Tile ${shownTile}`}
                      </span>
                      {isTurn && turnTimer ? (
                        <span className={`roster-timer-num${turnTimer.urgent ? ' is-urgent' : ''}`}>
                          {turnTimer.secs}s
                        </span>
                      ) : p.wins > 0 ? (
                        <span className="roster-wins">
                          <Crown size={11} /> {p.wins}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center Square Board */}
        <section className="board-col" aria-label="Snakes and Ladders game board">
          <div className="board-stage">
            <Board
              ref={boardRef}
              portals={room.portals}
              players={room.players}
              activeId={
                activeMovePlayerId ??
                (room.phase === 'playing' ? (activePlayer?.id ?? null) : room.winnerId)
              }
              activePortal={activePortal}
              pawnRefs={pawnRefs}
              dizzyIds={dizzyIds}
              fx={fx}
            />
          </div>

          {latestActivity && (
            <div className={`mobile-ticker tone-${latestActivity.tone}`} aria-live="polite">
              <Sparkles size={14} />
              <span>{latestActivity.text}</span>
            </div>
          )}
        </section>

        {/* Right Controls Rail (Desktop) / Bottom Roll Dock (Mobile Portrait) */}
        <aside className="controls-col" aria-label="Dice and match controls">
          <DiceTray
            ref={diceRef}
            canRoll={canRoll}
            rolling={isMoveInFlight || rollPending}
            lastFace={room.lastMove?.dice ?? 6}
            turnLabel={turnLabel}
            turnSub={turnSub}
            activeColor={displayTurnPlayer?.color ?? 'amber'}
            bonusActive={Boolean(
              !isMoveInFlight && room.lastMove?.grantedExtraRoll && room.consecutiveSixes > 0,
            )}
            onRoll={handleRoll}
          />

          <div className="emote-panel panel-wood">
            <EmoteBar disabled={room.phase !== 'playing'} onEmote={handleEmote} />
          </div>

          <div className="activity-panel panel-wood">
            <div className="panel-title">
              <ScrollText size={16} />
              <span>Tabletop Log</span>
            </div>
            <ul className="activity-list scroll-y">
              {recentActivity.length === 0 ? (
                <li className="activity-empty">Roll the die to begin the race to 100!</li>
              ) : (
                recentActivity.map((entry) => (
                  <li key={entry.id} className={`activity-item tone-${entry.tone}`}>
                    {entry.text}
                  </li>
                ))
              )}
            </ul>
          </div>
        </aside>
      </main>

      <Confetti active={showConfetti} />

      <VictoryModal
        room={room}
        open={showVictory && room.phase === 'gameover'}
        onIntent={onIntent}
        onLeave={onLeave}
      />
    </div>
  );
}

export default GameScreen;

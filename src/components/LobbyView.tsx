import '../styles/screens.css';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Bot,
  Check,
  CircleCheck,
  Copy,
  Crown,
  Hourglass,
  LogOut,
  Play,
  Scroll,
  Share2,
  TriangleAlert,
  UserPlus,
  UserX,
  WifiOff,
} from 'lucide-react';
import type {
  BoardPresetId,
  ClientIntent,
  GameRules,
  PawnColorId,
  SanitizedPlayer,
  SanitizedRoomState,
} from '@engine/types';
import { PAWN_COLOR_ORDER, PAWN_PALETTES } from '@engine/boards';
import { sfx } from '@utils/sfx';
import { music } from '@utils/music';
import { SettingsMenu } from './SettingsMenu';

const MAX_SEATS = 6;

export interface LobbyViewProps {
  room: SanitizedRoomState;
  reconnecting?: boolean;
  error: string | null;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
}

const PRESETS: { id: BoardPresetId; label: string; blurb: string }[] = [
  { id: 'classic', label: 'Classic', blurb: 'The timeless board — balanced snakes and ladders.' },
  { id: 'serpents_den', label: "Serpent's Den", blurb: 'More snakes, longer slides. Not for the faint-hearted!' },
  { id: 'shuffled', label: 'Shuffled', blurb: 'A fresh random layout every match.' },
];

const TIMERS: { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 10, label: '10s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
];

type BoolRule = 'exactFinishBounce' | 'extraRollOnSix' | 'tripleSixPenalty' | 'enableBump';

const SWITCHES: { key: BoolRule; label: string; blurb: string }[] = [
  { key: 'extraRollOnSix', label: 'Bonus roll on 6', blurb: 'Rolling a six earns another turn.' },
  { key: 'tripleSixPenalty', label: 'Triple-six bust', blurb: 'Three sixes in a row voids the turn.' },
  { key: 'exactFinishBounce', label: 'Exact finish', blurb: 'Overshooting 100 bounces you back.' },
  { key: 'enableBump', label: 'Bump rivals', blurb: 'Landing on a pawn knocks it back.' },
];

const MODE_LABEL: Record<SanitizedRoomState['mode'], string> = {
  multiplayer: 'Online Room',
  solo: 'Solo vs Bots',
  couch: 'Pass & Play',
};

function inviteUrl(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function avatarStyle(color: PawnColorId): CSSProperties {
  return { '--c': PAWN_PALETTES[color]?.primary ?? 'var(--pawn-ruby)' } as CSSProperties;
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function Seat(props: {
  player: SanitizedPlayer | null;
  index: number;
  isViewer: boolean;
  canKick: boolean;
  mode: SanitizedRoomState['mode'];
  onKick: () => void;
}) {
  const { player, index, isViewer, canKick, mode, onKick } = props;
  if (!player) {
    return (
      <li className="seat seat-empty" aria-label={`Seat ${index + 1} empty`}>
        <span className="seat-empty-ring" aria-hidden="true" />
        <span className="seat-empty-label">Open seat</span>
      </li>
    );
  }
  const ready = player.isBot || player.isHost || mode !== 'multiplayer' || player.isReady;
  const offline = player.disconnected || player.transport === 'reconnecting';
  return (
    <li
      className={`seat${isViewer ? ' is-you' : ''}${offline ? ' is-offline' : ''}`}
      style={avatarStyle(player.color)}
    >
      <span className="avatar seat-avatar" style={avatarStyle(player.color)}>
        {player.isBot ? <Bot aria-hidden="true" /> : initial(player.name)}
      </span>
      <div className="seat-body">
        <span className="seat-name" title={player.name}>
          {player.name}
        </span>
        <span className="seat-badges">
          {player.isHost && (
            <span className="chip chip-brass">
              <Crown aria-hidden="true" /> Host
            </span>
          )}
          {player.isBot && (
            <span className="chip">
              <Bot aria-hidden="true" /> Bot
            </span>
          )}
          {isViewer && <span className="chip chip-epic">You</span>}
          {offline && (
            <span className="chip chip-bad">
              <WifiOff aria-hidden="true" /> Away
            </span>
          )}
        </span>
      </div>
      <span className={`seat-ready${ready ? ' is-ready' : ''}`} title={ready ? 'Ready' : 'Not ready'}>
        {ready ? <CircleCheck aria-label="Ready" /> : <Hourglass aria-label="Not ready" />}
      </span>
      {canKick && (
        <button
          type="button"
          className="seat-kick"
          aria-label={`Remove ${player.name}`}
          title={`Remove ${player.name}`}
          onClick={onKick}
        >
          <UserX aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function LobbyView(props: LobbyViewProps) {
  const { room, reconnecting, error, onIntent, onLeave } = props;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    music.setScene('lobby');
  }, []);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const viewer = room.players.find((p) => p.id === room.viewerId) ?? null;
  const isHost = !!viewer?.isHost;
  const isOnline = room.mode === 'multiplayer';
  const rules: GameRules = room.rules;
  const full = room.players.length >= MAX_SEATS;
  const takenByOthers = new Set(room.players.filter((p) => p.id !== room.viewerId).map((p) => p.color));

  const waitingOn = isOnline ? room.players.filter((p) => !p.isHost && !p.isBot && !p.isReady) : [];
  const canStart = room.players.length >= 2 && waitingOn.length === 0;
  const startHint =
    room.players.length < 2
      ? isOnline
        ? 'Need at least 2 players — invite a friend or add a bot.'
        : 'Add at least one more player or bot.'
      : waitingOn.length > 0
        ? `Waiting for ${waitingOn.map((p) => p.name).join(', ')} to ready up.`
        : 'Everyone is ready!';

  const send = (intent: ClientIntent) => {
    sfx.buttonClick();
    onIntent(intent);
  };

  const setRule = (patch: Partial<GameRules>) => {
    if (!isHost) return;
    send({ type: 'UPDATE_RULES', rules: patch });
  };

  const flashCopied = () => {
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  const handleCopy = async () => {
    sfx.buttonClick();
    if (await copyText(inviteUrl(room.code))) flashCopied();
  };

  const handleInvite = async () => {
    sfx.buttonClick();
    const url = inviteUrl(room.code);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Snakes & Ladders',
          text: `Join my Snakes & Ladders table! Room code ${room.code}`,
          url,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    if (await copyText(url)) flashCopied();
  };

  const seats: (SanitizedPlayer | null)[] = Array.from({ length: MAX_SEATS }, (_, i) => room.players[i] ?? null);
  const preset = PRESETS.find((p) => p.id === rules.boardPreset) ?? PRESETS[0];

  return (
    <div className="screen lobby-screen">
      <header className="lobby-topbar">
        <button
          type="button"
          className="btn btn-wood btn-sm"
          onClick={() => {
            sfx.buttonClick();
            onLeave();
          }}
        >
          <LogOut aria-hidden="true" /> Leave
        </button>
        <h1 className="wordmark lobby-wordmark">
          Snakes <span className="amp">&amp;</span> Ladders
        </h1>
        <SettingsMenu />
      </header>

      {reconnecting && (
        <div className="alert alert-info lobby-banner" role="status">
          <WifiOff aria-hidden="true" />
          <span>Connection lost — reconnecting…</span>
          <span className="lobby-banner-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {error && (
        <div className="alert lobby-banner" role="alert">
          <TriangleAlert aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="lobby-grid">
        <div className="lobby-col stack">
          {isOnline ? (
            <section className="panel-wood room-code-card" aria-label="Room code">
              <span className="room-code-label">Room code</span>
              <div className="room-code" aria-label={room.code.split('').join(' ')}>
                {room.code.split('').map((ch, i) => (
                  <span key={i} className="room-code-tile" style={{ animationDelay: `${i * 70}ms` }}>
                    {ch}
                  </span>
                ))}
              </div>
              <div className="room-code-actions">
                <button type="button" className="btn btn-primary" onClick={() => void handleInvite()}>
                  <Share2 aria-hidden="true" /> Invite
                </button>
                <button type="button" className="btn btn-wood" onClick={() => void handleCopy()}>
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            </section>
          ) : (
            <section className="panel-wood room-code-card room-mode-card">
              <span className="room-code-label">Game mode</span>
              <span className="room-mode-name">{MODE_LABEL[room.mode]}</span>
              <p className="room-mode-hint">
                {room.mode === 'couch'
                  ? 'Everyone shares this screen. Add players and pass the device around!'
                  : 'Add bots to fill the table, then start when ready.'}
              </p>
            </section>
          )}

          <section className="panel seats-panel" aria-labelledby="seats-title">
            <div className="seats-head">
              <h2 id="seats-title" className="panel-title">
                Players <span className="seats-count">{room.players.length}/{MAX_SEATS}</span>
              </h2>
              {isHost && (
                <div className="row seats-add">
                  {room.mode === 'couch' && (
                    <button
                      type="button"
                      className="btn btn-felt btn-sm"
                      disabled={full}
                      onClick={() => send({ type: 'ADD_LOCAL_PLAYER' })}
                    >
                      <UserPlus aria-hidden="true" /> Add Player
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-wood btn-sm"
                    disabled={full}
                    onClick={() => send({ type: 'ADD_BOT' })}
                  >
                    <Bot aria-hidden="true" /> Add Bot
                  </button>
                </div>
              )}
            </div>

            <ul className="seat-grid">
              {seats.map((p, i) => (
                <Seat
                  key={p ? p.id : `empty-${i}`}
                  player={p}
                  index={i}
                  isViewer={!!p && p.id === room.viewerId}
                  canKick={!!p && isHost && p.id !== room.viewerId}
                  mode={room.mode}
                  onKick={() => p && send({ type: 'REMOVE_PLAYER', playerId: p.id })}
                />
              ))}
            </ul>

            {viewer && (
              <div className="color-picker">
                <span className="field-label">Your pawn</span>
                <div className="color-swatches" role="group" aria-label="Pawn color">
                  {PAWN_COLOR_ORDER.map((c) => {
                    const taken = takenByOthers.has(c);
                    const label = PAWN_PALETTES[c]?.label ?? c;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`swatch swatch-${c}`}
                        aria-pressed={viewer.color === c}
                        aria-label={taken ? `${label} (taken)` : label}
                        title={taken ? `${label} (taken)` : label}
                        disabled={taken}
                        onClick={() => viewer.color !== c && send({ type: 'SELECT_COLOR', color: c })}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="lobby-col stack">
          <section className="panel rules-panel" aria-labelledby="rules-title">
            <div className="rules-head">
              <h2 id="rules-title" className="panel-title">
                <Scroll aria-hidden="true" /> House Rules
              </h2>
              {!isHost && <span className="chip">Host decides</span>}
            </div>

            <div className="rules-group">
              <span className="field-label">Board</span>
              <div className="segmented rules-seg" role="group" aria-label="Board preset">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={rules.boardPreset === p.id}
                    disabled={!isHost}
                    onClick={() => rules.boardPreset !== p.id && setRule({ boardPreset: p.id })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="rules-blurb">{preset.blurb}</p>
            </div>

            <div className="rules-switches">
              {SWITCHES.map((s) => (
                <label key={s.key} className={`switch rules-switch${isHost ? '' : ' is-readonly'}`}>
                  <span className="rules-switch-text">
                    <span className="rules-switch-label">{s.label}</span>
                    <span className="rules-switch-blurb">{s.blurb}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={!!rules[s.key]}
                    disabled={!isHost}
                    onChange={(e) => setRule({ [s.key]: e.target.checked } as Partial<GameRules>)}
                  />
                  <span className="switch-track">
                    <span className="switch-thumb" />
                  </span>
                </label>
              ))}
            </div>

            <div className="rules-group">
              <span className="field-label">Turn timer</span>
              <div className="segmented rules-seg" role="group" aria-label="Turn timer">
                {TIMERS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={rules.turnDuration === t.value}
                    disabled={!isHost}
                    onClick={() => rules.turnDuration !== t.value && setRule({ turnDuration: t.value })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel-wood lobby-actions">
            {isHost ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-lg btn-block lobby-start"
                  disabled={!canStart}
                  onClick={() => send({ type: 'START_GAME' })}
                >
                  <Play aria-hidden="true" /> Start Game
                </button>
                <p className={`lobby-hint${canStart ? ' is-good' : ''}`}>{startHint}</p>
              </>
            ) : (
              <>
                {viewer && isOnline && (
                  <button
                    type="button"
                    className={`btn btn-lg btn-block ${viewer.isReady ? 'btn-felt' : 'btn-primary'}`}
                    aria-pressed={viewer.isReady}
                    onClick={() => send({ type: 'TOGGLE_READY' })}
                  >
                    {viewer.isReady ? <CircleCheck aria-hidden="true" /> : <Hourglass aria-hidden="true" />}
                    {viewer.isReady ? "I'm Ready!" : 'Ready Up'}
                  </button>
                )}
                <p className="lobby-hint">
                  <Hourglass aria-hidden="true" className="lobby-hint-icon" /> Waiting for the host to start…
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

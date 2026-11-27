import '../styles/screens.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Bot,
  CircleHelp,
  Globe,
  Loader,
  Lock,
  LogIn,
  RefreshCw,
  TriangleAlert,
  Users,
  WifiOff,
} from 'lucide-react';
import { fetchOpenRoomsResult } from '@net/session';
import type { LobbyListing } from '@net/session';
import { sfx } from '@utils/sfx';
import { music } from '@utils/music';
import { HowToPlayModal } from './HowToPlayModal';
import { SettingsMenu } from './SettingsMenu';

const NAME_KEY = 'snakesweb.name';
const NAME_MAX = 16;
const POLL_MS = 5000;

export interface HomeScreenProps {
  initialRoomCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onHost: (name: string, password?: string) => void;
  onJoin: (code: string, name: string, password?: string) => void;
  onSolo: (name: string) => void;
  onCouch: (name: string) => void;
}

interface InviteStatus {
  state: 'loading' | 'ready' | 'missing' | 'error';
  exists: boolean;
  hasPassword: boolean;
  phase: string | null;
  playerCount: number | null;
  maxPlayers: number | null;
  hostName: string | null;
}

function readStoredName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function sanitizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function phaseLabel(phase: string | null): string {
  if (phase === 'playing') return 'In game';
  if (phase === 'gameover') return 'Finished';
  return 'In lobby';
}

/* ---------- Hero art ---------- */

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DieFace({ face }: { face: number }) {
  const on = PIPS[face];
  return (
    <div className={`hero-die-face hero-die-face-${face}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={on.includes(i) ? 'pip' : 'pip pip-off'} />
      ))}
    </div>
  );
}

function HeroDie() {
  return (
    <div className="hero-die-stage" aria-hidden="true">
      <div className="hero-die-float">
        <div className="hero-die">
          {[1, 2, 3, 4, 5, 6].map((f) => (
            <DieFace key={f} face={f} />
          ))}
        </div>
      </div>
      <div className="hero-die-shadow" />
    </div>
  );
}

function HeroEmblem() {
  return (
    <svg className="hero-emblem" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="he-rail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e0ac74" />
          <stop offset="1" stopColor="#956039" />
        </linearGradient>
        <linearGradient id="he-snake" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fd18a" />
          <stop offset="1" stopColor="#127a4a" />
        </linearGradient>
        <radialGradient id="he-disc" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#fff8e6" />
          <stop offset="1" stopColor="#f1e1bb" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="url(#he-disc)" stroke="#b08a1e" strokeWidth="4" />
      <circle cx="60" cy="60" r="49" fill="none" stroke="#8f6f14" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />
      {/* ladder */}
      <g transform="rotate(-18 60 60)">
        <rect x="40" y="18" width="6" height="84" rx="3" fill="url(#he-rail)" />
        <rect x="62" y="18" width="6" height="84" rx="3" fill="url(#he-rail)" />
        {[28, 42, 56, 70, 84].map((y) => (
          <rect key={y} x="44" y={y} width="20" height="4" rx="2" fill="#c98a52" />
        ))}
      </g>
      {/* snake */}
      <g className="hero-emblem-snake">
        <path
          d="M84 26 C 100 34, 96 50, 78 54 S 46 64, 58 78 S 92 84, 86 100"
          fill="none"
          stroke="#0e5a37"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M84 26 C 100 34, 96 50, 78 54 S 46 64, 58 78 S 92 84, 86 100"
          fill="none"
          stroke="url(#he-snake)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M84 26 C 100 34, 96 50, 78 54 S 46 64, 58 78 S 92 84, 86 100"
          fill="none"
          stroke="#f6d675"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 7"
          opacity="0.85"
        />
        <ellipse cx="82" cy="24" rx="9" ry="7" fill="#1fae6b" stroke="#0e5a37" strokeWidth="2" />
        <circle cx="79" cy="22" r="1.8" fill="#1a0f09" />
        <circle cx="85" cy="22" r="1.8" fill="#1a0f09" />
        <path d="M82 31 l0 5 m0 0 l-2 3 m2 -3 l2 3" stroke="#c2453a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

/* ---------- Open lobbies ---------- */

function OpenLobbies(props: {
  busy: boolean;
  onJoin: (code: string, password?: string) => void;
}) {
  const { busy, onJoin } = props;
  const [rooms, setRooms] = useState<LobbyListing[]>([]);
  const [ok, setOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetchOpenRoomsResult();
      if (!aliveRef.current) return;
      setOk(res.ok);
      if (res.ok) setRooms(Array.isArray(res.rooms) ? res.rooms : []);
    } catch {
      if (aliveRef.current) setOk(false);
    } finally {
      if (aliveRef.current) {
        setLoaded(true);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
    };
  }, [load]);

  const handleJoin = (room: LobbyListing) => {
    sfx.buttonClick();
    if (room.hasPassword) {
      if (pwFor !== room.code) {
        setPwFor(room.code);
        setPw('');
        return;
      }
      onJoin(room.code, pw || undefined);
      return;
    }
    onJoin(room.code);
  };

  return (
    <section className="panel-wood lobbies-panel" aria-labelledby="lobbies-title">
      <div className="lobbies-head">
        <h2 id="lobbies-title" className="panel-title">
          <Globe aria-hidden="true" /> Open Lobbies
        </h2>
        <span className={`live-dot${ok ? '' : ' is-off'}`} aria-hidden="true" />
        <button
          type="button"
          className="icon-btn lobbies-refresh"
          aria-label="Refresh lobbies"
          onClick={() => {
            sfx.buttonClick();
            void load();
          }}
        >
          <RefreshCw className={refreshing ? 'spin' : undefined} />
        </button>
      </div>

      {!loaded ? (
        <div className="lobbies-empty">
          <Loader className="spin" aria-hidden="true" />
          <p>Looking for tables…</p>
        </div>
      ) : !ok && rooms.length === 0 ? (
        <div className="lobbies-empty">
          <WifiOff aria-hidden="true" />
          <p>Can't reach the lobby board right now.</p>
          <p className="lobbies-sub">Solo and Pass &amp; Play still work offline.</p>
        </div>
      ) : rooms.length === 0 ? (
        <div className="lobbies-empty">
          <Users aria-hidden="true" />
          <p>No open tables yet.</p>
          <p className="lobbies-sub">Host a room and invite your friends!</p>
        </div>
      ) : (
        <ul className="lobby-list scroll-y">
          {!ok && (
            <li className="lobby-stale">
              <WifiOff aria-hidden="true" /> Offline — showing last known tables
            </li>
          )}
          {rooms.map((room) => {
            const inLobby = room.phase === 'lobby';
            const full = room.playerCount >= room.maxPlayers;
            const canJoin = inLobby ? !full : room.rejoinableCount > 0;
            return (
              <li key={room.code} className="lobby-item">
                <div className="lobby-item-main">
                  <div className="lobby-item-top">
                    <span className="lobby-code">{room.code}</span>
                    <span className="lobby-host">{room.hostName || 'Someone'}'s table</span>
                    {room.hasPassword && (
                      <Lock className="lobby-lock" aria-label="Password protected" />
                    )}
                  </div>
                  <div className="lobby-item-meta">
                    <span className={`chip ${full && inLobby ? 'chip-bad' : 'chip-good'}`}>
                      <Users aria-hidden="true" /> {room.playerCount}/{room.maxPlayers}
                    </span>
                    <span className={`chip ${inLobby ? 'chip-brass' : 'chip-epic'}`}>{phaseLabel(room.phase)}</span>
                    {room.rulesSummary && <span className="lobby-rules">{room.rulesSummary}</span>}
                  </div>
                  {pwFor === room.code && room.hasPassword && (
                    <form
                      className="lobby-pw"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleJoin(room);
                      }}
                    >
                      <input
                        className="input"
                        type="password"
                        placeholder="Room password"
                        aria-label={`Password for room ${room.code}`}
                        value={pw}
                        autoFocus
                        onChange={(e) => setPw(e.target.value)}
                      />
                    </form>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !canJoin}
                  onClick={() => handleJoin(room)}
                >
                  <LogIn aria-hidden="true" />
                  {!canJoin ? (full ? 'Full' : 'Locked') : inLobby ? 'Join' : 'Rejoin'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- Invite card ---------- */

function InviteCard(props: {
  code: string;
  busy: boolean;
  onJoin: (password?: string) => void;
}) {
  const { code, busy, onJoin } = props;
  const [status, setStatus] = useState<InviteStatus>({
    state: 'loading',
    exists: false,
    hasPassword: false,
    phase: null,
    playerCount: null,
    maxPlayers: null,
    hostName: null,
  });
  const [pw, setPw] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus((s) => ({ ...s, state: 'loading' }));
    fetch(`/api/room/${encodeURIComponent(code)}/status`, { signal: ctrl.signal })
      .then(async (res) => {
        let data: Record<string, unknown> = {};
        try {
          data = asRecord(await res.json());
        } catch {
          data = {};
        }
        const exists = res.status === 404 ? false : data.exists === undefined ? res.ok : Boolean(data.exists);
        setStatus({
          state: exists ? 'ready' : res.ok || res.status === 404 ? 'missing' : 'error',
          exists,
          hasPassword: Boolean(data.hasPassword),
          phase: strOrNull(data.phase),
          playerCount: numOrNull(data.playerCount),
          maxPlayers: numOrNull(data.maxPlayers),
          hostName: strOrNull(data.hostName),
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus((s) => ({ ...s, state: 'error' }));
      });
    return () => ctrl.abort();
  }, [code]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    sfx.buttonClick();
    onJoin(status.hasPassword && pw ? pw : undefined);
  };

  return (
    <form className="panel invite-card" onSubmit={submit} aria-live="polite">
      <div className="invite-ribbon">You're invited!</div>
      <div className="invite-body">
        <div className="invite-code" aria-label={`Room ${code}`}>
          {code.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
        <div className="invite-info">
          {status.state === 'loading' && (
            <p className="invite-line">
              <Loader className="spin" aria-hidden="true" /> Checking the table…
            </p>
          )}
          {status.state === 'ready' && (
            <>
              <p className="invite-line">
                <strong>{status.hostName ? `${status.hostName}'s table` : 'Table found'}</strong>
              </p>
              <div className="row invite-chips">
                <span className="chip chip-brass">{phaseLabel(status.phase)}</span>
                {status.playerCount !== null && (
                  <span className="chip chip-good">
                    <Users aria-hidden="true" /> {status.playerCount}
                    {status.maxPlayers !== null ? `/${status.maxPlayers}` : ''} players
                  </span>
                )}
                {status.hasPassword && (
                  <span className="chip">
                    <Lock aria-hidden="true" /> Password
                  </span>
                )}
              </div>
            </>
          )}
          {status.state === 'missing' && (
            <p className="invite-line invite-warn">
              <TriangleAlert aria-hidden="true" /> This room may have closed. You can still try to join.
            </p>
          )}
          {status.state === 'error' && (
            <p className="invite-line invite-warn">
              <WifiOff aria-hidden="true" /> Couldn't check the room status.
            </p>
          )}
        </div>
      </div>
      {status.hasPassword && (
        <label className="field">
          <span className="field-label">Room password</span>
          <input
            className="input"
            type="password"
            value={pw}
            placeholder="Enter password"
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || status.state === 'loading'}>
        {busy ? <Loader className="spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
        Join Room {code}
      </button>
    </form>
  );
}

/* ---------- Home screen ---------- */

export function HomeScreen(props: HomeScreenProps) {
  const { initialRoomCode, initialName, busy, error, onHost, onJoin, onSolo, onCouch } = props;
  const [name, setName] = useState(() => (initialName || readStoredName()).slice(0, NAME_MAX));
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [howOpen, setHowOpen] = useState(false);
  const inviteCode = sanitizeCode(initialRoomCode || '');

  useEffect(() => {
    music.setScene('lobby');
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage unavailable */
    }
  }, [name]);

  const playerName = name.trim().slice(0, NAME_MAX) || 'Player';
  const pw = password.trim() || undefined;

  const click = (fn: () => void) => () => {
    sfx.buttonClick();
    fn();
  };

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    if (joinCode.length !== 4) return;
    sfx.buttonClick();
    onJoin(joinCode, playerName, pw);
  };

  const closeHow = useCallback(() => setHowOpen(false), []);

  return (
    <div className="screen home-screen">
      <header className="home-topbar">
        <button
          type="button"
          className="btn btn-wood btn-sm"
          onClick={click(() => setHowOpen(true))}
        >
          <CircleHelp aria-hidden="true" /> How to Play
        </button>
        <SettingsMenu />
      </header>

      <section className="home-hero">
        <div className="hero-art">
          <HeroEmblem />
          <HeroDie />
        </div>
        <h1 className="wordmark home-wordmark">
          Snakes <span className="amp">&amp;</span> Ladders
        </h1>
        <p className="home-tagline">Roll the dice, climb the ladders, dodge the snakes — race your friends to 100!</p>
      </section>

      <div className="home-grid">
        <div className="home-main stack">
          {inviteCode.length === 4 && (
            <InviteCard code={inviteCode} busy={busy} onJoin={(p) => onJoin(inviteCode, playerName, p)} />
          )}

          <section className="panel home-card" aria-label="Start playing">
            {error && (
              <div className="alert" role="alert">
                <TriangleAlert aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <label className="field">
              <span className="field-label">Your name</span>
              <input
                className="input home-name"
                type="text"
                value={name}
                maxLength={NAME_MAX}
                placeholder="Enter a nickname"
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">
                Room password <span className="field-optional">(optional)</span>
              </span>
              <input
                className="input"
                type="password"
                value={password}
                placeholder="Leave blank for an open table"
                autoComplete="off"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              disabled={busy}
              onClick={click(() => onHost(playerName, pw))}
            >
              {busy ? <Loader className="spin" aria-hidden="true" /> : <Globe aria-hidden="true" />}
              Host Online Room
            </button>

            <form className="home-join" onSubmit={submitJoin}>
              <input
                className="input input-code"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="CODE"
                aria-label="4-character room code"
                value={joinCode}
                maxLength={4}
                onChange={(e) => setJoinCode(sanitizeCode(e.target.value))}
              />
              <button type="submit" className="btn btn-wood" disabled={busy || joinCode.length !== 4}>
                <LogIn aria-hidden="true" /> Join
              </button>
            </form>

            <div className="divider">or play offline</div>

            <div className="home-offline">
              <button type="button" className="btn btn-felt" disabled={busy} onClick={click(() => onSolo(playerName))}>
                <Bot aria-hidden="true" /> Solo vs Bots
              </button>
              <button type="button" className="btn btn-velvet" disabled={busy} onClick={click(() => onCouch(playerName))}>
                <Users aria-hidden="true" /> Pass &amp; Play
              </button>
            </div>
            <p className="home-hint">Pass &amp; Play shares one screen — perfect for the couch.</p>
          </section>
        </div>

        <OpenLobbies busy={busy} onJoin={(code, p) => onJoin(code, playerName, p)} />
      </div>

      <HowToPlayModal open={howOpen} onClose={closeHow} />
    </div>
  );
}

import { getBotThinkDelayMs, maybePickBotEmote } from '@engine/bot';
import { SnakesHostEngine, getAnimationCompleteAt } from '@engine/snakesEngine';
import type { ClientIntent, GameMode, SanitizedRoomState } from '@engine/types';
import type {
  ClientToRoomMessage,
  ConnectionStatus,
  LobbyListing,
  LocalTransportState,
  RoomToClientMessage,
} from './protocol';

export type { LobbyListing, LocalTransportState };

export interface SessionSnapshot {
  room: SanitizedRoomState | null;
  status: ConnectionStatus;
  transport: LocalTransportState;
  error: string | null;
}

export type SessionListener = (snapshot: SessionSnapshot) => void;

export interface GameSession {
  readonly mode: GameMode;
  subscribe(listener: SessionListener): () => void;
  getSnapshot(): SessionSnapshot;
  sendIntent(intent: ClientIntent): void;
  destroy(): void;
}

export interface ActiveRoomBookmark {
  code: string;
  name: string;
}

const ACTIVE_ROOM_KEY = 'snakesweb_active_room';

export function saveActiveRoom(bookmark: ActiveRoomBookmark): void {
  try {
    sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(bookmark));
  } catch {
    // ignore storage errors
  }
}

export function loadActiveRoom(): ActiveRoomBookmark | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveRoomBookmark>;
    if (
      typeof parsed.code === 'string' &&
      parsed.code.length === 4 &&
      typeof parsed.name === 'string'
    ) {
      return { code: parsed.code.toUpperCase(), name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearActiveRoom(): void {
  try {
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // ignore
  }
}

function getOrCreateSessionId(roomCode: string): string {
  const key = `snakesweb_session_${roomCode.toUpperCase()}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

function buildWsUrl(params: Record<string, string>, roomCode: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams(params).toString();
  return `${proto}//${window.location.host}/api/room/${roomCode.toUpperCase()}/ws?${query}`;
}

// ==================== LOCAL AUTOMATION (SOLO & COUCH) ====================

class LocalAutomation {
  private botTimer: number | null = null;
  private turnTimer: number | null = null;
  private emoteTimer: number | null = null;
  private lastEmotedSeq = 0;

  constructor(
    private engine: SnakesHostEngine,
    private onStateChanged: () => void
  ) {}

  schedule(): void {
    this.clearTimers();
    const state = this.engine.getState();

    // Schedule an occasional charming bot emote after notable moves
    if (state.lastMove && state.lastMove.seq !== this.lastEmotedSeq) {
      const move = state.lastMove;
      this.lastEmotedSeq = move.seq;
      const bots = state.players.filter((p) => p.isBot);
      for (const bot of bots) {
        const emote = maybePickBotEmote(move, bot);
        if (emote) {
          const animDone = getAnimationCompleteAt(move);
          const delay = Math.max(250, animDone - Date.now() - 250);
          this.emoteTimer = window.setTimeout(() => {
            this.engine.sendEmote(bot.id, emote);
            this.onStateChanged();
          }, delay);
          break;
        }
      }
    }

    if (state.phase !== 'playing') {
      return;
    }

    const now = Date.now();
    const animDoneAt = getAnimationCompleteAt(state.lastMove);
    const current = state.players[state.turnIndex];

    if (current && (current.isBot || current.autoPlay)) {
      const thinkDelay = getBotThinkDelayMs(state);
      const runAt = Math.max(now + 220, animDoneAt + thinkDelay);
      this.botTimer = window.setTimeout(() => {
        const fresh = this.engine.getState();
        const active = fresh.players[fresh.turnIndex];
        if (
          fresh.phase !== 'playing' ||
          !active ||
          active.id !== current.id ||
          (!active.isBot && !active.autoPlay)
        ) {
          return;
        }
        const res = this.engine.rollDice(active.id);
        if (res.ok) {
          this.onStateChanged();
        }
      }, Math.max(50, runAt - now));
      return;
    }

    if (state.turnDeadline) {
      const timeoutAt = Math.max(state.turnDeadline, animDoneAt + 1000);
      this.turnTimer = window.setTimeout(() => {
        const res = this.engine.handleTurnTimeout();
        if (res.ok) {
          this.onStateChanged();
        }
      }, Math.max(50, timeoutAt - now));
    }
  }

  clearTimers(): void {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.turnTimer !== null) {
      window.clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.emoteTimer !== null) {
      window.clearTimeout(this.emoteTimer);
      this.emoteTimer = null;
    }
  }
}

// ==================== 1. LOCAL SOLO SESSION (1 HUMAN + 3 BOTS) ====================

export class LocalSoloSession implements GameSession {
  readonly mode = 'solo' as const;
  private engine: SnakesHostEngine;
  private automation: LocalAutomation;
  private listeners = new Set<SessionListener>();
  private hostId = 'local_player';
  private snapshot: SessionSnapshot;

  constructor(playerName: string) {
    this.engine = new SnakesHostEngine({
      code: 'SOLO',
      mode: 'solo',
      hostId: this.hostId,
      hostSessionId: 'solo',
      hostName: playerName || 'You',
    });
    this.engine.addBot(this.hostId);
    this.engine.addBot(this.hostId);
    this.engine.addBot(this.hostId);

    this.automation = new LocalAutomation(this.engine, () => this.emit());
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: null,
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  sendIntent(intent: ClientIntent): void {
    const res = this.engine.executeIntent(this.hostId, intent);
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: res.ok ? null : (res.error ?? 'Action rejected.'),
    };
    this.notify();
    this.automation.schedule();
  }

  private emit(): void {
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: null,
    };
    this.notify();
    this.automation.schedule();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  destroy(): void {
    this.automation.clearTimers();
    this.listeners.clear();
  }
}

// ==================== 2. LOCAL COUCH SESSION (PASS & PLAY) ====================

export class LocalCouchSession implements GameSession {
  readonly mode = 'couch' as const;
  private engine: SnakesHostEngine;
  private automation: LocalAutomation;
  private listeners = new Set<SessionListener>();
  private hostId = 'couch_p1';
  private snapshot: SessionSnapshot;

  constructor(playerOneName: string) {
    this.engine = new SnakesHostEngine({
      code: 'PLAY',
      mode: 'couch',
      hostId: this.hostId,
      hostSessionId: 'couch_1',
      hostName: playerOneName || 'Player 1',
    });
    this.engine.addLocalPlayer(this.hostId, 'Player 2');

    this.automation = new LocalAutomation(this.engine, () => this.emit());
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: null,
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  sendIntent(intent: ClientIntent): void {
    const state = this.engine.getState();
    // In couch mode during play, allow active human seat to roll/emote cleanly
    let actorId = this.hostId;
    if (
      state.phase === 'playing' &&
      (intent.type === 'ROLL_DICE' || intent.type === 'SEND_EMOTE')
    ) {
      const current = state.players[state.turnIndex];
      if (current && !current.isBot) {
        actorId = current.id;
      }
    }

    const res = this.engine.executeIntent(actorId, intent);
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: res.ok ? null : (res.error ?? 'Action rejected.'),
    };
    this.notify();
    this.automation.schedule();
  }

  private emit(): void {
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: null,
    };
    this.notify();
    this.automation.schedule();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  destroy(): void {
    this.automation.clearTimers();
    this.listeners.clear();
  }
}

// ==================== 3. AUTHORITATIVE CLOUDFLARE ROOM SESSION ====================

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 6_000;
const WAKE_PROBE_TIMEOUT_MS = 4_000;
const RECONNECT_DELAYS_MS = [400, 800, 1500, 3000, 5000];
const MAX_INITIAL_ATTEMPTS = 3;
const MAX_RECONNECT_ATTEMPTS = 40;

const FATAL_CLOSE_CODES = new Set([4001, 4003, 4004, 4009]);

export interface RoomSessionOptions {
  isCreator?: boolean;
  password?: string;
}

export class RoomMultiplayerSession implements GameSession {
  readonly mode = 'multiplayer' as const;
  private listeners = new Set<SessionListener>();
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private pongTimer: number | null = null;
  private reconnectTimer: number | null = null;

  private roomCode: string;
  private playerName: string;
  private sessionId: string;
  private password?: string;
  private isCreator: boolean;

  private hasReceivedState = false;
  private lastStateVersion = 0;
  private lastServerActivityAt = 0;
  private reconnectAttempts = 0;
  private fatalErrorReceived = false;
  private destroyed = false;

  private snapshot: SessionSnapshot = {
    room: null,
    status: 'connecting',
    transport: 'connecting',
    error: null,
  };

  constructor(roomCode: string, playerName: string, options: RoomSessionOptions = {}) {
    this.roomCode = roomCode.toUpperCase();
    this.playerName = playerName;
    this.password = options.password?.trim() || undefined;
    this.isCreator = Boolean(options.isCreator);
    this.sessionId = getOrCreateSessionId(this.roomCode);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleNetworkWake);
      window.addEventListener('focus', this.handleFocusWake);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.connect();
  }

  private createPeerId(): string {
    return `p_${this.sessionId.slice(0, 8)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private connect(): void {
    if (this.destroyed || this.fatalErrorReceived) return;
    this.clearReconnectTimer();
    this.clearHeartbeatTimers();

    if (this.ws) {
      const stale = this.ws;
      this.ws = null;
      try {
        stale.close(4000, 'Reconnecting');
      } catch {
        // ignore
      }
    }

    const peerId = this.createPeerId();
    const params: Record<string, string> = {
      role: this.isCreator && !this.hasReceivedState ? 'host' : 'peer',
      peerId,
      sessionId: this.sessionId,
      name: this.playerName,
    };
    if (this.password) {
      params.password = this.password;
    }

    const url = buildWsUrl(params, this.roomCode);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect('Unable to reach game server.');
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      if (this.destroyed || this.ws !== ws) {
        try {
          ws.close(1000);
        } catch {
          // ignore
        }
        return;
      }
      this.reconnectAttempts = 0;
      this.lastServerActivityAt = Date.now();
      this.startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      if (this.destroyed || this.ws !== ws || typeof event.data !== 'string') return;
      this.lastServerActivityAt = Date.now();
      this.clearPongTimer();

      if (event.data === 'pong' || event.data === '"pong"') return;

      let msg: RoomToClientMessage;
      try {
        msg = JSON.parse(event.data) as RoomToClientMessage;
      } catch {
        return;
      }
      this.handleServerMessage(msg);
    };

    ws.onerror = () => {
      // onclose follows onerror
    };

    ws.onclose = (ev) => {
      if (this.destroyed || this.ws !== ws) return;
      this.ws = null;
      this.clearHeartbeatTimers();

      if (this.fatalErrorReceived) return;

      if (FATAL_CLOSE_CODES.has(ev.code)) {
        const msg =
          ev.code === 4001
            ? 'Incorrect room password.'
            : ev.code === 4004
              ? 'Room not found or has already ended.'
              : ev.code === 4003
                ? ev.reason || 'You were removed from the room.'
                : ev.reason || 'Disconnected from the room.';
        this.failFatally(msg, ev.code === 4004 ? 'disconnected' : 'error');
        return;
      }

      this.scheduleReconnect('Connection interrupted. Trying to reconnect…');
    };
  }

  private startHeartbeat(ws: WebSocket): void {
    this.clearHeartbeatTimers();
    this.pingTimer = window.setInterval(() => {
      if (this.destroyed || this.ws !== ws) return;
      this.sendHeartbeatPing(ws, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private sendHeartbeatPing(ws: WebSocket, timeoutMs: number): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send('ping');
    } catch {
      this.forceReconnect(ws);
      return;
    }

    if (this.pongTimer === null) {
      this.pongTimer = window.setTimeout(() => {
        this.pongTimer = null;
        if (!this.destroyed && this.ws === ws) {
          this.forceReconnect(ws);
        }
      }, timeoutMs);
    }
  }

  private forceReconnect(ws: WebSocket): void {
    this.clearHeartbeatTimers();
    try {
      ws.close(4008, 'Heartbeat timeout');
    } catch {
      // ignore
    }
    if (this.ws === ws) {
      this.ws = null;
      this.scheduleReconnect('Connection timed out. Reconnecting…');
    }
  }

  private scheduleReconnect(fallbackError: string): void {
    if (this.destroyed || this.fatalErrorReceived) return;
    this.clearReconnectTimer();

    const maxAttempts = this.hasReceivedState ? MAX_RECONNECT_ATTEMPTS : MAX_INITIAL_ATTEMPTS;
    if (this.reconnectAttempts >= maxAttempts) {
      this.failFatally(
        this.hasReceivedState
          ? 'Lost connection to the room. Please rejoin from the lobby.'
          : fallbackError,
        'disconnected'
      );
      return;
    }

    const baseDelay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    const jitter = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempts += 1;

    if (this.hasReceivedState) {
      this.snapshot = {
        ...this.snapshot,
        status: 'reconnecting',
        transport: 'reconnecting',
      };
      this.notify();
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jitter);
  }

  private handleNetworkWake = (): void => {
    if (this.destroyed || this.fatalErrorReceived) return;
    this.reconnectAttempts = 0;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.connect();
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      this.sendHeartbeatPing(this.ws, WAKE_PROBE_TIMEOUT_MS);
    }
  };

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    this.probeOrReconnectOnWake();
  };

  private handleFocusWake = (): void => {
    this.probeOrReconnectOnWake();
  };

  private probeOrReconnectOnWake(): void {
    if (this.destroyed || this.fatalErrorReceived) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.reconnectAttempts = 0;
      this.connect();
      return;
    }
    if (
      this.ws.readyState === WebSocket.OPEN &&
      Date.now() - this.lastServerActivityAt > 4000
    ) {
      this.sendHeartbeatPing(this.ws, WAKE_PROBE_TIMEOUT_MS);
    }
  }

  private failFatally(message: string, status: 'disconnected' | 'error'): void {
    this.fatalErrorReceived = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimers();
    clearActiveRoom();
    this.snapshot = {
      ...this.snapshot,
      status,
      transport: 'connecting',
      error: message,
    };
    this.notify();
  }

  private handleServerMessage(msg: RoomToClientMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.reconnectAttempts = 0;
        this.snapshot = {
          ...this.snapshot,
          status: 'connected',
          transport: 'online',
          error: null,
        };
        this.notify();
        break;

      case 'STATE_SYNC':
        if (msg.state.stateVersion < this.lastStateVersion) return;
        this.lastStateVersion = msg.state.stateVersion;
        this.hasReceivedState = true;
        saveActiveRoom({ code: this.roomCode, name: this.playerName });
        this.snapshot = {
          room: msg.state,
          status: 'connected',
          transport: 'online',
          error: null,
        };
        this.notify();
        break;

      case 'ACTION_ERROR':
        this.snapshot = { ...this.snapshot, error: msg.message };
        this.notify();
        break;

      case 'KICKED':
        this.failFatally(msg.message || 'You were removed from the room.', 'error');
        break;

      case 'error':
        this.failFatally(msg.message || 'Unable to connect to room.', 'error');
        break;
    }
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      window.clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private clearHeartbeatTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  sendIntent(intent: ClientIntent): void {
    if (this.destroyed || this.fatalErrorReceived) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload: ClientToRoomMessage = { type: 'INTENT', intent };
      try {
        this.ws.send(JSON.stringify(payload));
        return;
      } catch {
        this.forceReconnect(this.ws);
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.CONNECTING) {
      this.reconnectAttempts = 0;
      this.connect();
    }
    this.snapshot = {
      ...this.snapshot,
      status: this.hasReceivedState ? 'reconnecting' : 'connecting',
      transport: this.hasReceivedState ? 'reconnecting' : 'connecting',
      error: 'Reconnecting to room…',
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  destroy(): void {
    this.destroyed = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimers();

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleNetworkWake);
      window.removeEventListener('focus', this.handleFocusWake);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'LEAVE' } satisfies ClientToRoomMessage));
        }
        ws.close(1000, 'Player left');
      } catch {
        // ignore
      }
    }
    this.listeners.clear();
  }
}

// ==================== ROOM API HELPERS ====================

export async function createRoomCode(hostName: string, password?: string): Promise<string> {
  const res = await fetch('/api/room/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostName, password: password?.trim() || '' }),
  });
  if (!res.ok) {
    throw new Error('Failed to create room.');
  }
  const data = (await res.json()) as { roomCode: string };
  return data.roomCode;
}

export interface OpenRoomsResult {
  rooms: LobbyListing[];
  ok: boolean;
}

export async function fetchOpenRoomsResult(): Promise<OpenRoomsResult> {
  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) return { rooms: [], ok: false };
    const data = (await res.json()) as { rooms?: LobbyListing[] };
    return { rooms: Array.isArray(data.rooms) ? data.rooms : [], ok: true };
  } catch {
    return { rooms: [], ok: false };
  }
}

export async function fetchOpenRooms(): Promise<LobbyListing[]> {
  const { rooms } = await fetchOpenRoomsResult();
  return rooms;
}

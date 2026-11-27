import { DurableObject } from 'cloudflare:workers';
import { getBotThinkDelayMs, maybePickBotEmote } from '../src/engine/bot';
import {
  MAX_PLAYERS,
  SnakesHostEngine,
  getAnimationCompleteAt,
} from '../src/engine/snakesEngine';
import type { ClientIntent, GamePhase, RoomState } from '../src/engine/types';

export interface RoomEnv {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

interface SocketAttachment {
  peerId: string;
  sessionId: string;
  name: string;
  replaced?: boolean;
  explicitLeave?: boolean;
  closed?: boolean;
}

interface IncomingClientMessage {
  type: string;
  intent?: ClientIntent;
}

export interface LobbyListing {
  code: string;
  hostName: string;
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  phase: GamePhase;
  rulesSummary: string;
  rejoinableCount: number;
  updatedAt: number;
}

const REGISTRY_NAME = '__LOBBY_REGISTRY__';
const ROOM_STALE_MS = 30 * 60 * 1000;
const EMPTY_GAME_TTL_MS = 10 * 60 * 1000;
const INIT_GRACE_MS = 2 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatPresetLabel(preset: string): string {
  if (preset === 'serpents_den') return "Serpent's Den";
  if (preset === 'shuffled') return 'Shuffled';
  return 'Classic';
}

export class GameRoomDO extends DurableObject<RoomEnv> {
  private registryInitialized = false;
  private roomSchemaInitialized = false;
  private roomLoaded = false;

  private roomCode = '';
  private passwordHash = '';
  private engine: SnakesHostEngine | null = null;
  private botActionAt: number | null = null;
  private emptySince: number | null = null;
  private createdAt = 0;
  private updatedAt = 0;
  private lastMetaKey = '';

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    // Handled natively by Cloudflare runtime without waking DO from hibernation
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ==================== SQLITE SCHEMAS & PERSISTENCE ====================

  private ensureRegistrySchema(): void {
    if (this.registryInitialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_name TEXT NOT NULL,
        has_password INTEGER NOT NULL DEFAULT 0,
        player_count INTEGER NOT NULL DEFAULT 1,
        max_players INTEGER NOT NULL DEFAULT 6,
        phase TEXT NOT NULL DEFAULT 'lobby',
        rules_summary TEXT NOT NULL DEFAULT '',
        rejoinable_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
    this.registryInitialized = true;
  }

  private ensureRoomSchema(): void {
    if (this.roomSchemaInitialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        room_code TEXT NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        state_json TEXT,
        bot_action_at INTEGER,
        empty_since INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.roomSchemaInitialized = true;
  }

  private ensureRoomLoaded(): void {
    if (this.roomLoaded) return;
    this.ensureRoomSchema();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_code, password_hash, state_json, bot_action_at, empty_since, created_at, updated_at
         FROM room_state WHERE id = 1`
      )
      .toArray();

    if (rows.length > 0) {
      const row = rows[0];
      this.roomCode = String(row.room_code || '');
      this.passwordHash = String(row.password_hash || '');
      this.botActionAt = row.bot_action_at !== null ? Number(row.bot_action_at) : null;
      this.emptySince = row.empty_since !== null ? Number(row.empty_since) : null;
      this.createdAt = Number(row.created_at || 0);
      this.updatedAt = Number(row.updated_at || 0);

      if (typeof row.state_json === 'string' && row.state_json.length > 0) {
        try {
          const parsed = JSON.parse(row.state_json) as RoomState;
          this.engine = SnakesHostEngine.fromState(parsed);
        } catch {
          this.engine = null;
        }
      } else {
        this.engine = null;
      }
    }

    this.roomLoaded = true;
  }

  private saveRoomRow(): void {
    this.ensureRoomSchema();
    const stateJson = this.engine ? JSON.stringify(this.engine.getState()) : null;
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO room_state
        (id, room_code, password_hash, state_json, bot_action_at, empty_since, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      this.roomCode,
      this.passwordHash,
      stateJson,
      this.botActionAt,
      this.emptySince,
      this.createdAt,
      this.updatedAt
    );
  }

  private async cleanupRoom(): Promise<void> {
    const code = this.roomCode;
    this.engine = null;
    this.passwordHash = '';
    this.botActionAt = null;
    this.emptySince = null;
    this.createdAt = 0;
    this.updatedAt = 0;
    this.lastMetaKey = '';

    this.ensureRoomSchema();
    this.ctx.storage.sql.exec('DELETE FROM room_state WHERE id = 1');
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // ignore
    }

    for (const ws of this.getClientSockets()) {
      try {
        const att = ws.deserializeAttachment() as SocketAttachment | null;
        if (att) ws.serializeAttachment({ ...att, closed: true });
        ws.close(4004, 'Room closed');
      } catch {
        // ignore
      }
    }

    if (code) {
      await this.unregisterFromLobby(code);
    }
  }

  // ==================== LOBBY REGISTRY HELPERS ====================

  private getRegistryStub(): DurableObjectStub {
    return this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromName(REGISTRY_NAME));
  }

  private async registerInLobby(meta: {
    code: string;
    hostName: string;
    hasPassword: boolean;
    playerCount: number;
    phase: GamePhase;
    rulesSummary: string;
    rejoinableCount: number;
  }): Promise<void> {
    try {
      await this.getRegistryStub().fetch('https://room.internal/registry/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      });
    } catch {
      // non-fatal
    }
  }

  private async unregisterFromLobby(code: string): Promise<void> {
    if (!code) return;
    try {
      await this.getRegistryStub().fetch(
        `https://room.internal/registry/${encodeURIComponent(code)}`,
        { method: 'DELETE' }
      );
    } catch {
      // non-fatal
    }
  }

  private async syncLobbyMeta(force = false): Promise<void> {
    if (!this.engine || !this.roomCode) return;
    const s = this.engine.getState();
    const host = s.players.find((p) => p.isHost) ?? s.players[0];
    const parts: string[] = [formatPresetLabel(s.rules.boardPreset)];
    if (s.rules.enableBump) parts.push('Bump');
    if (s.rules.exactFinishBounce) parts.push('Bounce 100');
    if (s.rules.turnDuration > 0) parts.push(`${s.rules.turnDuration}s`);
    const rulesSummary = parts.join(' · ');
    const rejoinableCount = s.players.filter((p) => p.disconnected && !p.isBot).length;
    const metaKey = `${host?.name ?? ''}|${s.players.length}|${s.phase}|${rulesSummary}|${rejoinableCount}|${Boolean(this.passwordHash)}`;
    if (!force && metaKey === this.lastMetaKey) return;
    this.lastMetaKey = metaKey;

    await this.registerInLobby({
      code: this.roomCode,
      hostName: host?.name ?? 'Host',
      hasPassword: Boolean(this.passwordHash),
      playerCount: s.players.length,
      phase: s.phase,
      rulesSummary,
      rejoinableCount,
    });
  }

  // ==================== WEBSOCKET HELPERS ====================

  private getClientSockets(): WebSocket[] {
    return this.ctx.getWebSockets('client').filter((s) => {
      const att = s.deserializeAttachment() as SocketAttachment | null;
      return Boolean(att && !att.closed && !att.replaced);
    });
  }

  private getSocketsBySession(sessionId: string): WebSocket[] {
    return this.ctx.getWebSockets(`sess:${sessionId}`).filter((s) => {
      const att = s.deserializeAttachment() as SocketAttachment | null;
      return Boolean(att && !att.closed && !att.replaced);
    });
  }

  private getSocketByPeerId(peerId: string): WebSocket | null {
    const matches = this.ctx.getWebSockets(`id:${peerId}`).filter((s) => {
      const att = s.deserializeAttachment() as SocketAttachment | null;
      return Boolean(att && !att.closed && !att.replaced);
    });
    return matches.length > 0 ? matches[0] : null;
  }

  private safeSend(ws: WebSocket | null, data: unknown): void {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // ignore closing socket
    }
  }

  private broadcastState(): void {
    if (!this.engine) return;
    const now = Date.now();
    for (const ws of this.getClientSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att || att.replaced || att.closed) continue;
      this.safeSend(ws, {
        type: 'STATE_SYNC',
        state: this.engine.getSanitizedState(att.peerId, now),
      });
    }
  }

  // ==================== ANIMATION-AWARE SCHEDULING & ALARMS ====================

  private computeNextSchedule(now: number): number | null {
    if (!this.engine) {
      return this.createdAt > 0 ? this.createdAt + INIT_GRACE_MS : null;
    }

    const state = this.engine.getState();
    const connectedCount = this.getClientSockets().length;
    const deadlines: number[] = [];

    // 1. Grace period deadlines for disconnected humans
    for (const p of state.players) {
      if (p.disconnected && !p.isBot && typeof p.reconnectGraceUntil === 'number') {
        deadlines.push(p.reconnectGraceUntil);
      }
    }

    if (connectedCount === 0) {
      this.botActionAt = null;
      if (this.emptySince === null) {
        this.emptySince = now;
      }
      if (state.phase === 'lobby') {
        deadlines.push(this.emptySince + 25_000);
      } else {
        deadlines.push(this.emptySince + EMPTY_GAME_TTL_MS);
      }
    } else {
      this.emptySince = null;
      deadlines.push(this.updatedAt + ROOM_STALE_MS);

      if (state.phase !== 'playing') {
        this.botActionAt = null;
      } else {
        const animDoneAt = getAnimationCompleteAt(state.lastMove);
        const current = state.players[state.turnIndex];
        const waitingForGrace = Boolean(
          current?.disconnected && !current.isBot && typeof current.reconnectGraceUntil === 'number'
        );

        if (!waitingForGrace && current && (current.isBot || current.autoPlay)) {
          if (this.botActionAt === null) {
            const delay = getBotThinkDelayMs(state);
            this.botActionAt = Math.max(now + 240, animDoneAt + delay);
          } else if (this.botActionAt < animDoneAt) {
            this.botActionAt = animDoneAt + 320;
          }
          deadlines.push(this.botActionAt);
        } else {
          this.botActionAt = null;
          if (!waitingForGrace && typeof state.turnDeadline === 'number') {
            const safeDeadline = Math.max(state.turnDeadline, animDoneAt + 500);
            deadlines.push(safeDeadline);
          }
        }
      }
    }

    if (deadlines.length === 0) return null;
    return Math.min(...deadlines);
  }

  private async commitAndBroadcast(forceLobbySync = false): Promise<void> {
    const now = Date.now();
    this.updatedAt = now;
    const nextAlarm = this.computeNextSchedule(now);
    this.saveRoomRow();

    if (nextAlarm !== null) {
      await this.ctx.storage.setAlarm(Math.max(now + 25, nextAlarm));
    } else {
      await this.ctx.storage.deleteAlarm();
    }

    this.broadcastState();
    await this.syncLobbyMeta(forceLobbySync);
  }

  async alarm(): Promise<void> {
    this.ensureRoomLoaded();
    const now = Date.now();

    if (!this.engine) {
      if (this.createdAt > 0 && now - this.createdAt >= INIT_GRACE_MS) {
        await this.cleanupRoom();
      }
      return;
    }

    const connectedCount = this.getClientSockets().length;

    if (connectedCount === 0) {
      this.engine.expireReconnectGrace(now);
      const s = this.engine.getState();

      if (s.phase === 'lobby' && !this.engine.hasHumanPlayers()) {
        await this.cleanupRoom();
        return;
      }

      if (this.emptySince !== null && now - this.emptySince >= EMPTY_GAME_TTL_MS) {
        await this.cleanupRoom();
        return;
      }

      const nextAlarm = this.computeNextSchedule(now);
      this.saveRoomRow();
      if (nextAlarm !== null) {
        await this.ctx.storage.setAlarm(Math.max(now + 50, nextAlarm));
      }
      await this.syncLobbyMeta();
      return;
    }

    if (this.updatedAt > 0 && now - this.updatedAt >= ROOM_STALE_MS) {
      await this.cleanupRoom();
      return;
    }

    let changed = false;

    if (this.engine.expireReconnectGrace(now)) {
      changed = true;
      this.botActionAt = null;
      if (this.engine.getState().phase === 'lobby' && !this.engine.hasHumanPlayers()) {
        await this.cleanupRoom();
        return;
      }
    }

    const fresh = this.engine.getState();
    if (fresh.phase === 'playing') {
      const animDoneAt = getAnimationCompleteAt(fresh.lastMove);
      const current = fresh.players[fresh.turnIndex];
      const currentInGrace = Boolean(
        current?.disconnected && !current.isBot && typeof current.reconnectGraceUntil === 'number'
      );

      if (
        current &&
        !currentInGrace &&
        (current.isBot || current.autoPlay) &&
        this.botActionAt !== null &&
        now >= this.botActionAt &&
        now >= animDoneAt
      ) {
        this.botActionAt = null;
        const res = this.engine.rollDice(current.id, undefined, now);
        if (res.ok) {
          changed = true;
          const after = this.engine.getState();
          if (current.isBot && after.lastMove) {
            const emote = maybePickBotEmote(after.lastMove, current);
            if (emote) {
              this.engine.sendEmote(current.id, emote, now);
            }
          }
        }
      } else if (
        !currentInGrace &&
        typeof fresh.turnDeadline === 'number' &&
        now >= Math.max(fresh.turnDeadline, animDoneAt + 500)
      ) {
        if (this.engine.handleTurnTimeout(now).ok) {
          changed = true;
        }
      }
    }

    if (changed) {
      await this.commitAndBroadcast();
    } else {
      const nextAlarm = this.computeNextSchedule(now);
      this.saveRoomRow();
      if (nextAlarm !== null) {
        await this.ctx.storage.setAlarm(Math.max(now + 25, nextAlarm));
      }
    }
  }

  // ==================== HTTP & WEBSOCKET ENTRYPOINT ====================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ==================== LOBBY REGISTRY ROUTES ====================
    if (url.pathname === '/registry/list') {
      this.ensureRegistrySchema();
      const cutoff = Date.now() - ROOM_STALE_MS;
      this.ctx.storage.sql.exec('DELETE FROM rooms WHERE updated_at < ?', cutoff);
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT code, host_name, has_password, player_count, max_players, phase, rules_summary, rejoinable_count, updated_at
           FROM rooms
           ORDER BY CASE WHEN phase = 'lobby' THEN 0 WHEN rejoinable_count > 0 THEN 1 ELSE 2 END, updated_at DESC
           LIMIT 30`
        )
        .toArray();
      const rooms: LobbyListing[] = rows.map((r) => ({
        code: String(r.code),
        hostName: String(r.host_name),
        hasPassword: Number(r.has_password) === 1,
        playerCount: Number(r.player_count),
        maxPlayers: Number(r.max_players),
        phase: (String(r.phase) as GamePhase) || 'lobby',
        rulesSummary: String(r.rules_summary || ''),
        rejoinableCount: Number(r.rejoinable_count || 0),
        updatedAt: Number(r.updated_at),
      }));
      return Response.json({ rooms });
    }

    if (url.pathname === '/registry/upsert' && request.method === 'POST') {
      this.ensureRegistrySchema();
      const body = (await request.json()) as {
        code: string;
        hostName: string;
        hasPassword: boolean;
        playerCount: number;
        phase: GamePhase;
        rulesSummary?: string;
        rejoinableCount?: number;
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO rooms (code, host_name, has_password, player_count, max_players, phase, rules_summary, rejoinable_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           host_name = excluded.host_name,
           has_password = excluded.has_password,
           player_count = excluded.player_count,
           phase = excluded.phase,
           rules_summary = excluded.rules_summary,
           rejoinable_count = excluded.rejoinable_count,
           updated_at = excluded.updated_at`,
        body.code.toUpperCase(),
        (body.hostName || 'Host').slice(0, 24),
        body.hasPassword ? 1 : 0,
        Math.max(1, Math.min(MAX_PLAYERS, Number(body.playerCount) || 1)),
        MAX_PLAYERS,
        body.phase || 'lobby',
        (body.rulesSummary || '').slice(0, 80),
        Math.max(0, Math.min(MAX_PLAYERS, Number(body.rejoinableCount) || 0)),
        Date.now()
      );
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith('/registry/') && request.method === 'DELETE') {
      this.ensureRegistrySchema();
      const code = decodeURIComponent(url.pathname.slice('/registry/'.length)).toUpperCase();
      this.ctx.storage.sql.exec('DELETE FROM rooms WHERE code = ?', code);
      return Response.json({ ok: true });
    }

    // ==================== ROOM STATUS & INIT ====================
    if (url.pathname.endsWith('/status')) {
      this.ensureRoomLoaded();
      const now = Date.now();
      const isPendingInit =
        this.engine === null && this.createdAt > 0 && now - this.createdAt < INIT_GRACE_MS;
      const hasActiveRoom = this.engine !== null || isPendingInit;
      const roomState = this.engine?.getState();
      const host = roomState?.players.find((p) => p.isHost) ?? roomState?.players[0];
      return Response.json({
        exists: hasActiveRoom,
        hasHost: hasActiveRoom,
        active: hasActiveRoom,
        peerCount: this.getClientSockets().length,
        playerCount: roomState?.players.length ?? 0,
        maxPlayers: MAX_PLAYERS,
        phase: roomState?.phase ?? 'lobby',
        hostName: host?.name ?? null,
        hasPassword: Boolean(this.passwordHash),
      });
    }

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      this.ensureRoomLoaded();
      const body = (await request.json()) as {
        code: string;
        hostName?: string;
        password?: string;
      };
      const code = body.code.toUpperCase();
      const cleanPass = (body.password || '').trim();
      const now = Date.now();

      this.roomCode = code;
      this.passwordHash = cleanPass ? await sha256Hex(cleanPass) : '';
      this.engine = null;
      this.botActionAt = null;
      this.emptySince = now;
      this.createdAt = now;
      this.updatedAt = now;
      this.lastMetaKey = '';

      this.saveRoomRow();
      await this.ctx.storage.setAlarm(now + INIT_GRACE_MS);
      return Response.json({ ok: true });
    }

    // ==================== WEBSOCKET ROOM CONNECTION ====================
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    this.ensureRoomLoaded();

    const roleParam = url.searchParams.get('role');
    const isCreatorConnect = roleParam === 'host';
    const sessionId = (url.searchParams.get('sessionId') || crypto.randomUUID()).slice(0, 64);
    const requestedPeerId = (
      url.searchParams.get('peerId') || `p_${crypto.randomUUID().slice(0, 8)}`
    ).slice(0, 48);
    const name = (url.searchParams.get('name') || (isCreatorConnect ? 'Host' : 'Player')).slice(
      0,
      24
    );
    const password = (url.searchParams.get('password') || '').trim();
    const roomCodeFromUrl =
      url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4})\/ws$/)?.[1]?.toUpperCase() || '';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Case 1: Brand new room awaiting creator's first WebSocket connection
    if (!this.engine) {
      const hasPendingInit = this.createdAt > 0 && Date.now() - this.createdAt < INIT_GRACE_MS;
      if (!isCreatorConnect || !hasPendingInit) {
        server.accept();
        this.safeSend(server, {
          type: 'error',
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found or has already ended.',
        });
        server.close(4004, 'Room not found');
        return new Response(null, { status: 101, webSocket: client });
      }

      const code = roomCodeFromUrl || this.roomCode || 'ROOM';
      this.roomCode = code;

      this.engine = new SnakesHostEngine({
        code,
        mode: 'multiplayer',
        hostId: requestedPeerId,
        hostSessionId: sessionId,
        hostName: name,
      });
      this.engine.setPeerTransport(requestedPeerId, 'online');

      const attachment: SocketAttachment = { peerId: requestedPeerId, sessionId, name };
      this.ctx.acceptWebSocket(server, ['client', `id:${requestedPeerId}`, `sess:${sessionId}`]);
      server.serializeAttachment(attachment);

      this.safeSend(server, { type: 'welcome', peerId: requestedPeerId, sessionId });
      await this.commitAndBroadcast(true);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Case 2: Joining or reconnecting to an existing active room
    const existingSeat = this.engine.getState().players.find((p) => p.sessionId === sessionId);

    // Password check (bypassed when restoring an existing session)
    if (this.passwordHash && !existingSeat) {
      const providedHash = password ? await sha256Hex(password) : '';
      if (providedHash !== this.passwordHash) {
        server.accept();
        this.safeSend(server, {
          type: 'error',
          code: 'WRONG_PASSWORD',
          message: password ? 'Incorrect room password.' : 'This room requires a password.',
        });
        server.close(4001, 'Wrong password');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    const wasEmpty = this.getClientSockets().length === 0;

    const res = this.engine.addOrRestorePeer({
      peerId: requestedPeerId,
      sessionId,
      name,
      transport: 'online',
    });

    if (!res.ok) {
      server.accept();
      this.safeSend(server, {
        type: 'error',
        code: 'JOIN_REJECTED',
        message: res.error ?? 'Unable to join room.',
      });
      server.close(4003, res.error ?? 'Unable to join room');
      return new Response(null, { status: 101, webSocket: client });
    }

    const effectivePeerId = res.peerId ?? requestedPeerId;

    // Close any stale/previous sockets for this same sessionId without triggering grace
    for (const oldWs of this.getSocketsBySession(sessionId)) {
      try {
        const oldAtt = oldWs.deserializeAttachment() as SocketAttachment | null;
        if (oldAtt) {
          oldWs.serializeAttachment({ ...oldAtt, replaced: true });
        }
        oldWs.close(4000, 'Replaced by reconnect');
      } catch {
        // ignore
      }
    }

    if (wasEmpty && this.engine.getState().phase === 'playing') {
      this.engine.refreshTurnDeadlineIfNeeded();
    }

    const attachment: SocketAttachment = { peerId: effectivePeerId, sessionId, name };
    this.ctx.acceptWebSocket(server, ['client', `id:${effectivePeerId}`, `sess:${sessionId}`]);
    server.serializeAttachment(attachment);

    this.safeSend(server, { type: 'welcome', peerId: effectivePeerId, sessionId });
    await this.commitAndBroadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message === 'ping') {
      try {
        ws.send('pong');
      } catch {
        // ignore
      }
      return;
    }

    let parsed: IncomingClientMessage;
    try {
      parsed = JSON.parse(message) as IncomingClientMessage;
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att || att.replaced || att.closed) return;

    this.ensureRoomLoaded();
    if (!this.engine) {
      this.safeSend(ws, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'This room has already ended.',
      });
      try {
        ws.close(4004, 'Room closed');
      } catch {
        // ignore
      }
      return;
    }

    if (parsed.type === 'LEAVE') {
      try {
        ws.serializeAttachment({ ...att, explicitLeave: true });
      } catch {
        // ignore
      }
      await this.handleDisconnect(ws, true);
      try {
        ws.close(1000, 'Player left');
      } catch {
        // ignore
      }
      return;
    }

    if (parsed.type === 'INTENT' && parsed.intent) {
      const res = this.engine.executeIntent(att.peerId, parsed.intent);
      if (!res.ok) {
        if (res.error) {
          this.safeSend(ws, { type: 'ACTION_ERROR', message: res.error });
        }
        return;
      }

      if (res.kickedPeerId) {
        const kickedWs = this.getSocketByPeerId(res.kickedPeerId);
        if (kickedWs) {
          try {
            const kAtt = kickedWs.deserializeAttachment() as SocketAttachment | null;
            if (kAtt) kickedWs.serializeAttachment({ ...kAtt, replaced: true, closed: true });
          } catch {
            // ignore
          }
          this.safeSend(kickedWs, {
            type: 'KICKED',
            message: 'You were removed from the lobby by the host.',
          });
          try {
            kickedWs.close(4003, 'Kicked by host');
          } catch {
            // ignore
          }
        }
      }

      this.botActionAt = null;
      await this.commitAndBroadcast();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws, false);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws, false);
  }

  private async handleDisconnect(ws: WebSocket, forceExplicit: boolean): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att || att.replaced || att.closed) return;

    try {
      ws.serializeAttachment({ ...att, closed: true });
    } catch {
      // ignore
    }

    const siblingActive = this.getSocketsBySession(att.sessionId).some((s) => s !== ws);
    if (siblingActive) return;

    this.ensureRoomLoaded();
    if (!this.engine) return;

    const explicit = forceExplicit || Boolean(att.explicitLeave);
    this.engine.handlePeerDisconnect(att.peerId, explicit);

    if (this.engine.getState().phase === 'lobby' && !this.engine.hasHumanPlayers()) {
      await this.cleanupRoom();
      return;
    }

    await this.commitAndBroadcast();
  }
}

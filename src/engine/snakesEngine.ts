import { DEFAULT_RULES, PAWN_COLOR_ORDER, getPortalsForRules } from './boards';
import type {
  ActivityEntry,
  BumpedEntry,
  ClientIntent,
  EmoteId,
  GameMode,
  GameRules,
  PawnColorId,
  Player,
  PlayerStats,
  PlayerTransport,
  RoomState,
  SanitizedRoomState,
  TurnMoveEvent,
} from './types';

export const MAX_PLAYERS = 6;
export const RECONNECT_GRACE_MS = 30_000;
export const ANIMATION_COOLDOWN_MS = 450;
export const BUMP_KNOCKBACK_TILES = 6;

const BOT_NAMES = ['Pip', 'Milo', 'Saffron', 'Bramble', 'Clover', 'Juniper'];
const VALID_TURN_DURATIONS = new Set([0, 10, 15, 30]);
const VALID_EMOTES = new Set<EmoteId>([
  'dice',
  'snake',
  'ladder',
  'laugh',
  'fire',
  'cry',
  'clap',
  'crown',
]);
const MAX_ACTIVITY = 24;

export interface ActionResult {
  ok: boolean;
  error?: string;
  kickedPeerId?: string;
  peerId?: string;
}

export interface HostEngineInit {
  code: string;
  mode: GameMode;
  hostId: string;
  hostSessionId: string;
  hostName: string;
  boardSeed?: string;
  rules?: Partial<GameRules>;
}

function emptyStats(): PlayerStats {
  return {
    rolls: 0,
    sixes: 0,
    laddersClimbed: 0,
    snakesBitten: 0,
    bumpsGiven: 0,
    bumpsTaken: 0,
  };
}

function sanitizeName(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return cleaned || fallback;
}

function randomSeed(prefix = 'seed'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return `${prefix}_${bytes[0].toString(36)}${bytes[1].toString(36)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function rollFairDie(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(1);
    // Rejection sampling for exact uniformity on 1..6 (252 is divisible by 6)
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < 252) {
        return (buf[0] % 6) + 1;
      }
    }
  }
  return Math.floor(Math.random() * 6) + 1;
}

export function estimateMoveAnimDurationMs(opts: {
  stepCount: number;
  hasPortal: boolean;
  bumpCount: number;
  tripleSixBust: boolean;
  grantedExtraRoll?: boolean;
}): number {
  if (opts.tripleSixBust) {
    return 1980;
  }
  return (
    1420 +
    opts.stepCount * 220 +
    (opts.hasPortal ? 1380 : 0) +
    (opts.bumpCount > 0 ? 450 : 0) +
    (opts.grantedExtraRoll ? 320 : 0)
  );
}

export function getAnimationCompleteAt(move: TurnMoveEvent | null): number {
  if (!move) return 0;
  return move.timestamp + move.animDurationMs + ANIMATION_COOLDOWN_MS;
}

export class SnakesHostEngine {
  private state: RoomState;
  private moveSeqCounter = 0;

  constructor(init: HostEngineInit) {
    const rules: GameRules = {
      ...DEFAULT_RULES,
      ...(init.rules ?? {}),
    };
    const boardSeed = init.boardSeed ?? randomSeed(init.code || 'board');
    const hostName = sanitizeName(init.hostName, 'Player 1');

    const host: Player = {
      id: init.hostId,
      sessionId: init.hostSessionId,
      name: hostName,
      color: PAWN_COLOR_ORDER[0],
      isHost: true,
      isReady: true,
      isBot: false,
      disconnected: false,
      reconnectGraceUntil: null,
      autoPlay: false,
      transport: init.mode === 'multiplayer' ? 'online' : 'local',
      tile: 0,
      wins: 0,
      stats: emptyStats(),
    };

    this.state = {
      code: init.code.toUpperCase(),
      mode: init.mode,
      phase: 'lobby',
      rules,
      boardSeed,
      portals: getPortalsForRules(rules.boardPreset, boardSeed),
      players: [host],
      turnIndex: 0,
      consecutiveSixes: 0,
      turnNumber: 0,
      matchNumber: 0,
      lastMove: null,
      lastEmote: null,
      winnerId: null,
      podium: [],
      turnDeadline: null,
      activity: [],
      stateVersion: 1,
    };
  }

  static fromState(raw: RoomState): SnakesHostEngine {
    const engine = Object.create(SnakesHostEngine.prototype) as SnakesHostEngine;
    engine.state = raw;
    engine.moveSeqCounter = raw.lastMove?.seq ?? 0;
    return engine;
  }

  getState(): RoomState {
    return this.state;
  }

  getSanitizedState(viewerId: string, now = Date.now()): SanitizedRoomState {
    return {
      ...this.state,
      viewerId,
      serverNow: now,
      players: this.state.players.map(({ sessionId: _omit, ...rest }) => ({
        ...rest,
        stats: { ...rest.stats },
      })),
    };
  }

  hasHumanPlayers(): boolean {
    return this.state.players.some((p) => !p.isBot);
  }

  hasConnectedHumanPlayers(): boolean {
    return this.state.players.some((p) => !p.isBot && !p.disconnected);
  }

  private bumpVersion(): void {
    this.state.stateVersion += 1;
  }

  private pushActivity(
    text: string,
    tone: ActivityEntry['tone'],
    now = Date.now()
  ): void {
    const entry: ActivityEntry = {
      id: `act_${this.state.stateVersion}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      tone,
      timestamp: now,
    };
    this.state.activity = [entry, ...this.state.activity].slice(0, MAX_ACTIVITY);
  }

  private pickAvailableColor(): PawnColorId {
    const taken = new Set(this.state.players.map((p) => p.color));
    for (const color of PAWN_COLOR_ORDER) {
      if (!taken.has(color)) return color;
    }
    return PAWN_COLOR_ORDER[this.state.players.length % PAWN_COLOR_ORDER.length];
  }

  private pickBotName(): string {
    const used = new Set(this.state.players.map((p) => p.name.toLowerCase()));
    for (const candidate of BOT_NAMES) {
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
    return `Bot ${this.state.players.filter((p) => p.isBot).length + 1}`;
  }

  private ensureHostAssigned(): void {
    if (this.state.players.length === 0) return;
    const currentHost = this.state.players.find((p) => p.isHost);
    if (currentHost && !currentHost.disconnected && !currentHost.isBot) {
      return;
    }

    const activeHuman = this.state.players.find((p) => !p.isBot && !p.disconnected);
    const anyHuman = this.state.players.find((p) => !p.isBot);
    const nextHost = activeHuman ?? anyHuman ?? this.state.players[0];

    for (const p of this.state.players) {
      p.isHost = p.id === nextHost.id;
      if (p.isHost) {
        p.isReady = true;
      }
    }
  }

  private computeTurnDeadline(now: number, animDurationMs = 0): number | null {
    if (this.state.phase !== 'playing') return null;
    if (this.state.rules.turnDuration <= 0) return null;
    const active = this.state.players[this.state.turnIndex];
    if (!active || active.isBot || active.autoPlay) return null;
    const animBuffer = animDurationMs > 0 ? animDurationMs + ANIMATION_COOLDOWN_MS : 0;
    return now + animBuffer + this.state.rules.turnDuration * 1000;
  }

  // ==================== PEER LIFECYCLE ====================

  setPeerTransport(peerId: string, transport: PlayerTransport): void {
    const p = this.state.players.find((x) => x.id === peerId);
    if (!p) return;
    p.transport = transport;
  }

  addOrRestorePeer(opts: {
    peerId: string;
    sessionId: string;
    name: string;
    transport?: PlayerTransport;
    now?: number;
  }): ActionResult {
    const now = opts.now ?? Date.now();
    const transport = opts.transport ?? 'online';
    const existing = this.state.players.find((p) => p.sessionId === opts.sessionId);

    if (existing) {
      existing.disconnected = false;
      existing.reconnectGraceUntil = null;
      existing.autoPlay = false;
      existing.transport = transport;
      if (opts.name && opts.name.trim()) {
        existing.name = sanitizeName(opts.name, existing.name);
      }
      this.ensureHostAssigned();
      this.pushActivity(`${existing.name} reconnected.`, 'neutral', now);
      this.bumpVersion();
      return { ok: true, peerId: existing.id };
    }

    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'This match is already in progress.' };
    }

    if (this.state.players.length >= MAX_PLAYERS) {
      return { ok: false, error: `Room is full (${MAX_PLAYERS}/${MAX_PLAYERS} players).` };
    }

    const playerName = sanitizeName(opts.name, `Player ${this.state.players.length + 1}`);
    const player: Player = {
      id: opts.peerId,
      sessionId: opts.sessionId,
      name: playerName,
      color: this.pickAvailableColor(),
      isHost: false,
      isReady: false,
      isBot: false,
      disconnected: false,
      reconnectGraceUntil: null,
      autoPlay: false,
      transport,
      tile: 0,
      wins: 0,
      stats: emptyStats(),
    };

    this.state.players.push(player);
    this.ensureHostAssigned();
    this.pushActivity(`${player.name} joined the lobby.`, 'neutral', now);
    this.bumpVersion();
    return { ok: true, peerId: player.id };
  }

  handlePeerDisconnect(peerId: string, explicitLeave: boolean, now = Date.now()): void {
    const idx = this.state.players.findIndex((p) => p.id === peerId);
    if (idx === -1) return;
    const player = this.state.players[idx];
    if (player.isBot) return;

    if (this.state.phase === 'lobby') {
      if (explicitLeave) {
        this.state.players.splice(idx, 1);
        this.ensureHostAssigned();
        this.pushActivity(`${player.name} left the lobby.`, 'neutral', now);
      } else {
        player.disconnected = true;
        player.reconnectGraceUntil = now + RECONNECT_GRACE_MS;
        player.transport = 'reconnecting';
      }
      this.bumpVersion();
      return;
    }

    // Playing or gameover: keep seat so the match continues smoothly
    player.disconnected = true;
    if (explicitLeave) {
      player.reconnectGraceUntil = null;
      player.autoPlay = true;
      player.transport = 'reconnecting';
      this.ensureHostAssigned();
      this.pushActivity(`${player.name} left — auto-play enabled.`, 'neutral', now);
    } else {
      player.reconnectGraceUntil = now + RECONNECT_GRACE_MS;
      player.transport = 'reconnecting';
      this.pushActivity(`${player.name} disconnected (30s grace).`, 'neutral', now);
    }
    this.bumpVersion();
  }

  expireReconnectGrace(now = Date.now()): boolean {
    let changed = false;

    if (this.state.phase === 'lobby') {
      const before = this.state.players.length;
      const expired = this.state.players.filter(
        (p) =>
          p.disconnected &&
          !p.isBot &&
          typeof p.reconnectGraceUntil === 'number' &&
          now >= p.reconnectGraceUntil
      );
      if (expired.length > 0) {
        const expiredIds = new Set(expired.map((p) => p.id));
        this.state.players = this.state.players.filter((p) => !expiredIds.has(p.id));
        if (this.state.players.length !== before) {
          this.ensureHostAssigned();
          for (const p of expired) {
            this.pushActivity(`${p.name} timed out from the lobby.`, 'neutral', now);
          }
          changed = true;
        }
      }
    } else {
      for (const p of this.state.players) {
        if (
          p.disconnected &&
          !p.isBot &&
          typeof p.reconnectGraceUntil === 'number' &&
          now >= p.reconnectGraceUntil
        ) {
          p.reconnectGraceUntil = null;
          p.autoPlay = true;
          this.pushActivity(`${p.name} switched to auto-play.`, 'neutral', now);
          changed = true;
        }
      }
      if (changed) {
        this.ensureHostAssigned();
      }
    }

    if (changed) {
      this.bumpVersion();
    }
    return changed;
  }

  refreshTurnDeadlineIfNeeded(now = Date.now()): void {
    if (this.state.phase !== 'playing') return;
    if (this.state.rules.turnDuration <= 0) {
      this.state.turnDeadline = null;
      return;
    }
    const active = this.state.players[this.state.turnIndex];
    if (!active || active.isBot || active.autoPlay) {
      this.state.turnDeadline = null;
      return;
    }
    const animEnd = getAnimationCompleteAt(this.state.lastMove);
    const minDeadline = Math.max(now, animEnd) + this.state.rules.turnDuration * 1000;
    if (!this.state.turnDeadline || this.state.turnDeadline < now + 3000) {
      this.state.turnDeadline = minDeadline;
      this.bumpVersion();
    }
  }

  // ==================== LOBBY & RULES INTENTS ====================

  addBot(actorId: string, now = Date.now()): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can add bots.' };
    }
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Cannot add bots after the match has started.' };
    }
    if (this.state.players.length >= MAX_PLAYERS) {
      return { ok: false, error: `Maximum ${MAX_PLAYERS} players reached.` };
    }

    const botIndex = this.state.players.filter((p) => p.isBot).length + 1;
    const bot: Player = {
      id: `bot_${botIndex}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId: `bot_sess_${Math.random().toString(36).slice(2, 8)}`,
      name: this.pickBotName(),
      color: this.pickAvailableColor(),
      isHost: false,
      isReady: true,
      isBot: true,
      disconnected: false,
      reconnectGraceUntil: null,
      autoPlay: false,
      transport: 'local',
      tile: 0,
      wins: 0,
      stats: emptyStats(),
    };

    this.state.players.push(bot);
    this.pushActivity(`${bot.name} (Bot) joined.`, 'neutral', now);
    this.bumpVersion();
    return { ok: true };
  }

  addLocalPlayer(actorId: string, name?: string, now = Date.now()): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can add local players.' };
    }
    if (this.state.mode === 'multiplayer') {
      return { ok: false, error: 'Share the room code for online friends to join.' };
    }
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Cannot add players mid-game.' };
    }
    if (this.state.players.length >= MAX_PLAYERS) {
      return { ok: false, error: `Maximum ${MAX_PLAYERS} players reached.` };
    }

    const humanCount = this.state.players.filter((p) => !p.isBot).length + 1;
    const localPlayer: Player = {
      id: `local_${humanCount}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId: `local_sess_${humanCount}`,
      name: sanitizeName(name, `Player ${humanCount}`),
      color: this.pickAvailableColor(),
      isHost: false,
      isReady: true,
      isBot: false,
      disconnected: false,
      reconnectGraceUntil: null,
      autoPlay: false,
      transport: 'local',
      tile: 0,
      wins: 0,
      stats: emptyStats(),
    };

    this.state.players.push(localPlayer);
    this.pushActivity(`${localPlayer.name} joined the board.`, 'neutral', now);
    this.bumpVersion();
    return { ok: true };
  }

  removePlayer(actorId: string, targetId: string, now = Date.now()): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can remove players.' };
    }
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Players can only be removed in the lobby.' };
    }
    if (actorId === targetId) {
      return { ok: false, error: 'Host cannot remove themselves.' };
    }

    const idx = this.state.players.findIndex((p) => p.id === targetId);
    if (idx === -1) {
      return { ok: false, error: 'Player not found.' };
    }

    const [removed] = this.state.players.splice(idx, 1);
    this.pushActivity(`${removed.name} was removed.`, 'neutral', now);
    this.bumpVersion();
    return {
      ok: true,
      kickedPeerId: !removed.isBot && this.state.mode === 'multiplayer' ? removed.id : undefined,
    };
  }

  private selectColor(actorId: string, color: PawnColorId): ActionResult {
    if (!PAWN_COLOR_ORDER.includes(color)) {
      return { ok: false, error: 'Invalid pawn color.' };
    }
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Colors can only be changed in the lobby.' };
    }
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player) return { ok: false, error: 'Player not found.' };

    const holder = this.state.players.find((p) => p.color === color && p.id !== actorId);
    if (holder) {
      return { ok: false, error: `${holder.name} is already using that color.` };
    }

    player.color = color;
    this.bumpVersion();
    return { ok: true };
  }

  private toggleReady(actorId: string): ActionResult {
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Game has already started.' };
    }
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player) return { ok: false, error: 'Player not found.' };
    if (player.isHost) {
      player.isReady = true;
      return { ok: true };
    }
    player.isReady = !player.isReady;
    this.bumpVersion();
    return { ok: true };
  }

  private updateRules(actorId: string, patch: Partial<GameRules>): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can change rules.' };
    }
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Rules can only be changed in the lobby.' };
    }

    const nextRules: GameRules = { ...this.state.rules };
    let regenPortals = false;

    if (
      patch.boardPreset === 'classic' ||
      patch.boardPreset === 'serpents_den' ||
      patch.boardPreset === 'shuffled'
    ) {
      if (patch.boardPreset !== nextRules.boardPreset || patch.boardPreset === 'shuffled') {
        regenPortals = true;
      }
      nextRules.boardPreset = patch.boardPreset;
    }
    if (typeof patch.exactFinishBounce === 'boolean') {
      nextRules.exactFinishBounce = patch.exactFinishBounce;
    }
    if (typeof patch.extraRollOnSix === 'boolean') {
      nextRules.extraRollOnSix = patch.extraRollOnSix;
    }
    if (typeof patch.tripleSixPenalty === 'boolean') {
      nextRules.tripleSixPenalty = patch.tripleSixPenalty;
    }
    if (typeof patch.enableBump === 'boolean') {
      nextRules.enableBump = patch.enableBump;
    }
    if (typeof patch.turnDuration === 'number' && VALID_TURN_DURATIONS.has(patch.turnDuration)) {
      nextRules.turnDuration = patch.turnDuration;
    }

    this.state.rules = nextRules;
    if (regenPortals) {
      if (nextRules.boardPreset === 'shuffled') {
        this.state.boardSeed = randomSeed(this.state.code);
      }
      this.state.portals = getPortalsForRules(nextRules.boardPreset, this.state.boardSeed);
    }

    this.bumpVersion();
    return { ok: true };
  }

  // ==================== GAME FLOW & TURN RESOLUTION ====================

  startGame(actorId: string, now = Date.now()): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can start the game.' };
    }
    if (this.state.phase !== 'lobby') {
      return { ok: false, error: 'Game is already running.' };
    }
    if (this.state.players.length < 2) {
      return { ok: false, error: 'Add at least one more player or bot to start.' };
    }
    if (this.state.mode === 'multiplayer') {
      const unready = this.state.players.filter((p) => !p.isHost && !p.isBot && !p.isReady);
      if (unready.length > 0) {
        return {
          ok: false,
          error: `Waiting for ${unready.map((p) => p.name).join(', ')} to ready up.`,
        };
      }
    }

    this.beginMatch(now);
    return { ok: true };
  }

  private beginMatch(now: number): void {
    this.state.matchNumber += 1;
    this.state.phase = 'playing';
    this.state.turnIndex = 0;
    this.state.consecutiveSixes = 0;
    this.state.turnNumber = 1;
    this.state.lastMove = null;
    this.state.winnerId = null;
    this.state.podium = [];

    if (this.state.rules.boardPreset === 'shuffled' && this.state.matchNumber > 1) {
      this.state.boardSeed = randomSeed(`${this.state.code}_m${this.state.matchNumber}`);
    }
    this.state.portals = getPortalsForRules(this.state.rules.boardPreset, this.state.boardSeed);

    for (const p of this.state.players) {
      p.tile = 0;
      p.stats = emptyStats();
    }

    this.state.turnDeadline = this.computeTurnDeadline(now, 0);
    const first = this.state.players[0];
    this.pushActivity(
      `Match #${this.state.matchNumber} started! ${first.name} rolls first.`,
      'epic',
      now
    );
    this.bumpVersion();
  }

  rollDice(actorId: string, forcedDice?: number, now = Date.now()): ActionResult {
    if (this.state.phase !== 'playing') {
      return { ok: false, error: 'Game is not currently active.' };
    }

    const current = this.state.players[this.state.turnIndex];
    if (!current) {
      return { ok: false, error: 'No active player.' };
    }

    const isAllowed =
      current.id === actorId ||
      (this.state.mode === 'couch' && !current.isBot);

    if (!isAllowed) {
      return { ok: false, error: `It is ${current.name}'s turn.` };
    }

    const dice =
      typeof forcedDice === 'number' && forcedDice >= 1 && forcedDice <= 6
        ? Math.floor(forcedDice)
        : rollFairDie();

    return this.resolveRoll(current, dice, now);
  }

  handleTurnTimeout(now = Date.now()): ActionResult {
    if (this.state.phase !== 'playing') {
      return { ok: false, error: 'Game is not active.' };
    }
    const current = this.state.players[this.state.turnIndex];
    if (!current) return { ok: false, error: 'No active player.' };

    const dice = rollFairDie();
    this.pushActivity(`${current.name} ran out of time — auto-rolled a ${dice}.`, 'neutral', now);
    return this.resolveRoll(current, dice, now);
  }

  private resolveRoll(player: Player, dice: number, now: number): ActionResult {
    this.moveSeqCounter += 1;
    const seq = this.moveSeqCounter;
    const startTile = player.tile;
    const rules = this.state.rules;

    player.stats.rolls += 1;
    if (dice === 6) {
      player.stats.sixes += 1;
    }

    const physicsSeed = `${this.state.code}_${this.state.matchNumber}_${seq}_${dice}_${now.toString(36)}`;

    // Triple-six penalty check
    if (rules.tripleSixPenalty && dice === 6 && this.state.consecutiveSixes >= 2) {
      const animDurationMs = estimateMoveAnimDurationMs({
        stepCount: 0,
        hasPortal: false,
        bumpCount: 0,
        tripleSixBust: true,
      });

      const move: TurnMoveEvent = {
        seq,
        playerId: player.id,
        playerName: player.name,
        playerColor: player.color,
        dice,
        physicsSeed,
        startTile,
        stepPath: [],
        bouncedFrom100: false,
        tripleSixBust: true,
        landedTile: startTile,
        portal: null,
        finalTile: startTile,
        bumped: [],
        grantedExtraRoll: false,
        wonGame: false,
        animDurationMs,
        timestamp: now,
      };

      this.state.lastMove = move;
      this.state.consecutiveSixes = 0;
      this.state.turnNumber += 1;
      this.state.turnIndex = (this.state.turnIndex + 1) % this.state.players.length;
      this.state.turnDeadline = this.computeTurnDeadline(now, animDurationMs);

      this.pushActivity(`${player.name} rolled a third 6 — triple-six bust!`, 'bad', now);
      this.bumpVersion();
      return { ok: true };
    }

    // Compute step path (with optional bounce back from 100)
    const stepPath: number[] = [];
    let bouncedFrom100 = false;
    const rawTarget = startTile + dice;

    if (rawTarget <= 100) {
      for (let t = startTile + 1; t <= rawTarget; t++) {
        stepPath.push(t);
      }
    } else if (rules.exactFinishBounce) {
      bouncedFrom100 = true;
      for (let t = startTile + 1; t <= 100; t++) {
        stepPath.push(t);
      }
      const overshoot = rawTarget - 100;
      for (let step = 1; step <= overshoot; step++) {
        stepPath.push(100 - step);
      }
    } else {
      for (let t = startTile + 1; t <= 100; t++) {
        stepPath.push(t);
      }
    }

    const landedTile = stepPath.length > 0 ? stepPath[stepPath.length - 1] : startTile;

    // Check snake or ladder portal at landedTile
    const portal = this.state.portals.find((p) => p.from === landedTile) ?? null;
    const finalTile = portal ? portal.to : landedTile;

    if (portal?.type === 'ladder') {
      player.stats.laddersClimbed += 1;
    } else if (portal?.type === 'snake') {
      player.stats.snakesBitten += 1;
    }

    player.tile = finalTile;

    // Check opponent bumps on finalTile (excluding Start Pad 0 and Finish 100)
    const bumped: BumpedEntry[] = [];
    if (rules.enableBump && finalTile > 0 && finalTile < 100) {
      for (const other of this.state.players) {
        if (other.id === player.id) continue;
        if (other.tile === finalTile) {
          const toTile = Math.max(0, other.tile - BUMP_KNOCKBACK_TILES);
          bumped.push({
            playerId: other.id,
            playerName: other.name,
            fromTile: other.tile,
            toTile,
          });
          other.tile = toTile;
          other.stats.bumpsTaken += 1;
          player.stats.bumpsGiven += 1;
        }
      }
    }

    const wonGame = finalTile === 100;
    const grantedExtraRoll = !wonGame && dice === 6 && rules.extraRollOnSix;

    const animDurationMs = estimateMoveAnimDurationMs({
      stepCount: stepPath.length,
      hasPortal: Boolean(portal),
      bumpCount: bumped.length,
      tripleSixBust: false,
      grantedExtraRoll,
    });

    if (wonGame) {
      player.wins += 1;
      this.state.phase = 'gameover';
      this.state.winnerId = player.id;
      this.state.consecutiveSixes = 0;
      this.state.turnDeadline = null;

      const others = this.state.players
        .filter((p) => p.id !== player.id)
        .sort((a, b) => b.tile - a.tile || b.stats.laddersClimbed - a.stats.laddersClimbed)
        .map((p) => p.id);
      this.state.podium = [player.id, ...others];
    } else if (grantedExtraRoll) {
      this.state.consecutiveSixes += 1;
      this.state.turnNumber += 1;
      this.state.turnDeadline = this.computeTurnDeadline(now, animDurationMs);
    } else {
      this.state.consecutiveSixes = 0;
      this.state.turnNumber += 1;
      this.state.turnIndex = (this.state.turnIndex + 1) % this.state.players.length;
      this.state.turnDeadline = this.computeTurnDeadline(now, animDurationMs);
    }

    const move: TurnMoveEvent = {
      seq,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color,
      dice,
      physicsSeed,
      startTile,
      stepPath,
      bouncedFrom100,
      tripleSixBust: false,
      landedTile,
      portal: portal ? { ...portal } : null,
      finalTile,
      bumped,
      grantedExtraRoll,
      wonGame,
      animDurationMs,
      timestamp: now,
    };

    this.state.lastMove = move;

    // Compose crisp activity feed entry
    if (wonGame) {
      this.pushActivity(`${player.name} rolled ${dice} and reached 100 — Victory!`, 'epic', now);
    } else if (portal?.type === 'ladder') {
      this.pushActivity(
        `${player.name} rolled ${dice} and climbed a ladder ${portal.from} → ${portal.to}!`,
        'good',
        now
      );
    } else if (portal?.type === 'snake') {
      this.pushActivity(
        `${player.name} rolled ${dice} and slid down a snake ${portal.from} → ${portal.to}!`,
        'bad',
        now
      );
    } else if (bumped.length > 0) {
      const names = bumped.map((b) => b.playerName).join(', ');
      this.pushActivity(
        `${player.name} rolled ${dice} to ${finalTile} and bumped ${names}!`,
        'epic',
        now
      );
    } else if (bouncedFrom100) {
      this.pushActivity(
        `${player.name} rolled ${dice} and bounced off 100 to ${finalTile}.`,
        'neutral',
        now
      );
    } else if (grantedExtraRoll) {
      this.pushActivity(
        `${player.name} rolled a 6 to ${finalTile} — bonus roll!`,
        'good',
        now
      );
    } else {
      this.pushActivity(`${player.name} rolled ${dice} → tile ${finalTile}.`, 'neutral', now);
    }

    this.bumpVersion();
    return { ok: true };
  }

  private rematch(actorId: string, now: number): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can start a rematch.' };
    }
    if (this.state.phase !== 'gameover') {
      return { ok: false, error: 'Rematch is available once the game ends.' };
    }
    this.beginMatch(now);
    return { ok: true };
  }

  private returnToLobby(actorId: string, now: number): ActionResult {
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isHost) {
      return { ok: false, error: 'Only the host can return to the lobby.' };
    }

    this.state.phase = 'lobby';
    this.state.turnIndex = 0;
    this.state.consecutiveSixes = 0;
    this.state.turnNumber = 0;
    this.state.lastMove = null;
    this.state.winnerId = null;
    this.state.podium = [];
    this.state.turnDeadline = null;

    // Clean up any long-disconnected players when returning to lobby
    this.state.players = this.state.players.filter((p) => p.isBot || !p.disconnected);
    for (const p of this.state.players) {
      p.tile = 0;
      p.autoPlay = false;
      p.stats = emptyStats();
      p.isReady = p.isHost || p.isBot || this.state.mode !== 'multiplayer';
    }
    this.ensureHostAssigned();

    this.pushActivity('Returned to the lobby.', 'neutral', now);
    this.bumpVersion();
    return { ok: true };
  }

  private toggleAutoPlay(actorId: string, now: number): ActionResult {
    if (this.state.phase !== 'playing') {
      return { ok: false, error: 'Auto-play can only be toggled during a game.' };
    }
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player || player.isBot) {
      return { ok: false, error: 'Player not found.' };
    }
    player.autoPlay = !player.autoPlay;
    this.pushActivity(
      player.autoPlay ? `${player.name} enabled auto-play.` : `${player.name} resumed manual control.`,
      'neutral',
      now
    );
    if (this.state.players[this.state.turnIndex]?.id === player.id) {
      this.state.turnDeadline = this.computeTurnDeadline(now, 0);
    }
    this.bumpVersion();
    return { ok: true };
  }

  sendEmote(actorId: string, emote: EmoteId, now = Date.now()): ActionResult {
    if (!VALID_EMOTES.has(emote)) {
      return { ok: false, error: 'Unknown emote.' };
    }
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player) return { ok: false, error: 'Player not found.' };

    this.state.lastEmote = {
      id: `em_${now}_${Math.random().toString(36).slice(2, 6)}`,
      playerId: player.id,
      playerName: player.name,
      emote,
      timestamp: now,
    };
    this.bumpVersion();
    return { ok: true };
  }

  executeIntent(actorId: string, intent: ClientIntent, now = Date.now()): ActionResult {
    switch (intent.type) {
      case 'TOGGLE_READY':
        return this.toggleReady(actorId);
      case 'SELECT_COLOR':
        return this.selectColor(actorId, intent.color);
      case 'UPDATE_RULES':
        return this.updateRules(actorId, intent.rules);
      case 'ADD_BOT':
        return this.addBot(actorId, now);
      case 'ADD_LOCAL_PLAYER':
        return this.addLocalPlayer(actorId, intent.name, now);
      case 'REMOVE_PLAYER':
        return this.removePlayer(actorId, intent.playerId, now);
      case 'START_GAME':
        return this.startGame(actorId, now);
      case 'ROLL_DICE':
        return this.rollDice(actorId, undefined, now);
      case 'REMATCH':
        return this.rematch(actorId, now);
      case 'RETURN_TO_LOBBY':
        return this.returnToLobby(actorId, now);
      case 'TOGGLE_AUTOPLAY':
        return this.toggleAutoPlay(actorId, now);
      case 'SEND_EMOTE':
        return this.sendEmote(actorId, intent.emote, now);
      default:
        return { ok: false, error: 'Unknown action.' };
    }
  }
}

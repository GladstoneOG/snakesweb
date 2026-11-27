export type BoardPresetId = 'classic' | 'serpents_den' | 'shuffled';
export type GameMode = 'solo' | 'couch' | 'multiplayer';
export type GamePhase = 'lobby' | 'playing' | 'gameover';
export type PawnColorId = 'ruby' | 'sapphire' | 'emerald' | 'amber' | 'plum' | 'teal';
export type EmoteId = 'dice' | 'snake' | 'ladder' | 'laugh' | 'fire' | 'cry' | 'clap' | 'crown';
export type PlayerTransport = 'local' | 'host' | 'online' | 'reconnecting' | 'connecting';

export interface PortalLink {
  id: string;
  type: 'snake' | 'ladder';
  from: number; // ladder: from < to; snake: from > to (tiles 2..99)
  to: number;
  styleVariant: number; // 0..3 palette/style index
}

export interface GameRules {
  boardPreset: BoardPresetId;
  exactFinishBounce: boolean;
  extraRollOnSix: boolean;
  tripleSixPenalty: boolean;
  enableBump: boolean;
  turnDuration: number; // 0 | 10 | 15 | 30
}

export interface PlayerStats {
  rolls: number;
  sixes: number;
  laddersClimbed: number;
  snakesBitten: number;
  bumpsGiven: number;
  bumpsTaken: number;
}

export interface Player {
  id: string;
  sessionId: string;
  name: string;
  color: PawnColorId;
  isHost: boolean;
  isReady: boolean;
  isBot: boolean;
  disconnected?: boolean;
  reconnectGraceUntil?: number | null;
  autoPlay?: boolean;
  transport: PlayerTransport;
  tile: number; // 0 = Start Pad, 1..100 = board squares
  wins: number;
  stats: PlayerStats;
}

export interface BumpedEntry {
  playerId: string;
  playerName: string;
  fromTile: number;
  toTile: number;
}

export interface TurnMoveEvent {
  seq: number;
  playerId: string;
  playerName: string;
  playerColor: PawnColorId;
  dice: number;
  physicsSeed: string;
  startTile: number;
  stepPath: number[];
  bouncedFrom100: boolean;
  tripleSixBust: boolean;
  landedTile: number;
  portal: PortalLink | null;
  finalTile: number;
  bumped: BumpedEntry[];
  grantedExtraRoll: boolean;
  wonGame: boolean;
  animDurationMs: number;
  timestamp: number;
}

export interface EmoteEvent {
  id: string;
  playerId: string;
  playerName: string;
  emote: EmoteId;
  timestamp: number;
}

export interface ActivityEntry {
  id: string;
  text: string;
  tone: 'neutral' | 'good' | 'bad' | 'epic';
  timestamp: number;
}

export interface RoomState {
  code: string;
  mode: GameMode;
  phase: GamePhase;
  rules: GameRules;
  boardSeed: string;
  portals: PortalLink[];
  players: Player[];
  turnIndex: number;
  consecutiveSixes: number;
  turnNumber: number;
  matchNumber: number;
  lastMove: TurnMoveEvent | null;
  lastEmote: EmoteEvent | null;
  winnerId: string | null;
  podium: string[];
  turnDeadline: number | null;
  activity: ActivityEntry[];
  stateVersion: number;
}

export interface SanitizedRoomState extends Omit<RoomState, 'players'> {
  viewerId: string;
  serverNow: number;
  players: Omit<Player, 'sessionId'>[];
}
export type SanitizedPlayer = SanitizedRoomState['players'][number];

export type ClientIntent =
  | { type: 'TOGGLE_READY' }
  | { type: 'SELECT_COLOR'; color: PawnColorId }
  | { type: 'UPDATE_RULES'; rules: Partial<GameRules> }
  | { type: 'ADD_BOT' }
  | { type: 'ADD_LOCAL_PLAYER'; name?: string }
  | { type: 'REMOVE_PLAYER'; playerId: string }
  | { type: 'START_GAME' }
  | { type: 'ROLL_DICE' }
  | { type: 'REMATCH' }
  | { type: 'RETURN_TO_LOBBY' }
  | { type: 'TOGGLE_AUTOPLAY' }
  | { type: 'SEND_EMOTE'; emote: EmoteId };

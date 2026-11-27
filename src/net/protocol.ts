import type { ClientIntent, GamePhase, SanitizedRoomState } from '@engine/types';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type LocalTransportState = 'local' | 'online' | 'reconnecting' | 'connecting';

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

export type ClientToRoomMessage =
  | { type: 'INTENT'; intent: ClientIntent }
  | { type: 'LEAVE' };

export type RoomToClientMessage =
  | { type: 'welcome'; peerId: string; sessionId: string }
  | { type: 'STATE_SYNC'; state: SanitizedRoomState }
  | { type: 'ACTION_ERROR'; message: string }
  | { type: 'KICKED'; message: string }
  | { type: 'error'; code?: string; message: string };

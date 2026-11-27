import type { EmoteId, Player, RoomState, TurnMoveEvent } from './types';

export function getBotThinkDelayMs(state: RoomState): number {
  const base = state.consecutiveSixes > 0 ? 480 : 620;
  return base + Math.floor(Math.random() * 240);
}

/**
 * Picks an occasional expressive emote for a bot after notable board events.
 * Returns null most of the time so emotes feel organic rather than spammy.
 */
export function maybePickBotEmote(
  move: TurnMoveEvent | null,
  bot: Player
): EmoteId | null {
  if (!move || !bot.isBot) return null;

  if (move.wonGame && move.playerId === bot.id) {
    return 'crown';
  }

  const roll = Math.random();
  if (move.playerId === bot.id) {
    if (move.portal?.type === 'ladder' && move.portal.to - move.portal.from >= 18 && roll < 0.55) {
      return 'ladder';
    }
    if (move.portal?.type === 'snake' && move.portal.from - move.portal.to >= 20 && roll < 0.55) {
      return 'cry';
    }
    if (move.bumped.length > 0 && roll < 0.5) {
      return 'fire';
    }
    if (move.tripleSixBust && roll < 0.6) {
      return 'cry';
    }
    if (move.grantedExtraRoll && roll < 0.25) {
      return 'dice';
    }
  } else {
    if (move.portal?.type === 'snake' && move.portal.from - move.portal.to >= 30 && roll < 0.28) {
      return 'laugh';
    }
    if (move.bumped.some((b) => b.playerId === bot.id) && roll < 0.45) {
      return 'snake';
    }
    if (move.wonGame && roll < 0.35) {
      return 'clap';
    }
  }

  return null;
}

import { describe, expect, it } from 'vitest';
import { getPortalsForRules, getTileCoords } from '@engine/boards';
import {
  BUMP_KNOCKBACK_TILES,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  SnakesHostEngine,
} from '@engine/snakesEngine';

describe('boards & coordinates', () => {
  it('computes boustrophedon 10x10 serpentine tile coordinates accurately', () => {
    expect(getTileCoords(1)).toMatchObject({ tile: 1, x: 5, y: 95, row: 0, col: 0, direction: 'right' });
    expect(getTileCoords(10)).toMatchObject({ tile: 10, x: 95, y: 95, row: 0, col: 9, direction: 'right' });
    expect(getTileCoords(11)).toMatchObject({ tile: 11, x: 95, y: 85, row: 1, col: 9, direction: 'left' });
    expect(getTileCoords(20)).toMatchObject({ tile: 20, x: 5, y: 85, row: 1, col: 0, direction: 'left' });
    expect(getTileCoords(21)).toMatchObject({ tile: 21, x: 5, y: 75, row: 2, col: 0, direction: 'right' });
    expect(getTileCoords(91)).toMatchObject({ tile: 91, x: 95, y: 5, row: 9, col: 9, direction: 'left' });
    expect(getTileCoords(100)).toMatchObject({ tile: 100, x: 5, y: 5, row: 9, col: 0, direction: 'left' });

    const start = getTileCoords(0);
    expect(start.tile).toBe(0);
    expect(start.x).toBeGreaterThanOrEqual(0);
    expect(start.x).toBeLessThanOrEqual(15);
    expect(start.y).toBeGreaterThanOrEqual(90);
    expect(start.y).toBeLessThanOrEqual(100);
  });

  it('validates classic, serpents_den, and shuffled board presets', () => {
    for (const preset of ['classic', 'serpents_den', 'shuffled'] as const) {
      const portals = getPortalsForRules(preset, 'alpha_seed_1');
      const ladders = portals.filter((p) => p.type === 'ladder');
      const snakes = portals.filter((p) => p.type === 'snake');
      expect(ladders.length).toBeGreaterThanOrEqual(8);
      expect(snakes.length).toBeGreaterThanOrEqual(8);

      const used = new Set<number>();
      for (const p of portals) {
        expect(p.from).toBeGreaterThanOrEqual(2);
        expect(p.from).toBeLessThanOrEqual(99);
        expect(p.to).toBeGreaterThanOrEqual(2);
        expect(p.to).toBeLessThanOrEqual(99);
        expect(used.has(p.from)).toBe(false);
        expect(used.has(p.to)).toBe(false);
        used.add(p.from);
        used.add(p.to);

        if (p.type === 'ladder') {
          expect(p.from).toBeLessThan(p.to);
        } else {
          expect(p.from).toBeGreaterThan(p.to);
        }
      }
    }

    // Serpent's Den has the dramatic 99 -> 12 snake
    const den = getPortalsForRules('serpents_den', 'x');
    expect(den.some((p) => p.type === 'snake' && p.from === 99 && p.to === 12)).toBe(true);

    // Shuffled is deterministic for identical seeds and spans >= 1 row
    const s1 = getPortalsForRules('shuffled', 'deterministic_42');
    const s2 = getPortalsForRules('shuffled', 'deterministic_42');
    const s3 = getPortalsForRules('shuffled', 'different_99');
    expect(s1).toEqual(s2);
    expect(s1).not.toEqual(s3);
    for (const p of s1) {
      const low = Math.min(p.from, p.to);
      const high = Math.max(p.from, p.to);
      expect(Math.floor((high - 1) / 10) - Math.floor((low - 1) / 10)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('SnakesHostEngine rules & multiplayer lifecycle', () => {
  function createTwoPlayerGame(rulesPatch = {}) {
    const engine = new SnakesHostEngine({
      code: 'TEST',
      mode: 'solo',
      hostId: 'p1',
      hostSessionId: 's1',
      hostName: 'Alice',
      rules: {
        boardPreset: 'classic',
        exactFinishBounce: true,
        extraRollOnSix: true,
        tripleSixPenalty: true,
        enableBump: true,
        turnDuration: 15,
        ...rulesPatch,
      },
    });
    engine.addLocalPlayer('p1', 'Bob');
    expect(engine.startGame('p1').ok).toBe(true);
    return engine;
  }

  it('enforces max 6 players, unique colors, and host-only controls', () => {
    const engine = new SnakesHostEngine({
      code: 'ROOM',
      mode: 'multiplayer',
      hostId: 'h1',
      hostSessionId: 'sh1',
      hostName: 'Host',
    });

    expect(engine.addOrRestorePeer({ peerId: 'p2', sessionId: 'sp2', name: 'Guest' }).ok).toBe(true);
    expect(engine.executeIntent('p2', { type: 'ADD_BOT' }).ok).toBe(false);
    expect(engine.executeIntent('p2', { type: 'SELECT_COLOR', color: 'ruby' }).ok).toBe(false);
    expect(engine.executeIntent('p2', { type: 'SELECT_COLOR', color: 'plum' }).ok).toBe(true);

    while (engine.getState().players.length < MAX_PLAYERS) {
      expect(engine.addBot('h1').ok).toBe(true);
    }
    expect(engine.addBot('h1').ok).toBe(false);
  });

  it('starts on tile 1 so rolling N moves from x to x + N', () => {
    const engine = createTwoPlayerGame();
    const [p1, p2] = engine.getState().players;
    expect(p1.tile).toBe(1);
    expect(p2.tile).toBe(1);

    // Rolling 1 at tile 1 moves to tile 2
    expect(engine.rollDice('p1', 1).ok).toBe(true);
    const move1 = engine.getState().lastMove!;
    expect(move1.startTile).toBe(1);
    expect(move1.stepPath).toEqual([2]);
    expect(p1.tile).toBe(2);

    // Rolling 3 from tile 1 lands on tile 4 (climbing 4 -> 14)
    expect(engine.rollDice(p2.id, 3).ok).toBe(true);
    const move2 = engine.getState().lastMove!;
    expect(move2.startTile).toBe(1);
    expect(move2.stepPath).toEqual([2, 3, 4]);
    expect(move2.portal).toMatchObject({ type: 'ladder', from: 4, to: 14 });
    expect(p2.tile).toBe(14);
  });

  it('climbs ladders, slides down snakes, and records stats', () => {
    const engine = createTwoPlayerGame();
    // Classic has ladder 4 -> 14 (from tile 1, roll 3 -> 4 -> 14)
    expect(engine.rollDice('p1', 3).ok).toBe(true);
    const state1 = engine.getState();
    expect(state1.players[0].tile).toBe(14);
    expect(state1.players[0].stats.laddersClimbed).toBe(1);
    expect(state1.lastMove?.portal).toMatchObject({ type: 'ladder', from: 4, to: 14 });

    // Move p2 to 17 (classic snake 17 -> 7)
    const p2 = state1.players[1];
    p2.tile = 14;
    expect(engine.rollDice(p2.id, 3).ok).toBe(true);
    expect(p2.tile).toBe(7);
    expect(p2.stats.snakesBitten).toBe(1);
    expect(engine.getState().lastMove?.portal).toMatchObject({ type: 'snake', from: 17, to: 7 });
  });

  it('handles extra roll on 6 and triple-six bust penalty', () => {
    const engine = createTwoPlayerGame();
    const p1 = engine.getState().players[0];

    expect(engine.rollDice('p1', 6).ok).toBe(true);
    expect(engine.getState().turnIndex).toBe(0);
    expect(engine.getState().consecutiveSixes).toBe(1);
    expect(engine.getState().lastMove?.grantedExtraRoll).toBe(true);

    expect(engine.rollDice('p1', 6).ok).toBe(true);
    expect(engine.getState().turnIndex).toBe(0);
    expect(engine.getState().consecutiveSixes).toBe(2);
    const tileBeforeThirdSix = p1.tile;

    expect(engine.rollDice('p1', 6).ok).toBe(true);
    expect(engine.getState().lastMove?.tripleSixBust).toBe(true);
    expect(p1.tile).toBe(tileBeforeThirdSix);
    expect(engine.getState().consecutiveSixes).toBe(0);
    expect(engine.getState().turnIndex).toBe(1);
  });

  it('handles exactFinishBounce on tile 100 and victory when landing exactly', () => {
    const engine = createTwoPlayerGame({ exactFinishBounce: true });
    const p1 = engine.getState().players[0];
    p1.tile = 97;

    // Roll 5 -> 98, 99, 100, 99, 98 (then classic snake 98 -> 79!)
    expect(engine.rollDice('p1', 5).ok).toBe(true);
    const bounceMove = engine.getState().lastMove!;
    expect(bounceMove.bouncedFrom100).toBe(true);
    expect(bounceMove.stepPath).toEqual([98, 99, 100, 99, 98]);
    expect(bounceMove.landedTile).toBe(98);
    expect(bounceMove.finalTile).toBe(79);
    expect(bounceMove.wonGame).toBe(false);

    // Exact win for p2
    const p2 = engine.getState().players[1];
    p2.tile = 96;
    expect(engine.rollDice(p2.id, 4).ok).toBe(true);
    const winState = engine.getState();
    expect(winState.phase).toBe('gameover');
    expect(winState.winnerId).toBe(p2.id);
    expect(winState.podium[0]).toBe(p2.id);
    expect(p2.wins).toBe(1);
  });

  it('bumps opponents when landing on an occupied tile', () => {
    const engine = createTwoPlayerGame({ enableBump: true });
    const [p1, p2] = engine.getState().players;
    p1.tile = 10;
    p2.tile = 13;

    expect(engine.rollDice('p1', 3).ok).toBe(true);
    const move = engine.getState().lastMove!;
    expect(move.finalTile).toBe(13);
    expect(move.bumped).toHaveLength(1);
    expect(move.bumped[0]).toMatchObject({
      playerId: p2.id,
      fromTile: 13,
      toTile: 13 - BUMP_KNOCKBACK_TILES,
    });
    expect(p2.tile).toBe(13 - BUMP_KNOCKBACK_TILES);
    expect(p1.stats.bumpsGiven).toBe(1);
    expect(p2.stats.bumpsTaken).toBe(1);

    // Bump near start clamps to tile 1 (never 0)
    const engine2 = createTwoPlayerGame({ enableBump: true });
    const [a, b] = engine2.getState().players;
    a.tile = 1;
    b.tile = 3;
    expect(engine2.rollDice('p1', 2).ok).toBe(true);
    expect(b.tile).toBe(1);
  });

  it('supports 30s reconnect grace, session restore, and host migration', () => {
    const t0 = 1_000_000;
    const engine = new SnakesHostEngine({
      code: 'LIVE',
      mode: 'multiplayer',
      hostId: 'h1',
      hostSessionId: 'sess_host',
      hostName: 'Host',
    });
    expect(
      engine.addOrRestorePeer({ peerId: 'g1', sessionId: 'sess_guest', name: 'Guest', now: t0 }).ok
    ).toBe(true);
    expect(engine.executeIntent('g1', { type: 'TOGGLE_READY' }, t0).ok).toBe(true);
    expect(engine.startGame('h1', t0).ok).toBe(true);

    // Host disconnects unexpectedly -> 30s grace
    engine.handlePeerDisconnect('h1', false, t0 + 1000);
    const afterDrop = engine.getState().players[0];
    expect(afterDrop.disconnected).toBe(true);
    expect(afterDrop.autoPlay).toBe(false);
    expect(afterDrop.reconnectGraceUntil).toBe(t0 + 1000 + RECONNECT_GRACE_MS);

    // Before grace expires, nothing changes
    expect(engine.expireReconnectGrace(t0 + 10_000)).toBe(false);

    // After 30s grace expires -> autoPlay = true and host migrates to Guest
    expect(engine.expireReconnectGrace(t0 + 1000 + RECONNECT_GRACE_MS + 10)).toBe(true);
    expect(engine.getState().players[0].autoPlay).toBe(true);
    expect(engine.getState().players[1].isHost).toBe(true);

    // Host reconnects with same sessionId -> seat restored with original peerId 'h1'
    const restore = engine.addOrRestorePeer({
      peerId: 'new_socket_id',
      sessionId: 'sess_host',
      name: 'Host',
      now: t0 + 40_000,
    });
    expect(restore.ok).toBe(true);
    expect(restore.peerId).toBe('h1');
    expect(engine.getState().players[0].disconnected).toBe(false);
    expect(engine.getState().players[0].autoPlay).toBe(false);
  });
});

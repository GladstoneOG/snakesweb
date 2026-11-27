import { GameRoomDO, type RoomEnv } from './GameRoomDO';

export { GameRoomDO };

export type Env = RoomEnv;

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REGISTRY_NAME = '__LOBBY_REGISTRY__';

function generateRoomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'snakesweb' });
    }

    if (url.pathname === '/api/rooms' && request.method === 'GET') {
      const registry = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(REGISTRY_NAME));
      return registry.fetch('https://room.internal/registry/list');
    }

    if (url.pathname === '/api/room/create' && request.method === 'POST') {
      let hostName = 'Host';
      let password = '';
      try {
        const body = (await request.json()) as { hostName?: string; password?: string };
        if (body?.hostName) hostName = String(body.hostName).slice(0, 24);
        if (body?.password) password = String(body.password).slice(0, 48);
      } catch {
        // empty body allowed
      }

      for (let attempt = 0; attempt < 12; attempt++) {
        const code = generateRoomCode();
        const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
        const res = await stub.fetch('https://room.internal/status');
        const status = (await res.json()) as { hasHost: boolean };
        if (!status.hasHost) {
          await stub.fetch('https://room.internal/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, hostName, password }),
          });
          return Response.json({ roomCode: code });
        }
      }
      return Response.json(
        { error: 'Unable to allocate room code. Try again.' },
        { status: 503 }
      );
    }

    const statusMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4})\/status$/);
    if (statusMatch && request.method === 'GET') {
      const code = statusMatch[1].toUpperCase();
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
      return stub.fetch('https://room.internal/status');
    }

    const wsMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4})\/ws$/);
    if (wsMatch) {
      const code = wsMatch[1].toUpperCase();
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};

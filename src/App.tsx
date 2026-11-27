import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientIntent } from '@engine/types';
import {
  LocalCouchSession,
  LocalSoloSession,
  RoomMultiplayerSession,
  clearActiveRoom,
  createRoomCode,
  loadActiveRoom,
  type GameSession,
  type SessionSnapshot,
} from '@net/session';
import { GameScreen } from '@ui/GameScreen';
import { HomeScreen } from '@ui/HomeScreen';
import { LobbyView } from '@ui/LobbyView';
import { music, type MusicScene } from '@utils/music';

const NAME_KEY = 'snakesweb_player_name';

function getInitialName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function getInitialRoomCode(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  } catch {
    return '';
  }
}

export function App() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [initialRoomCode] = useState(getInitialRoomCode);
  const [savedName, setSavedName] = useState(getInitialName);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [connectStalled, setConnectStalled] = useState(false);
  const autoResumeAttemptRef = useRef(false);

  // Seamlessly resume an active multiplayer room after an accidental refresh
  useEffect(() => {
    if (initialRoomCode) return;
    const savedRoom = loadActiveRoom();
    if (!savedRoom) return;
    autoResumeAttemptRef.current = true;
    const resumed = new RoomMultiplayerSession(savedRoom.code, savedRoom.name);
    setJoiningCode(savedRoom.code);
    setSession(resumed);
  }, [initialRoomCode]);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    const unsub = session.subscribe((next) => {
      setSnapshot(next);
    });
    return () => {
      unsub();
    };
  }, [session]);

  const persistName = (name: string) => {
    setSavedName(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // ignore
    }
  };

  const leaveSession = useCallback(() => {
    autoResumeAttemptRef.current = false;
    clearActiveRoom();
    setSession((prev) => {
      prev?.destroy();
      return null;
    });
    setSnapshot(null);
    setJoiningCode(null);
    setConnectStalled(false);
    setHomeError(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.pathname);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleHost = async (name: string, password?: string) => {
    autoResumeAttemptRef.current = false;
    persistName(name);
    setBusy(true);
    setHomeError(null);
    try {
      const code = await createRoomCode(name, password);
      const roomSession = new RoomMultiplayerSession(code, name, {
        isCreator: true,
        password,
      });
      setJoiningCode(code);
      setSession(roomSession);
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Unable to create room.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = (code: string, name: string, password?: string) => {
    autoResumeAttemptRef.current = false;
    persistName(name);
    setHomeError(null);
    const cleanCode = code.toUpperCase();
    const roomSession = new RoomMultiplayerSession(cleanCode, name, { password });
    setJoiningCode(cleanCode);
    setSession(roomSession);
  };

  const handleSolo = (name: string) => {
    autoResumeAttemptRef.current = false;
    clearActiveRoom();
    persistName(name);
    setHomeError(null);
    setJoiningCode(null);
    setSession(new LocalSoloSession(name));
  };

  const handleCouch = (name: string) => {
    autoResumeAttemptRef.current = false;
    clearActiveRoom();
    persistName(name);
    setHomeError(null);
    setJoiningCode(null);
    setSession(new LocalCouchSession(name));
  };

  const sendIntent = useCallback(
    (intent: ClientIntent) => {
      session?.sendIntent(intent);
    },
    [session]
  );

  const fatalBeforeRoom =
    session &&
    snapshot &&
    !snapshot.room &&
    (snapshot.status === 'error' || snapshot.status === 'disconnected');

  useEffect(() => {
    if (fatalBeforeRoom && snapshot?.error) {
      const wasAutoResume = autoResumeAttemptRef.current;
      autoResumeAttemptRef.current = false;
      const msg = snapshot.error;
      clearActiveRoom();
      session?.destroy();
      setSession(null);
      setSnapshot(null);
      setJoiningCode(null);
      setHomeError(wasAutoResume ? null : msg);
    }
  }, [fatalBeforeRoom, snapshot?.error, session]);

  const isConnectingToRoom = Boolean(session && snapshot && !snapshot.room);
  useEffect(() => {
    if (!isConnectingToRoom) {
      setConnectStalled(false);
      return;
    }
    const id = window.setTimeout(() => setConnectStalled(true), 6000);
    return () => window.clearTimeout(id);
  }, [isConnectingToRoom]);

  const isReconnecting = snapshot?.status === 'reconnecting';
  const isInGame = Boolean(
    session &&
      snapshot?.room &&
      snapshot.status !== 'disconnected' &&
      snapshot.status !== 'error' &&
      snapshot.room.phase !== 'lobby'
  );
  const musicScene: MusicScene = isInGame ? 'game' : 'lobby';

  useEffect(() => {
    music.setScene(musicScene);
  }, [musicScene]);

  return (
    <div className="app-bg">
      {!session || !snapshot ? (
        <HomeScreen
          initialRoomCode={initialRoomCode}
          initialName={savedName}
          busy={busy}
          error={homeError}
          onHost={handleHost}
          onJoin={handleJoin}
          onSolo={handleSolo}
          onCouch={handleCouch}
        />
      ) : !snapshot.room ? (
        <div className="screen">
          <div className="status-card" role="status" aria-live="polite">
            <div className="status-spinner" aria-hidden="true" />
            <div className="eyebrow">{joiningCode ? `Room ${joiningCode}` : 'Joining room'}</div>
            <h2 className="modal-title">Connecting to board…</h2>
            <p className="modal-sub">
              {connectStalled
                ? 'Taking longer than usual — retrying connection to the board.'
                : 'Setting up your pawn on the tabletop.'}
            </p>
            <button type="button" className="btn btn-ghost" onClick={leaveSession}>
              Cancel
            </button>
          </div>
        </div>
      ) : snapshot.status === 'disconnected' || snapshot.status === 'error' ? (
        <div className="screen">
          <div className="status-card">
            <div className="eyebrow">Connection lost</div>
            <h2 className="modal-title">Room closed</h2>
            <p className="modal-sub">
              {snapshot.error || 'The connection to the room was lost.'}
            </p>
            <button type="button" className="btn btn-primary" onClick={leaveSession}>
              Back to home
            </button>
          </div>
        </div>
      ) : snapshot.room.phase === 'lobby' ? (
        <LobbyView
          room={snapshot.room}
          reconnecting={isReconnecting}
          error={snapshot.error}
          onIntent={sendIntent}
          onLeave={leaveSession}
        />
      ) : (
        <GameScreen
          room={snapshot.room}
          transport={snapshot.transport}
          error={snapshot.error}
          onIntent={sendIntent}
          onLeave={leaveSession}
        />
      )}
    </div>
  );
}

export default App;

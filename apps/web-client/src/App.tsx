import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientSession, GameResult, RoomSnapshot, RoomSummary } from '@lan/shared';
import { socket, send, getOrCreatePlayerId, loadName, saveName, loadSession, saveSession, clearSession } from './socket';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import HelloView from './games/hello/HelloView';
import { registerGameView } from './games/registry';
registerGameView('hello', HelloView);
// TODO: 狼人杀插件完成后在此注册

interface GameInfo {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [name, setName] = useState(loadName);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [session, setSession] = useState<ClientSession | null>(loadSession);
  const [inRoom, setInRoom] = useState(false);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [toast, setToast] = useState('');
  const [eventBanner, setEventBanner] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  const showEvent = useCallback((msg: string) => {
    setEventBanner(msg);
    if (eventTimer.current) clearTimeout(eventTimer.current);
    eventTimer.current = setTimeout(() => setEventBanner(''), 5000);
  }, []);

  const doRejoin = useCallback((s: ClientSession) => {
    // 带 playerName 用于 token 失效时服务端降级重新加入
    send('rejoin', { roomId: s.roomId, playerId: s.playerId, rejoinToken: s.rejoinToken, playerName: name.trim() || '玩家' });
  }, [name]);

  useEffect(() => {
    getOrCreatePlayerId();

    fetch('/api/games')
      .then((r) => r.json())
      .then(setGames)
      .catch(() => {});
    fetch('/api/rooms')
      .then((r) => r.json())
      .then(setRooms)
      .catch(() => {});

    socket.on('connect', () => {
      setConnected(true);
      const s = loadSession();
      if (s) doRejoin(s); // 断线重连 / 刷新页面后自动恢复会话
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('msg', (msg: Record<string, unknown> & { type: string }) => {
      switch (msg.type) {
        case 'joined': {
          const s: ClientSession = {
            serverUrl: window.location.origin,
            roomId: msg.roomId as string,
            playerId: msg.playerId as string,
            rejoinToken: msg.rejoinToken as string,
            isSpectator: msg.isSpectator as boolean,
          };
          saveSession(s);
          setSession(s);
          setInRoom(true);
          setResult(null);
          setView(null);
          break;
        }
        case 'room_state': {
          const snap = msg.room as RoomSnapshot;
          setRoom(snap);
          // 游戏进行中不应残留上一局结果横幅（再来一局/重连到未结束的对局）
          if (snap.state === 'PLAYING') setResult(null);
          break;
        }
        case 'game_view':
          setView(msg.view);
          break;
        case 'game_over':
          setResult((msg as unknown as { result: GameResult }).result);
          break;
        case 'game_event':
          showEvent(`📢 ${JSON.stringify(msg.event)}`);
          break;
        case 'game_private_event':
          showEvent(`🔔 ${JSON.stringify(msg.event)}`);
          break;
        case 'chat_message':
          showEvent(`${String(msg.senderName)}: ${String(msg.text)}`);
          break;
        case 'lobby_update':
          setRooms(msg.rooms as RoomSummary[]);
          break;
        case 'error':
          showToast(String(msg.message));
          // 服务端已做降级，仅当房间确实解散时才清会话
          if (String(msg.message).includes('解散')) {
            clearSession();
            setSession(null);
            setInRoom(false);
            setRoom(null);
          }
          break;
        case 'kicked':
          showToast(String(msg.reason));
          clearSession();
          setSession(null);
          setInRoom(false);
          setRoom(null);
          break;
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('msg');
    };
  }, [doRejoin, showToast, showEvent]);

  const onNameChange = (n: string) => {
    setName(n);
    saveName(n);
  };
  const playerName = () => name.trim() || '玩家';
  const pid = () => getOrCreatePlayerId();

  const handlers = {
    onCreate: (gameId: string) => send('create_room', { playerId: pid(), gameId, playerName: playerName() }),
    onJoin: (code: string) => code.trim() && send('join_room', { playerId: pid(), code: code.trim(), playerName: playerName() }),
    onSpectate: (code: string) => code.trim() && send('spectate', { playerId: pid(), code: code.trim(), playerName: playerName() }),
    onReady: (ready: boolean) => send('ready', { ready }),
    onStart: () => send('start_game', {}), // config 留接口，狼人杀插件可传板子配置
    onTakeSeat: () => send('take_seat', {}),
    onLeave: () => {
      send('leave_room', {});
      clearSession();
      setSession(null);
      setInRoom(false);
      setRoom(null);
    },
    onAction: (action: unknown) => send('game_action', { action }),
    onChat: (text: string) => send('chat', { text }),
    onResume: () => {
      const s = loadSession();
      if (s) doRejoin(s);
    },
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {inRoom && room ? (
        <Room
          room={room}
          view={view}
          result={result}
          myPlayerId={session?.playerId ?? ''}
          connected={connected}
          onReady={handlers.onReady}
          onStart={handlers.onStart}
          onTakeSeat={handlers.onTakeSeat}
          onLeave={handlers.onLeave}
          onAction={handlers.onAction}
          onChat={handlers.onChat}
        />
      ) : (
        <Lobby
          name={name}
          onNameChange={onNameChange}
          games={games}
          rooms={rooms}
          connected={connected}
          onCreate={handlers.onCreate}
          onJoin={handlers.onJoin}
          onSpectate={handlers.onSpectate}
          hasSession={!!session}
          onResume={handlers.onResume}
        />
      )}
      {eventBanner && (
        <div
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1e3a8a',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 10,
            fontSize: 14,
            maxWidth: '90vw',
            textAlign: 'center',
            zIndex: 200,
          }}
        >
          {eventBanner}
        </div>
      )}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#ef4444',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 10,
            fontSize: 14,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

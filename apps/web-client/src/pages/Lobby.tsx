import type { CSSProperties } from 'react';
import type { RoomSummary } from '@lan/shared';

interface GameInfo {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

const card: CSSProperties = { background: '#24243e', borderRadius: 12, padding: 16, marginBottom: 12 };
const btn: CSSProperties = {
  background: '#4f6ef7',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '10px 16px',
  fontSize: 15,
};
const inputStyle: CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #456',
  borderRadius: 8,
  padding: '10px 12px',
  color: '#eee',
  fontSize: 15,
  width: '100%',
  boxSizing: 'border-box',
};

export default function Lobby(props: {
  name: string;
  onNameChange: (n: string) => void;
  games: GameInfo[];
  rooms: RoomSummary[];
  connected: boolean;
  onCreate: (gameId: string) => void;
  onJoin: (code: string) => void;
  onSpectate: (code: string) => void;
  hasSession: boolean;
  onResume: () => void;
}) {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
      <h1 style={{ textAlign: 'center', fontSize: 22 }}>🎮 局域网游戏厅</h1>
      <p style={{ textAlign: 'center', color: props.connected ? '#4ade80' : '#f87171', fontSize: 13, marginTop: -8 }}>
        {props.connected ? '● 已连接' : '● 连接中…'}
      </p>

      {props.hasSession && (
        <div style={{ ...card, border: '1px solid #4f6ef7' }}>
          <button style={{ ...btn, width: '100%' }} onClick={props.onResume}>
            ↩ 恢复上次对局
          </button>
        </div>
      )}

      <div style={card}>
        <label style={{ fontSize: 13, color: '#9ab' }}>你的昵称</label>
        <input style={inputStyle} value={props.name} onChange={(e) => props.onNameChange(e.target.value)} placeholder="输入昵称" />
      </div>

      <div style={card}>
        <label style={{ fontSize: 13, color: '#9ab' }}>加入房间</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input id="code-input" style={inputStyle} placeholder="输入 6 位房间号" maxLength={6} />
          <button style={btn} onClick={() => props.onJoin((document.getElementById('code-input') as HTMLInputElement).value)}>
            加入
          </button>
          <button
            style={{ ...btn, background: '#24243e', border: '1px solid #456' }}
            onClick={() => props.onSpectate((document.getElementById('code-input') as HTMLInputElement).value)}
          >
            观战
          </button>
        </div>
      </div>

      <div style={card}>
        <label style={{ fontSize: 13, color: '#9ab' }}>游戏大厅</label>
        {props.games.map((g) => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{g.name}</div>
              <div style={{ fontSize: 12, color: '#9ab' }}>
                {g.description} · {g.minPlayers}-{g.maxPlayers}人
              </div>
            </div>
            <button style={btn} onClick={() => props.onCreate(g.id)}>
              创建
            </button>
          </div>
        ))}
      </div>

      <div style={card}>
        <label style={{ fontSize: 13, color: '#9ab' }}>进行中的房间</label>
        {props.rooms.length === 0 && <p style={{ color: '#667', fontSize: 13 }}>暂无房间，创建一个吧</p>}
        {props.rooms.map((r) => (
          <div key={r.roomId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                #{r.code} {r.gameName}
              </div>
              <div style={{ fontSize: 12, color: '#9ab' }}>
                {r.state} · {r.playerCount}/{r.maxPlayers} 玩家 · {r.spectatorCount} 观战
              </div>
            </div>
            <button style={btn} onClick={() => props.onJoin(r.code)}>
              加入
            </button>
            <button
              style={{ ...btn, background: '#24243e', border: '1px solid #456' }}
              onClick={() => props.onSpectate(r.code)}
            >
              观战
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

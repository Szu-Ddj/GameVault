import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameResult, RoomSnapshot } from '@lan/shared';
import { getGameView } from '../games/registry';

const chip: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  background: '#24243e',
  fontSize: 12,
  marginRight: 6,
  color: '#9ab',
};

export default function Room(props: {
  room: RoomSnapshot;
  view: unknown;
  result: GameResult | null;
  myPlayerId: string;
  connected: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onTakeSeat: () => void;
  onLeave: () => void;
  onAction: (action: unknown) => void;
  onChat: (text: string) => void;
}) {
  const { room } = props;
  const me = room.players.find((p) => p.playerId === props.myPlayerId);
  const isSpectator = !me;
  const mySpectatorMode = isSpectator ? 'live' : undefined; // 简化：观战者默认 live，可扩展选择
  const isHost = room.hostId === props.myPlayerId;
  const GameView = getGameView(room.gameId);
  const [chatText, setChatText] = useState('');

  const canStart =
    isHost && (room.state === 'WAITING' || room.state === 'FINISHED') && room.players.length >= room.minPlayers;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 20, position: 'relative' }}>
      {/* 断线重连遮罩：游戏进行中断线时全屏提示，防止误操作已失效的视图 */}
      {!props.connected && room.state === 'PLAYING' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            color: '#fbbf24',
            fontSize: 18,
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div>⚡ 连接中断，正在重连…</div>
          <div style={{ fontSize: 13, color: '#9ab' }}>座位已保留，重连后自动恢复</div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            #{room.code} {room.gameName}
          </h2>
          <span style={{ fontSize: 12, color: '#9ab' }}>
            {room.state === 'PLAYING' ? room.gameStatus : room.state} · {room.players.length}/{room.maxPlayers}
          </span>
        </div>
        <button onClick={props.onLeave} style={{ background: 'transparent', border: '1px solid #456', color: '#9ab', borderRadius: 8, padding: '8px 12px' }}>
          离开
        </button>
      </div>

      {/* 成员列表 */}
      <div style={{ background: '#24243e', borderRadius: 12, padding: 12, marginBottom: 12 }}>
        {room.players.map((p) => (
          <div key={p.playerId} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', color: p.online ? '#eee' : '#667' }}>
            <span style={{ flex: 1 }}>
              {p.isHost && '👑 '}
              {p.name}
              {!p.online && '（重连中…）'}
            </span>
            {p.ready && room.state === 'WAITING' && <span style={chip}>已准备</span>}
          </div>
        ))}
        {room.spectators.map((s) => (
          <div key={s.playerId} style={{ padding: '6px 0', color: '#8899bb', fontSize: 13 }}>
            👁 {s.name}
            {!s.online && '（重连中…）'}
          </div>
        ))}
      </div>

      {/* 游戏区域 / 等待区 */}
      {room.state === 'PLAYING' || room.state === 'FINISHED' ? (
        <>
          {props.result && (
            <div style={{ background: '#14532d', borderRadius: 12, padding: 14, marginBottom: 12, fontWeight: 600 }}>
              🏆 {props.result.winnerText}
            </div>
          )}
          {GameView ? (
            props.view ? (
              <GameView view={props.view} isSpectator={isSpectator} spectatorMode={mySpectatorMode} onAction={props.onAction} />
            ) : (
              <p style={{ color: '#667' }}>加载游戏视图…</p>
            )
          ) : (
            <p style={{ color: '#667' }}>该游戏还没有客户端 UI（gameId: {room.gameId}）</p>
          )}
          {room.state === 'FINISHED' && isHost && (
            <button
              onClick={props.onStart}
              style={{ marginTop: 12, background: '#f59e0b', color: '#1a1a2e', border: 'none', borderRadius: 8, padding: '10px 20px', width: '100%' }}
            >
              再来一局
            </button>
          )}
        </>
      ) : (
        <div style={{ background: '#24243e', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <p style={{ color: '#9ab' }}>
            {isSpectator
              ? '你正在观战，等待开局'
              : `等待玩家加入（${room.players.length}/${room.minPlayers} 至少）… 房间号 #${room.code} 可分享`}
          </p>
          {isSpectator ? (
            <button onClick={props.onTakeSeat} style={{ background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px' }}>
              我要上桌（有空位时）
            </button>
          ) : (
            <button
              onClick={() => props.onReady(!me!.ready)}
              style={{
                background: me!.ready ? '#14532d' : '#4f6ef7',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                marginRight: 8,
              }}
            >
              {me!.ready ? '取消准备' : '准备'}
            </button>
          )}
          {canStart && (
            <button onClick={props.onStart} style={{ background: '#f59e0b', color: '#1a1a2e', border: 'none', borderRadius: 8, padding: '10px 20px' }}>
              开始游戏
            </button>
          )}
        </div>
      )}

      {/* 房间内聊天 */}
      <div style={{ background: '#24243e', borderRadius: 12, padding: 12, marginTop: 12, display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, background: '#1a1a2e', border: '1px solid #456', borderRadius: 8, padding: '8px 12px', color: '#eee' }}
          placeholder="发送消息…"
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && chatText.trim()) {
              props.onChat(chatText.trim());
              setChatText('');
            }
          }}
        />
        <button
          onClick={() => {
            if (chatText.trim()) {
              props.onChat(chatText.trim());
              setChatText('');
            }
          }}
          style={{ background: '#4f6ef7', color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px' }}
        >
          发送
        </button>
      </div>
    </div>
  );
}

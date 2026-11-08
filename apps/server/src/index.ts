import { createServer } from 'node:http';
import os from 'node:os';
import express from 'express';
import { Server } from 'socket.io';
import { Lobby } from './lobby.js';
import { createLobbyRouter } from './http.js';
import type { C2S, SpectatorMode } from '@lan/shared';

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const lobby = new Lobby(io);
app.use('/api', createLobbyRouter(lobby));

io.on('connection', (socket) => {
  let roomId: string | null = null;
  let playerId: string | null = null;

  const roomOf = () => (roomId ? lobby.get(roomId) : undefined);
  const enter = (rid: string, pid: string) => {
    roomId = rid;
    playerId = pid;
    socket.join(rid);
  };
  const fail = (message: string) => socket.emit('msg', { type: 'error', message });

  socket.on('msg', (raw: { type: keyof C2S } & Record<string, unknown>) => {
    try {
      const { type } = raw ?? {};
      switch (type) {
        case 'create_room': {
          const { playerId: pid, gameId, playerName: pn } = raw as unknown as C2S['create_room'];
          if (!pid || !gameId) return fail('需要 playerId 与 gameId');
          const { room, rejoinToken } = lobby.createRoom(gameId, pid, String(pn ?? '玩家'));
          room.onLobbyChange = () => lobby.broadcastLobby();
          enter(room.id, pid);
          room.bindSocket(pid, socket.id);
          socket.emit('msg', { type: 'joined', roomId: room.id, playerId: pid, rejoinToken, isSpectator: false });
          room.broadcastRoom();
          break;
        }
        case 'join_room': {
          const { playerId: pid, code, playerName: pn } = raw as unknown as C2S['join_room'];
          if (!pid || !code) return fail('需要 playerId 与房间号');
          const room = lobby.findByCode(String(code));
          if (!room) return fail('房间不存在，请确认房间号');
          room.onLobbyChange = () => lobby.broadcastLobby();
          const { rejoinToken } = room.addPlayer(pid, String(pn ?? '玩家'));
          enter(room.id, pid);
          room.bindSocket(pid, socket.id);
          socket.emit('msg', { type: 'joined', roomId: room.id, playerId: pid, rejoinToken, isSpectator: false });
          room.broadcastRoom();
          break;
        }
        case 'spectate': {
          const { playerId: pid, code, playerName: pn } = raw as unknown as C2S['spectate'];
          if (!pid || !code) return fail('需要 playerId 与房间号');
          const room = lobby.findByCode(String(code));
          if (!room) return fail('房间不存在，请确认房间号');
          room.onLobbyChange = () => lobby.broadcastLobby();
          const mode = (raw.mode as SpectatorMode) ?? 'live';
          const { rejoinToken } = room.addSpectator(pid, String(pn ?? '观战者'), mode);
          enter(room.id, pid);
          room.bindSocket(pid, socket.id);
          socket.emit('msg', { type: 'joined', roomId: room.id, playerId: pid, rejoinToken, isSpectator: true });
          room.broadcastRoom();
          room.pushGameViews();
          break;
        }
        case 'rejoin': {
          const { roomId: rid, playerId: pid, rejoinToken, playerName: pn } = raw as unknown as C2S['rejoin'];
          const room = lobby.get(String(rid));
          if (!room) return fail('房间已解散');
          room.onLobbyChange = () => lobby.broadcastLobby();
          const role = room.rejoin(String(pid), String(rejoinToken), socket);
          if (role) {
            enter(room.id, String(pid));
            socket.emit('msg', {
              type: 'joined',
              roomId: room.id,
              playerId: String(pid),
              rejoinToken: String(rejoinToken),
              isSpectator: role === 'spectator',
            });
            socket.emit('msg', { type: 'room_state', room: room.snapshot() });
            room.pushGameViews();
            break;
          }
          // 降级：token 无效但房间存在，以原 playerId 重新加入（恢复座位或转观战）
          if (pn) {
            try {
              const { rejoinToken: newToken } = room.addPlayer(String(pid), String(pn));
              enter(room.id, String(pid));
              room.bindSocket(String(pid), socket.id);
              socket.emit('msg', { type: 'joined', roomId: room.id, playerId: String(pid), rejoinToken: newToken, isSpectator: false });
              room.broadcastRoom();
              room.pushGameViews();
              break;
            } catch {
              try {
                const { rejoinToken: newToken } = room.addSpectator(String(pid), String(pn));
                enter(room.id, String(pid));
                room.bindSocket(String(pid), socket.id);
                socket.emit('msg', { type: 'joined', roomId: room.id, playerId: String(pid), rejoinToken: newToken, isSpectator: true });
                room.broadcastRoom();
                room.pushGameViews();
                break;
              } catch {
                /* 均失败 */
              }
            }
          }
          return fail('重连凭证无效，请重新加入房间');
        }
        case 'take_seat': {
          const room = roomOf();
          if (!room || !playerId) return fail('未加入房间');
          room.takeSeat(playerId);
          break;
        }
        case 'ready': {
          const room = roomOf();
          if (!room || !playerId) return fail('未加入房间');
          room.setReady(playerId, Boolean((raw as unknown as C2S['ready']).ready));
          break;
        }
        case 'start_game': {
          const room = roomOf();
          if (!room || !playerId) return fail('未加入房间');
          room.startGame(playerId, (raw as unknown as C2S['start_game']).config);
          break;
        }
        case 'game_action': {
          const room = roomOf();
          if (!room || !playerId) return fail('未加入房间');
          room.gameAction(playerId, (raw as unknown as C2S['game_action']).action);
          break;
        }
        case 'leave_room': {
          const room = roomOf();
          if (!room || !playerId) return;
          room.removePlayer(playerId);
          room.removeSpectator(playerId);
          socket.leave(room.id);
          roomId = null;
          break;
        }
        case 'chat': {
          const room = roomOf();
          if (!room || !playerId) return fail('未加入房间');
          const text = String((raw as unknown as C2S['chat']).text ?? '').slice(0, 500);
          if (text) room.broadcastChat(playerId, text);
          break;
        }
        default:
          fail(`未知消息类型: ${String(type)}`);
      }
    } catch (e) {
      fail((e as Error).message);
    }
  });

  socket.on('disconnect', () => {
    const room = roomOf();
    if (room && playerId) room.socketDisconnected(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[LAN Games] 服务已启动:`);
  console.log(`  本机访问:   http://localhost:${PORT}`);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs ?? []) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`  局域网访问: http://${i.address}:${PORT}`);
      }
    }
  }
});

import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type { SpectatorMode } from '@lan/shared';
import { getGame } from './games/registry.js';
import { Room } from './room.js';
import { InMemoryRoomStore, type RoomStore } from './store.js';

/**
 * 大厅服务：持有所有房间（经 RoomStore），分配房间号，处理创建/加入/观战。
 * 通过 lobby_update 广播房间列表，替代客户端轮询。
 */
export class Lobby {
  constructor(
    private readonly io: Server,
    private readonly store: RoomStore = new InMemoryRoomStore(),
  ) {}

  createRoom(gameId: string, playerId: string, playerName: string): { room: Room; rejoinToken: string } {
    const game = getGame(gameId);
    if (!game) throw new Error(`未知的游戏: ${gameId}`);
    const room = new Room(randomUUID(), this.allocCode(), game, this.io);
    this.store.save(room);
    const { rejoinToken } = room.addPlayer(playerId, playerName, true);
    room.onEmpty = () => {
      room.dispose();
      this.store.delete(room.id);
      this.broadcastLobby();
    };
    this.broadcastLobby();
    return { room, rejoinToken };
  }

  findByCode(code: string): Room | undefined {
    return this.store.getByCode(code);
  }

  get(roomId: string): Room | undefined {
    return this.store.get(roomId);
  }

  summaries() {
    return this.store.all().map((r) => r.summary());
  }

  /** 大厅房间列表变更时广播给所有连接（客户端仅在大厅页消费） */
  broadcastLobby(): void {
    this.io.emit('msg', { type: 'lobby_update', rooms: this.summaries() });
  }

  private allocCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!this.findByCode(code)) return code;
    }
    throw new Error('房间号分配失败');
  }
}

/** 观战模式默认值 */
export const DEFAULT_SPECTATOR_MODE: SpectatorMode = 'live';

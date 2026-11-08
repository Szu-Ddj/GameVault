import type { Room } from './room.js';

/**
 * 房间存储抽象——v1 用内存实现，未来可换持久化（文件/Redis）以支持 Host 重启不丢房。
 * 这是预留的持久化扩展点：实现此接口替换 InMemoryRoomStore 即可，Lobby/Room 无需改动。
 */
export interface RoomStore {
  get(roomId: string): Room | undefined;
  getByCode(code: string): Room | undefined;
  save(room: Room): void;
  delete(roomId: string): void;
  all(): Room[];
}

/** 内存实现：进程重启即丢失全部房间（v1 行为，文档已标注） */
export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }
  getByCode(code: string): Room | undefined {
    for (const r of this.rooms.values()) if (r.code === code) return r;
    return undefined;
  }
  save(room: Room): void {
    this.rooms.set(room.id, room);
  }
  delete(roomId: string): void {
    this.rooms.delete(roomId);
  }
  all(): Room[] {
    return [...this.rooms.values()];
  }
}

import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
  GameDefinition,
  GameRuntime,
  GameResult,
  GameSession,
  MemberInfo,
  PlayerInfo,
  RoomSnapshot,
  RoomState,
  SpectatorMode,
  TimerHandle,
  Viewer,
} from '@lan/shared';

const WAITING_GRACE_MS = 30_000; // 等待/已结束 断线保留座位
const PLAYING_GRACE_MS = 60_000; // 游戏中断线宽限期
const SPECTATOR_GRACE_MS = 15_000; // 观战者断线宽限期

interface PlayerRec {
  playerId: string;
  name: string;
  rejoinToken: string;
  ready: boolean;
  socketId: string | null;
}

interface SpectatorRec {
  playerId: string;
  name: string;
  rejoinToken: string;
  socketId: string | null;
  /** 观战者选择的观战模式 */
  mode: SpectatorMode;
}

/**
 * 每个游戏实例对应的运行时——游戏通过它主动推送事件、定时器、阶段流转。
 * session 销毁时 runtime 一并销毁，杜绝旧定时器触达新 session。
 */
class RuntimeImpl implements GameRuntime {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private dead = false;

  constructor(private readonly room: Room) {}

  pushViews(): void {
    if (!this.dead) this.room.pushGameViews();
  }
  broadcastEvent(event: unknown): void {
    if (!this.dead) this.room.io.to(this.room.id).emit('msg', { type: 'game_event', event });
  }
  sendPrivateEvent(playerIds: string[], event: unknown): void {
    if (this.dead) return;
    for (const pid of playerIds) {
      const sid = this.room.socketIdOf(pid);
      if (sid) this.room.io.to(sid).emit('msg', { type: 'game_private_event', event });
    }
  }
  scheduleTimer(ms: number, cb: () => void): TimerHandle {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) cb();
    }, ms);
    this.timers.add(t);
    return {
      cancel: () => {
        clearTimeout(t);
        this.timers.delete(t);
      },
    };
  }
  signalFinished(): void {
    if (!this.dead) this.room.onGameSignalFinished();
  }
  getPlayerInfo(playerId: string): { name: string; online: boolean } | null {
    return this.room.memberStatusOf(playerId);
  }
  playerIds(): readonly string[] {
    return this.room.playerIdList();
  }

  /** 房间销毁/再来一局时调用，取消所有定时器并标记失效 */
  destroy(): void {
    this.dead = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

/**
 * 房间：状态机 + 成员管理 + 断线重连 + 游戏实例驱动。
 * 对具体游戏零感知，只调用 GameSession 接口。
 */
export class Room {
  state: RoomState = 'WAITING';
  hostId: string;
  private players: PlayerRec[] = [];
  private spectators: SpectatorRec[] = [];
  private session: GameSession | null = null;
  private runtime: RuntimeImpl | null = null;
  private graceTimers = new Map<string, NodeJS.Timeout>();
  /** 房间空了之后由大厅移除 */
  onEmpty: () => void = () => {};
  /** 房间摘要变化时通知大厅广播 lobby_update（替代客户端轮询） */
  onLobbyChange?: () => void;

  constructor(
    readonly id: string,
    readonly code: string,
    private readonly game: GameDefinition,
    readonly io: Server,
  ) {
    this.hostId = '';
  }

  // ---------- 加入 / 离开 / 重连 ----------

  addPlayer(playerId: string, name: string, asHost = false): { playerId: string; rejoinToken: string } {
    const existing = this.players.find((p) => p.playerId === playerId);
    if (existing) return { playerId, rejoinToken: existing.rejoinToken };
    if (this.state !== 'WAITING' && this.state !== 'FINISHED') throw new Error('游戏进行中，无法加入');
    if (this.players.length >= this.game.maxPlayers) throw new Error('房间已满，可转为观战');
    const rejoinToken = randomUUID();
    this.players.push({ playerId, name, rejoinToken, ready: false, socketId: null });
    if (asHost) this.hostId = playerId;
    this.broadcastRoom();
    return { playerId, rejoinToken };
  }

  addSpectator(
    playerId: string,
    name: string,
    mode: SpectatorMode = 'live',
  ): { rejoinToken: string } {
    const existing = this.spectators.find((s) => s.playerId === playerId);
    if (existing) {
      existing.mode = mode;
      return { rejoinToken: existing.rejoinToken };
    }
    const rejoinToken = randomUUID();
    this.spectators.push({ playerId, name, rejoinToken, socketId: null, mode });
    this.broadcastRoom();
    return { rejoinToken };
  }

  /** 断线重连：校验 token 并绑定新 socket，恢复座位 */
  rejoin(playerId: string, rejoinToken: string, socket: Socket): 'player' | 'spectator' | null {
    const p = this.players.find((x) => x.playerId === playerId);
    if (p && p.rejoinToken === rejoinToken) {
      this.clearGrace(playerId);
      p.socketId = socket.id;
      this.broadcastRoom();
      this.pushGameViews();
      // 通知游戏插件该玩家已重连（恢复发言计时等）；仅在游戏进行中才回调，
      // FINISHED 状态下游戏已结束，回调会错误"复活"已判离场的玩家
      if (this.state === 'PLAYING') this.session?.onPlayerReconnect?.(playerId);
      return 'player';
    }
    const s = this.spectators.find((x) => x.playerId === playerId);
    if (s && s.rejoinToken === rejoinToken) {
      this.clearGrace(playerId);
      s.socketId = socket.id;
      this.broadcastRoom();
      this.pushGameViews();
      return 'spectator';
    }
    return null;
  }

  bindSocket(playerId: string, socketId: string): void {
    const p = this.players.find((x) => x.playerId === playerId);
    if (p) p.socketId = socketId;
    else {
      const s = this.spectators.find((x) => x.playerId === playerId);
      if (s) s.socketId = socketId;
    }
  }

  socketDisconnected(socketId: string): void {
    const p = this.players.find((x) => x.socketId === socketId);
    if (p) {
      p.socketId = null;
      // 断线保留座位，进入宽限期；宽限期内 rejoin 即恢复
      const ms = this.state === 'PLAYING' ? PLAYING_GRACE_MS : WAITING_GRACE_MS;
      this.graceTimers.set(
        p.playerId,
        setTimeout(() => this.removePlayer(p.playerId, '断线超时未重连'), ms),
      );
      this.broadcastRoom();
      return;
    }
    const s = this.spectators.find((x) => x.socketId === socketId);
    if (s) {
      // 观战者断线给短宽限期，避免网络抖动即被踢出
      this.graceTimers.set(
        s.playerId,
        setTimeout(() => this.removeSpectator(s.playerId), SPECTATOR_GRACE_MS),
      );
      this.broadcastRoom();
    }
  }

  removePlayer(playerId: string, reason = ''): void {
    this.clearGrace(playerId);
    const p = this.players.find((x) => x.playerId === playerId);
    if (!p) return;
    this.players = this.players.filter((x) => x !== p);
    if (this.session) this.session.onPlayerLeave(playerId);
    this.notify(p.playerId, 'kicked', { reason: reason || '已离开房间' });
    // 房主转移：优先选在线玩家，其次任意
    if (this.hostId === playerId && this.players.length > 0) {
      const online = this.players.find((x) => x.socketId !== null);
      this.hostId = (online ?? this.players[0]).playerId;
    }
    // P2 修复：PLAYING 状态下玩家全部离场 → 强制结束游戏，避免房间死锁
    if (this.state === 'PLAYING' && this.players.length === 0) {
      this.forceEndGame('全体玩家离场，游戏中断');
      if (this.spectators.length === 0) {
        this.dispose();
        this.onEmpty();
        return;
      }
    }
    if (this.players.length === 0 && this.spectators.length === 0) {
      this.dispose();
      this.onEmpty();
      return;
    }
    this.checkGameFinished();
    this.broadcastRoom();
    this.pushGameViews();
  }

  removeSpectator(playerId: string): void {
    this.clearGrace(playerId);
    this.spectators = this.spectators.filter((x) => x.playerId !== playerId);
    if (this.players.length === 0 && this.spectators.length === 0) {
      this.dispose();
      this.onEmpty();
    } else this.broadcastRoom();
  }

  /** 观战者转玩家（有空位且未开局/已结束时） */
  takeSeat(playerId: string): void {
    const s = this.spectators.find((x) => x.playerId === playerId);
    if (!s) return;
    if (this.state === 'PLAYING') throw new Error('游戏进行中，下一局再加入');
    if (this.players.length >= this.game.maxPlayers) throw new Error('座位已满');
    this.spectators = this.spectators.filter((x) => x !== s);
    this.players.push({ playerId, name: s.name, rejoinToken: s.rejoinToken, ready: false, socketId: s.socketId });
    this.broadcastRoom();
  }

  // ---------- 房间操作 ----------

  setReady(playerId: string, ready: boolean): void {
    const p = this.players.find((x) => x.playerId === playerId);
    if (!p) throw new Error('你不是座位玩家');
    p.ready = ready;
    this.broadcastRoom();
  }

  /** 房主开局；游戏结束后再次调用 = 再来一局 */
  startGame(playerId: string, config: unknown): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以开始');
    if (this.state === 'PLAYING') throw new Error('游戏已开始');
    if (this.players.length < this.game.minPlayers) {
      throw new Error(`人数不足，该游戏至少需要 ${this.game.minPlayers} 人`);
    }
    // 再来一局：先销毁旧 session 与 runtime（清理定时器）
    this.disposeSession();
    const infos: PlayerInfo[] = this.players.map((p) => ({ playerId: p.playerId, name: p.name }));
    this.players.forEach((p) => (p.ready = false));
    this.runtime = new RuntimeImpl(this);
    this.session = this.game.createSession(infos, config ?? {}, this.runtime);
    this.state = 'PLAYING';
    this.broadcastRoom();
    this.pushGameViews();
  }

  gameAction(playerId: string, action: unknown): void {
    if (!this.session) throw new Error('游戏未开始');
    // P5 修复：观战者不能发游戏操作
    if (!this.players.some((p) => p.playerId === playerId)) {
      throw new Error('观战者不能进行游戏操作');
    }
    this.session.handleAction(playerId, action);
    this.pushGameViews(); // 视图按人定向刷新
    if (this.session.isFinished()) this.endGame();
  }

  /** 房间内聊天广播 */
  broadcastChat(senderId: string, text: string): void {
    const sender =
      this.players.find((p) => p.playerId === senderId) ??
      this.spectators.find((s) => s.playerId === senderId);
    if (!sender) return;
    this.io.to(this.id).emit('msg', {
      type: 'chat_message',
      senderId,
      senderName: sender.name,
      text,
      timestamp: Date.now(),
    });
  }

  private endGame(): void {
    if (this.state === 'FINISHED') return; // 幂等
    const result = this.session?.result() ?? { winnerText: '游戏结束' };
    this.state = 'FINISHED';
    this.io.to(this.id).emit('msg', { type: 'game_over', result });
    this.broadcastRoom();
    this.pushGameViews();
  }

  /** 游戏主动结束（定时器/阶段流转触发的终局） */
  onGameSignalFinished(): void {
    if (this.state === 'PLAYING') this.endGame();
  }

  /** 强制结束并附带中断原因（如全员离场） */
  private forceEndGame(reason: string): void {
    if (this.state === 'FINISHED') return;
    this.state = 'FINISHED';
    const result: GameResult = { winnerText: reason, detail: { interrupted: true } };
    this.io.to(this.id).emit('msg', { type: 'game_over', result });
    this.broadcastRoom();
  }

  // ---------- 状态广播 ----------

  private gameStatus(): string {
    return this.session?.status() ?? '等待开始';
  }

  private memberInfo(list: (PlayerRec | SpectatorRec)[]): MemberInfo[] {
    return list.map((m) => ({
      playerId: m.playerId,
      name: m.name,
      ready: (m as PlayerRec).ready ?? false,
      online: m.socketId !== null,
      isHost: m.playerId === this.hostId,
    }));
  }

  private spectatorModes(): SpectatorMode[] {
    return this.game.spectatorModes ?? ['live'];
  }

  summary() {
    return {
      roomId: this.id,
      code: this.code,
      gameId: this.game.id,
      gameName: this.game.name,
      state: this.state,
      playerCount: this.players.length,
      maxPlayers: this.game.maxPlayers,
      spectatorCount: this.spectators.length,
    };
  }

  snapshot(): RoomSnapshot {
    return {
      roomId: this.id,
      code: this.code,
      state: this.state,
      hostId: this.hostId,
      gameId: this.game.id,
      gameName: this.game.name,
      gameStatus: this.gameStatus(),
      spectatorModes: this.spectatorModes(),
      players: this.memberInfo(this.players),
      spectators: this.memberInfo(this.spectators),
      minPlayers: this.game.minPlayers,
      maxPlayers: this.game.maxPlayers,
    };
  }

  broadcastRoom(): void {
    this.io.to(this.id).emit('msg', { type: 'room_state', room: this.snapshot() });
  }

  /** 视图按人定向推送：玩家各不相同，观战者按其选择的 mode 收到对应视图 */
  pushGameViews(): void {
    if (!this.session) return;
    for (const p of this.players) {
      if (p.socketId) {
        const viewer: Viewer = { id: p.playerId, role: 'player' };
        this.io.to(p.socketId).emit('msg', { type: 'game_view', view: this.session.viewFor(viewer) });
      }
    }
    for (const s of this.spectators) {
      if (s.socketId) {
        const viewer: Viewer = { id: null, role: 'spectator', spectatorMode: s.mode };
        this.io.to(s.socketId).emit('msg', { type: 'game_view', view: this.session.viewFor(viewer) });
      }
    }
  }

  notify(playerId: string, type: string, payload: Record<string, unknown>): void {
    const target = this.socketIdOf(playerId);
    if (target) this.io.to(target).emit('msg', { type, ...payload });
  }

  /** 供 RuntimeImpl 访问 */
  memberStatusOf(playerId: string): { name: string; online: boolean } | null {
    const p = this.players.find((x) => x.playerId === playerId);
    if (p) return { name: p.name, online: p.socketId !== null };
    const s = this.spectators.find((x) => x.playerId === playerId);
    if (s) return { name: s.name, online: s.socketId !== null };
    return null;
  }

  playerIdList(): readonly string[] {
    return this.players.map((p) => p.playerId);
  }

  socketIdOf(playerId: string): string | null {
    return (
      this.players.find((x) => x.playerId === playerId)?.socketId ??
      this.spectators.find((x) => x.playerId === playerId)?.socketId ??
      null
    );
  }

  private clearGrace(playerId: string): void {
    const t = this.graceTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(playerId);
    }
  }

  private checkGameFinished(): void {
    if (this.session?.isFinished() && this.state === 'PLAYING') this.endGame();
  }

  /** 销毁当前 session 与 runtime（再来一局/房间解散时调用） */
  private disposeSession(): void {
    this.session?.destroy?.();
    this.runtime?.destroy();
    this.session = null;
    this.runtime = null;
  }

  /** 房间彻底销毁：清理 session、runtime、所有 grace 定时器 */
  dispose(): void {
    this.disposeSession();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }
}

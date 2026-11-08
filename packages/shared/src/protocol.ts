import type { SpectatorMode } from './game-sdk.js';

/** 玩家/观战者公开展示信息 */
export interface MemberInfo {
  playerId: string;
  name: string;
  ready: boolean;
  online: boolean;
  isHost: boolean;
}

/** 房间状态机 */
export type RoomState = 'WAITING' | 'PLAYING' | 'FINISHED';

/** 大厅返回的房间公开信息 */
export interface RoomSummary {
  roomId: string;
  code: string;
  gameId: string;
  gameName: string;
  state: RoomState;
  playerCount: number;
  maxPlayers: number;
  spectatorCount: number;
}

/** 房间全量快照（room_state 广播内容） */
export interface RoomSnapshot {
  roomId: string;
  code: string;
  state: RoomState;
  hostId: string;
  gameId: string;
  gameName: string;
  /** 游戏插件下发的阶段文案，如"夜晚·狼人行动" */
  gameStatus: string;
  /** 房间可选的观战模式（游戏声明） */
  spectatorModes: SpectatorMode[];
  players: MemberInfo[];
  spectators: MemberInfo[];
  minPlayers: number;
  maxPlayers: number;
}

/** 游戏结算 */
export interface GameResult {
  winnerText: string;
  detail?: unknown;
}

// ---------- 客户端 → 服务端 ----------

export interface C2S {
  /** 创建房间 */
  create_room: { playerId: string; gameId: string; playerName: string };
  join_room: { playerId: string; code: string; playerName: string };
  /** 断线重连：携带加入时签发的 token，恢复原座位/观战身份；playerName 用于 token 失效时降级重新加入 */
  rejoin: { roomId: string; playerId: string; rejoinToken: string; playerName?: string };
  spectate: { playerId: string; code: string; playerName: string };
  /** 观战者转玩家（有空位时） */
  take_seat: Record<string, never>;
  ready: { ready: boolean };
  /** 房主开局，携带游戏配置（对应 configSchema） */
  start_game: { config?: unknown };
  game_action: { action: unknown };
  leave_room: Record<string, never>;
  chat: { text: string };
}

// ---------- 服务端 → 客户端 ----------

export interface S2C {
  room_state: { room: RoomSnapshot };
  /** 定向推送：每个玩家收到的内容不同（观战者收到观战视图） */
  game_view: { view: unknown };
  /** 全房广播的游戏事件（公屏信息，如法官播报） */
  game_event: { event: unknown };
  /** 仅发给相关玩家的私密游戏事件 */
  game_private_event: { event: unknown };
  game_over: { result: GameResult };
  joined: { roomId: string; playerId: string; rejoinToken: string; isSpectator: boolean };
  error: { message: string };
  kicked: { reason: string };
  /** 房间内聊天（全房可见；游戏内私密聊天由插件用 sendPrivateEvent） */
  chat_message: { senderId: string; senderName: string; text: string; timestamp: number };
  /** 大厅房间列表增量更新（替代轮询） */
  lobby_update: { rooms: RoomSummary[] };
}

/** 服务端加入成功后的本地会话信息（客户端持久化以支持重连） */
export interface ClientSession {
  serverUrl: string;
  roomId: string;
  playerId: string;
  rejoinToken: string;
  isSpectator: boolean;
}

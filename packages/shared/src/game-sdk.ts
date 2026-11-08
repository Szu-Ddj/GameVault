import type { GameResult } from './protocol.js';

/** 定时器句柄（游戏用于限时发言、操作超时等） */
export interface TimerHandle {
  cancel(): void;
}

/** 观战模式：决定 viewFor(null) 的可见范围 */
export type SpectatorMode = 'live' | 'god' | 'delayed';

/** 视图请求者身份——游戏据此过滤可见信息 */
export interface Viewer {
  /** 玩家 id；null = 观战者 */
  id: string | null;
  role: 'player' | 'spectator';
  /** 仅 role='spectator' 时有效；'god'=上帝视角看全部，'live'=实时但受限，'delayed'=延迟防偷看 */
  spectatorMode?: SpectatorMode;
}

/** 玩家元信息（createSession 入参） */
export interface PlayerInfo {
  playerId: string;
  name: string;
}

/**
 * 游戏主动推送通道——框架注入，游戏通过它驱动实时事件、定时器、阶段流转。
 * 这是承载狼人杀（夜晚多角色依次行动、法官播报、超时空刀、限时发言）等复杂流程的关键。
 */
export interface GameRuntime {
  /** 主动触发视图刷新（按人定向推送，每人看到 viewFor 的结果） */
  pushViews(): void;
  /** 公屏广播事件（全房可见，如法官播报"天黑请闭眼"） */
  broadcastEvent(event: unknown): void;
  /** 定向私密事件（仅指定玩家可见，如预言家查验结果只通知预言家） */
  sendPrivateEvent(playerIds: string[], event: unknown): void;
  /** 定时器（发言限时/操作超时/阶段自动流转），返回句柄可取消 */
  scheduleTimer(ms: number, cb: () => void): TimerHandle;
  /** 主动告知房间游戏结束（如定时器触发的判负、阶段流转到达终局） */
  signalFinished(): void;
  /** 获取玩家在线状态与昵称（游戏判断"是否轮到在线玩家"用） */
  getPlayerInfo(playerId: string): { name: string; online: boolean } | null;
  /** 当前所有玩家 id 列表（含离线占位的） */
  playerIds(): readonly string[];
}

/**
 * 游戏插件契约。
 * 泛型参数可选——插件内部可声明具体类型获得编译期保护，注册时擦除为默认 unknown。
 * 新增游戏只需实现并注册，框架（房间/重连/观战/大厅）零改动。
 */
export interface GameDefinition<TAction = unknown, TView = unknown, TConfig = unknown> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  description: string;
  /** 房主开局前可调的参数 schema（由房主 UI 渲染，校验后交给 createSession） */
  configSchema?: unknown;
  /** 声明支持的观战模式（游戏据此实现 viewFor 的 spectatorMode 分支） */
  spectatorModes?: SpectatorMode[];

  createSession(players: PlayerInfo[], config: TConfig, runtime: GameRuntime): GameSession<TAction, TView>;
}

export interface GameSession<TAction = unknown, TView = unknown> {
  /** 玩家操作入口；游戏自行校验合法性（轮到谁、action 是否合法） */
  handleAction(playerId: string, action: TAction): void;

  /** 游戏进行中有玩家离线（框架已做重连宽限，超时才会真正调用） */
  onPlayerLeave(playerId: string): void;
  /** 离线玩家重连恢复（可选；用于恢复发言计时等） */
  onPlayerReconnect?(playerId: string): void;

  /**
   * 视图权限过滤：玩家各自看到私有视图，观战者按 spectatorMode 过滤。
   * 服务端只下发 viewFor 的结果，未包含的信息永不离开服务端（防作弊 + 观战防偷看的关键）。
   */
  viewFor(viewer: Viewer): TView;

  /** 当前阶段文案（房间快照透传给所有成员） */
  status(): string;

  isFinished(): boolean;
  result(): GameResult | null;

  /** 生命周期清理：房间解散/再来一局时调用，取消定时器、释放资源 */
  destroy(): void;
}

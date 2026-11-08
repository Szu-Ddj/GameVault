# 局域网游戏平台 架构设计

> 目标：局域网多人游戏平台。支持房间号加入、大厅浏览、观战、断线重连；游戏以**插件**形式接入，彼此完全独立，可持续新增（第一款为狼人杀）。

## 1. 总体形态

```
┌─────────────────────  局域网 (LAN)  ─────────────────────┐
│                                                          │
│  ┌──────────────┐     HTTP(大厅) + WebSocket(实时)        │
│  │  Host 服务端  │◀──────────────────────────────────────▶│
│  │ Node.js + TS │        ┌──────────┐   ┌──────────┐      │
│  │  (权威节点)   │        │ 手机 App  │   │ 浏览器玩家 │     │
│  └──────────────┘        └──────────┘   └──────────┘      │
│         │                                                │
│    ┌────┴─────┬──────────┬──────────┐                       │
│    │ 核心框架  │ 游戏注册表 │ 狼人杀插件 │ 其他游戏插件...     │
│    └──────────┴──────────┴──────────┘                       │
└──────────────────────────────────────────────────────────┘
```

- **Host 服务端**：运行在局域网内任意一台设备（PC 优先，未来可嵌入 App 内）。是唯一的**权威（Authoritative）节点**，持有全部房间与游戏状态。
- **客户端**：Web 技术一套代码，两种形态同时满足——
  - 浏览器直接访问 `http://<host-ip>:<port>`
  - 同一份代码打包为手机 App（PWA 可安装 / 后续可用 Capacitor 壳打包上架），无需改代码。
- **客户端永远不做游戏逻辑**，只渲染服务端下发的"视图"并上报"操作"，天然支持观战与防作弊。

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 服务端 | Node.js + TypeScript + Socket.IO + Express | 前后端同语言共享协议类型；Socket.IO 自带重连、房间广播、ACK |
| 客户端 | React + TypeScript + Vite | 一套代码 → 浏览器 + PWA/App |
| 协议 | packages/shared 内共享 TS 类型 | 消息收发全类型安全 |
| 工程 | pnpm workspace monorepo | 游戏/客户端/共享包独立演进 |

## 3. 核心域模型

```
Lobby（大厅）
 └── RoomStore（存储抽象，v1 内存，可换持久化）
      └── Room（房间，唯一 6 位房间号）
           ├── Player[]     座位玩家（含离线但占位的玩家）
           ├── Spectator[]  观战者（断线给短宽限期，随时可进出）
           ├── state        房间状态机（见 §4）
           ├── GameSession  由 GameDefinition 插件创建的游戏实例
           └── GameRuntime  框架注入的主动推送通道（见 §5）
```

### 3.1 身份与重连（关键设计）

- 每个客户端首次进入时**本地生成持久 `playerId`**（UUID，存 localStorage），加入/创建房间时**携带给服务端**，服务端据此识别同一玩家。
- 每次加入房间时服务端签发 **`rejoinToken`**，客户端持久化（`ClientSession`）。
- **Socket 连接 ≠ 玩家**。玩家 = `playerId`；断线只是 socket 消失，座位保留。
- 断线后：
  - 房间内该玩家标记离线（`socketId=null`），广播给所有人；
  - 游戏进行中 → 房间进入**宽限期**（PLAYING=60s，WAITING/FINISHED=30s），期间游戏暂停等待；
  - 宽限期内重连（携带 `rejoinToken`）→ 恢复原座位、重放其**个人视图**、通知插件 `onPlayerReconnect`（恢复发言计时等），继续游戏；
  - 超时未归 → 移除座位；若 PLAYING 状态下全员离场且有观战者 → 强制结束游戏（避免死锁）。
- **rejoin 降级**：token 失效但房间仍存在时，服务端以原 `playerId` 尝试重新加入（恢复座位或转观战），避免用户手动重输房间号。
- 客户端 Socket.IO `connection` 断开后自动重连，重连成功即发 `rejoin` 携带 token + playerName（用于降级），无感恢复。

### 3.2 大厅与房间发现

- **大厅列表**：房间创建/解散/成员变化时服务端通过 WebSocket 广播 `lobby_update` 给所有连接，客户端大厅页实时刷新（**已替代 HTTP 轮询**）。
- **房间号**：6 位数字，客户端输入房间号直连加入。
- **REST 备用**：`GET /api/games`（游戏列表）、`GET /api/rooms`（房间列表快照）、`POST /api/rooms`（创建，备用入口）。
- 后续可加 **UDP/mDNS 广播**做零输入发现（架构预留 `DiscoveryProvider` 扩展点）。

## 4. 房间状态机

```
WAITING ──(房主点开始)──▶ PLAYING ──▶ FINISHED
   ▲  ▲                      │           │
   │  └─ 有玩家离开(等待期) ─┘           │
   │                                  (重开/回大厅)
   └────── 房主点击"再来一局" ──────────┘
```

- **加入/等待**：游戏插件声明 `minPlayers / maxPlayers`，房间据此控制加入、显示"等待中 x/max"；
- 人齐后房主点开始 → 插件 `createSession(players, config, runtime)` 创建游戏实例；
- 游戏中玩家离开 → 通知插件 `onPlayerLeave()`（由插件决定判负/托管/暂停，狼人杀=暂停等待重连）；
- **PLAYING 状态下全员离场** → 强制 `forceEndGame('全体离场')`，避免房间死锁（仅有观战者时房间保留，可看中断结果）。

## 5. 游戏插件架构（可扩展性核心）

所有游戏实现同一个接口，**游戏之间、游戏与框架之间零依赖**。框架只认接口，不认具体游戏。

### 5.1 GameRuntime——主动推送通道（关键）

游戏不仅是被动的"被查询/被命令"。框架在 `createSession` 时注入 `GameRuntime` 句柄，游戏通过它**主动驱动实时事件、定时器、阶段流转**：

```ts
interface GameRuntime {
  pushViews(): void;                        // 主动触发视图刷新（按人定向推送）
  broadcastEvent(event): void;              // 公屏广播（如法官播报"天黑请闭眼"）
  sendPrivateEvent(playerIds[], event): void; // 定向私密事件（如预言家查验结果只通知自己）
  scheduleTimer(ms, cb): TimerHandle;       // 定时器（发言限时/操作超时/超时空刀）
  signalFinished(): void;                   // 主动告知房间游戏结束（定时器触发的终局）
  getPlayerInfo(playerId): { name, online }; // 玩家在线状态与昵称
  playerIds(): readonly string[];           // 当前所有玩家 id
}
```

> session 销毁（房间解散/再来一局）时 runtime 一并 `destroy()`，**杜绝旧定时器触达新 session**。这是承载狼人杀（夜晚多角色依次行动、法官播报、超时空刀、限时发言）等复杂流程的关键。

### 5.2 游戏 SDK 契约

```ts
// packages/shared — 唯一契约（泛型参数可选，插件内部可声明具体类型获得编译期保护）
interface GameDefinition<TAction = unknown, TView = unknown, TConfig = unknown> {
  id: string;
  name: string;
  minPlayers: number;            // 支持单人游戏：min 可为 1
  maxPlayers: number;            // 2..N
  configSchema?: unknown;        // 房主可调参数（板子配置等），由房主 UI 渲染
  spectatorModes?: SpectatorMode[]; // 声明支持的观战模式

  createSession(players: PlayerInfo[], config: TConfig, runtime: GameRuntime): GameSession<TAction, TView>;
}

interface GameSession<TAction = unknown, TView = unknown> {
  handleAction(playerId: string, action: TAction): void;  // 游戏自行校验合法性
  onPlayerLeave(playerId: string): void;                  // 框架回调
  onPlayerReconnect?(playerId: string): void;              // 重连回调（可选）
  viewFor(viewer: Viewer): TView;  // 视图权限过滤——防作弊+观战防偷看的关键
  status(): string;                // 当前阶段文案
  isFinished(): boolean;
  result(): GameResult | null;
  destroy(): void;                 // 生命周期清理（取消定时器等）
}

interface Viewer {
  id: string | null;              // null = 观战者
  role: 'player' | 'spectator';
  spectatorMode?: 'live' | 'god' | 'delayed'; // 观战模式
}
```

约定：

1. **游戏完全独立**：每个游戏一个目录 `apps/server/src/games/<game-id>/`，只依赖 `packages/shared`；
2. **新增游戏 = 写一个插件 + 注册一行**，框架（房间/重连/观战/大厅）零改动；
3. 游戏内部自持状态机（狼人杀的夜晚/白天、投票等），框架不感知；
4. 客户端按 `game.id` 动态加载对应的游戏 UI 组件（注册表模式，同插件化）；
5. **类型安全**：插件内部可声明 `GameDefinition<MyAction, MyView, MyConfig>`，注册时擦除为默认 `unknown`，前后端按 gameId 在各自 UI 组件内收窄类型。

## 6. 通信协议

所有实时消息统一信封 `{ type, ...payload }`：

**客户端 → 服务端**：`create_room` | `join_room` | `rejoin` | `spectate` | `take_seat` | `ready` | `start_game` | `game_action` | `leave_room` | `chat`

**服务端 → 客户端**：`room_state` | `game_view` | `game_event` | `game_private_event` | `game_over` | `joined` | `error` | `kicked` | `chat_message` | `lobby_update`

- `room_state`：房间全量快照（成员、状态、游戏 id、观战模式），任何变更**全房广播**；
- `game_view`：**按人定向推送**（`viewFor` 结果），玩家各不相同，观战者按其 `spectatorMode` 收到对应视图；
- `game_event`：全房广播的游戏事件（公屏，如法官播报）——由游戏通过 `runtime.broadcastEvent` 主动发射；
- `game_private_event`：定向私密事件（仅指定玩家可见）——由游戏通过 `runtime.sendPrivateEvent` 主动发射；
- `lobby_update`：大厅房间列表增量（替代轮询）；
- 观战者随时可加入，不占座位；框架层阻止观战者发 `game_action`；游戏可通过 `spectatorMode` 区分上帝视角/实时受限/延迟防偷看。

## 7. 目录结构

```
Werewolf/
├── docs/ARCHITECTURE.md          # 本文档
├── packages/shared/              # 协议 + 游戏 SDK（前后端共享）
│   └── src/ protocol.ts game-sdk.ts
├── apps/server/                  # Host 服务端
│   └── src/
│       ├── index.ts              # 启动 & Socket.IO 接入
│       ├── http.ts               # 大厅 REST（游戏列表/房间列表/创建）
│       ├── lobby.ts              # 大厅服务（房间号分配、lobby_update 广播）
│       ├── store.ts              # RoomStore 抽象（v1 内存，可换持久化）
│       ├── room.ts               # 房间状态机 + 成员/重连/GameRuntime 实现
│       └── games/
│           ├── registry.ts       # 游戏注册表（新增游戏在此注册）
│           └── hello/            # 示例游戏（验证 1..N 人、观战、重连、主动推送、定时器）
└── apps/web-client/              # 浏览器 + 手机 App（同一份代码）
    └── src/
        ├── pages/ Lobby.tsx Room.tsx   # 大厅（列表+房间号加入）、房间（断线遮罩+聊天）
        └── games/ registry.tsx hello/  # 游戏客户端 UI（同样插件化）
```

## 8. 新增一款游戏的步骤（开发者视角）

1. `apps/server/src/games/my-game/` 实现并导出 `GameDefinition<MyAction, MyView, MyConfig>`，在 `registry.ts` 注册；
2. `apps/web-client/src/games/my-game/` 写对应 UI 组件，在 `App.tsx` 调用 `registerGameView` 注册（输入=viewFor 渲染 + 操作按钮）；
3. 完成。大厅自动出现该游戏，房间系统自动支持其人数范围、观战模式、断线重连。

## 9. 扩展点（已预留）

- **持久化**：`RoomStore` 抽象接口已定义（v1 内存实现），未来实现该接口换 Redis/文件即可支持 Host 重启不丢房；
- **观战模式**：`spectatorMode`（live/god/delayed）已接入 SDK，游戏按模式实现 `viewFor` 分支即可；
- **游戏配置**：`configSchema` + `start_game` 的 `config` 字段已打通，房主 UI 渲染表单即可（狼人杀板子配置等）；
- **UDP/mDNS** 局域网自动发现 Host（`DiscoveryProvider`）；
- **回放**：游戏可通过 `runtime.broadcastEvent` 输出结构化事件日志，服务端可录制（需后续在 runtime 加录制钩子）；
- **跨局域网联机**（中继/联机大厅）；
- **狼人杀游戏插件**（规则见 `werewolf.md`，SDK 已具备承载能力）。

## 10. 安全边界

- **仅限局域网**：CORS `origin: '*'` 仅适用 LAN。公网部署需收紧 CORS + 加鉴权。
- **服务端权威**：客户端永不持有游戏状态，只渲染 `viewFor` 结果，天然防作弊。
- **观战隔离**：框架层阻止观战者发 `game_action`；游戏内部需校验"是否轮到该玩家行动"（SDK 已在注释中强调）。

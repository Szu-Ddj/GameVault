import type { GameDefinition, GameResult, GameRuntime, GameSession, PlayerInfo, Viewer } from '@lan/shared';

/**
 * 示例游戏「点数对决」——验证框架的 1..N 人、私有视图、观战、断线重连、
 * 主动推送（broadcastEvent 演示）、定时器（scheduleTimer 演示）、生命周期 destroy。
 *
 * 玩家各自秘密选 1-6，全部选完后比大小，最大者胜（可并列）。
 * 单人也能玩（min=1），选完即出结果。
 */

interface PlayerState {
  pick: number | null;
  left: boolean;
}

interface HelloView {
  game: 'hello';
  hint: string;
  myPick: number | null;
  canAct: boolean;
  players: { playerId: string; picked: boolean; pick: number | null; left: boolean }[];
}

class HelloSession implements GameSession<HelloAction, HelloView> {
  private states = new Map<string, PlayerState>();
  private runtime: GameRuntime;
  private timerHandle: { cancel: () => void } | null = null;

  constructor(players: PlayerInfo[], _config: unknown, runtime: GameRuntime) {
    this.runtime = runtime;
    for (const p of players) this.states.set(p.playerId, { pick: null, left: false });
    // 演示主动推送：开局 30s 未选完自动判超时
    this.timerHandle = runtime.scheduleTimer(30_000, () => {
      // 超时：未选的视为放弃（pick=null 且 left=true 强制结束判定）
      for (const s of this.states.values()) if (s.pick === null && !s.left) s.left = true;
      runtime.broadcastEvent({ type: 'timeout', text: '选择超时，未选玩家视为放弃' });
      runtime.pushViews();
      runtime.signalFinished();
    });
  }

  handleAction(playerId: string, action: HelloAction): void {
    const s = this.states.get(playerId);
    if (!s || s.left) return;
    if (action.pick === undefined) return;
    const { pick } = action;
    if (typeof pick !== 'number' || !Number.isInteger(pick) || pick < 1 || pick > 6) return;
    if (s.pick !== null) return; // 已选，不可更改
    s.pick = pick;
    // 演示定向私密事件：告知该玩家已记录选择
    this.runtime.sendPrivateEvent([playerId], { type: 'picked', value: pick });
    this.runtime.pushViews();
  }

  onPlayerLeave(playerId: string): void {
    const s = this.states.get(playerId);
    if (s) s.left = true;
    this.runtime.pushViews();
  }

  onPlayerReconnect(playerId: string): void {
    const s = this.states.get(playerId);
    if (s && s.left) s.left = false; // 重连恢复可继续选择
    this.runtime.pushViews();
  }

  viewFor(viewer: Viewer): HelloView {
    const me = viewer.id ? this.states.get(viewer.id) : null;
    const showAll = this.isFinished() || (viewer.role === 'spectator' && viewer.spectatorMode === 'god');
    return {
      game: 'hello',
      hint: '选一个 1-6 的点数，全部选完后最大的获胜',
      myPick: me?.pick ?? null,
      canAct: !!me && !me.left && me.pick === null,
      players: [...this.states.entries()].map(([id, s]) => ({
        playerId: id,
        picked: s.pick !== null,
        pick: (viewer.id === id || showAll) ? s.pick : null, // 他人点数仅结算后或上帝视角可见
        left: s.left,
      })),
    };
  }

  status(): string {
    const pending = [...this.states.values()].filter((s) => !s.left && s.pick === null).length;
    return pending > 0 ? `等待选择 · 剩 ${pending} 人` : '已全部选择';
  }

  isFinished(): boolean {
    const active = [...this.states.values()].filter((s) => !s.left);
    if (active.length === 0) return true; // 全员离场
    return active.every((s) => s.pick !== null);
  }

  result(): GameResult | null {
    if (!this.isFinished()) return null;
    const active = [...this.states.entries()].filter(([, s]) => !s.left && s.pick !== null);
    if (active.length === 0) return { winnerText: '无人完成选择，本局作废' };
    const max = Math.max(...active.map(([, s]) => s.pick!));
    const winners = active.filter(([, s]) => s.pick === max).map(([id]) => id);
    return { winnerText: `最大点数 ${max} · 获胜: ${winners.join(', ')}`, detail: { winners } };
  }

  destroy(): void {
    this.timerHandle?.cancel();
    this.timerHandle = null;
  }
}

interface HelloAction {
  pick?: number;
}

export const helloGame: GameDefinition<HelloAction, HelloView> = {
  id: 'hello',
  name: '点数对决（示例）',
  description: '示例游戏：验证 1..N 人、私有视图、观战、断线重连、主动推送与定时器',
  minPlayers: 1,
  maxPlayers: 20,
  spectatorModes: ['live', 'god'],
  createSession: (players, config, runtime) => new HelloSession(players, config, runtime),
};

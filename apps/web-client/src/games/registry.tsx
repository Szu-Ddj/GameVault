import type { ComponentType } from 'react';
import type { SpectatorMode } from '@lan/shared';

/**
 * 客户端游戏 UI 注册表 —— 与服务端插件一一对应。
 * 新增游戏：写一个 GameView 组件并在此注册。
 */
export interface GameViewProps {
  view: unknown;
  isSpectator: boolean;
  /** 观战模式（仅 isSpectator 时有效）：'god'=上帝视角，'live'=实时受限，'delayed'=延迟防偷看 */
  spectatorMode?: SpectatorMode;
  onAction: (action: unknown) => void;
}

const registry = new Map<string, ComponentType<GameViewProps>>();

export function registerGameView(gameId: string, component: ComponentType<GameViewProps>): void {
  registry.set(gameId, component);
}

export function getGameView(gameId: string): ComponentType<GameViewProps> | undefined {
  return registry.get(gameId);
}

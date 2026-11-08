import type { GameDefinition } from '@lan/shared';
import { helloGame } from './hello/index.js';

/**
 * 游戏注册表 —— 新增游戏只需在此注册一行，框架其余部分零改动。
 */
const registry = new Map<string, GameDefinition>();

export function registerGame(game: GameDefinition): void {
  if (registry.has(game.id)) throw new Error(`游戏重复注册: ${game.id}`);
  registry.set(game.id, game);
}

export function getGame(gameId: string): GameDefinition | undefined {
  return registry.get(gameId);
}

export function listGames(): GameDefinition[] {
  return [...registry.values()];
}

registerGame(helloGame);
// registerGame(werewolfGame);  // TODO: 狼人杀插件完成后注册

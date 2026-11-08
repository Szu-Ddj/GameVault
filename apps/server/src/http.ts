import { Router } from 'express';
import type { Lobby } from './lobby.js';
import { listGames } from './games/registry.js';

/** 大厅 REST：房间列表（大厅页"看游戏"）、创建房间 */
export function createLobbyRouter(lobby: Lobby): Router {
  const router = Router();

  router.get('/games', (_req, res) => {
    res.json(
      listGames().map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
      })),
    );
  });

  router.get('/rooms', (_req, res) => {
    res.json(lobby.summaries());
  });

  router.post('/rooms', (req, res) => {
    const { playerId, gameId, playerName } = req.body ?? {};
    if (typeof gameId !== 'string' || typeof playerName !== 'string' || typeof playerId !== 'string') {
      return res.status(400).json({ error: '需要 playerId、gameId 与 playerName' });
    }
    try {
      const { room, rejoinToken } = lobby.createRoom(gameId, playerId, playerName);
      return res.json({ roomId: room.id, code: room.code, playerId, rejoinToken });
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}

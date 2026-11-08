import { io } from 'socket.io-client';
import type { C2S, ClientSession } from '@lan/shared';

/** 单例长连接：自动重连是框架内置能力，断线由 App 层用 rejoin 恢复会话 */
export const socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000 });

export function send<T extends keyof C2S>(type: T, payload: C2S[T]): void {
  socket.emit('msg', { type, ...payload });
}

// ---------- 本地持久化（支持刷新/断线后自动恢复会话） ----------

const PID_KEY = 'lan_player_id';
const NAME_KEY = 'lan_name';
const SESSION_KEY = 'lan_session';

export function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

export function loadName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}
export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function loadSession(): ClientSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ClientSession) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: ClientSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

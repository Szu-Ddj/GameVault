import type { GameViewProps } from '../registry';

interface HelloViewData {
  hint: string;
  myPick: number | null;
  canAct: boolean;
  players: { playerId: string; picked: boolean; pick: number | null; left: boolean }[];
}

export default function HelloView({ view, isSpectator, spectatorMode, onAction }: GameViewProps) {
  const v = view as HelloViewData;
  return (
    <div style={{ padding: 12 }}>
      <p style={{ color: '#9ab' }}>
        {v.hint}
        {isSpectator ? `（观战·${spectatorMode === 'god' ? '上帝视角' : '实时'}）` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            disabled={!v.canAct}
            onClick={() => onAction({ pick: n })}
            style={{
              width: 52,
              height: 52,
              fontSize: 20,
              borderRadius: 8,
              border: v.myPick === n ? '2px solid #4ade80' : '1px solid #456',
              background: v.myPick === n ? '#14532d' : '#24243e',
              color: '#eee',
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {v.players.map((p) => (
          <li key={p.playerId} style={{ padding: '6px 0', borderBottom: '1px solid #2a2a4a', color: p.left ? '#667' : '#eee' }}>
            {p.picked ? (p.pick !== null ? `已选 ${p.pick}` : '已选择（保密）') : '思考中…'}
            {p.left && '（已离场）'}
          </li>
        ))}
      </ul>
    </div>
  );
}

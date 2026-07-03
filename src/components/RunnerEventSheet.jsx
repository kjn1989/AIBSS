import React from 'react';
import Sheet from './Sheet.jsx';
import { useStore, usePlayerName, isMyTeamBatting } from '../state/store.jsx';

// 塁タップで開く走者イベントシート
// 盗塁・盗塁死・暴投・捕逸・牽制死などの簡易パターンをワンタップ反映
// onPinchRunner(slot): 代走シートを開く(自チーム攻撃時のみ)
export default function RunnerEventSheet({ game, base, onClose, onPinchRunner }) {
  const { dispatch } = useStore();
  const nameOf = usePlayerName();
  const runner = game.runners[base];
  const baseName = ['', '一塁', '二塁', '三塁'][base];
  const next = base + 1 >= 4 ? 4 : base + 1;

  const fire = (event, moves) => {
    dispatch({ type: 'RUNNER_EVENT', gameId: game.id, event, moves });
    onClose();
  };

  // 連鎖進塁: 次塁が埋まっていれば前の走者も押し出して進める(ダブルスチール等)
  const chainAdvance = (from) => {
    const moves = [];
    let b = from;
    while (b <= 3) {
      const to = b + 1 >= 4 ? 4 : b + 1;
      moves.push({ from: b, to });
      if (to === 4 || !game.runners[to]) break;
      b = to;
    }
    return moves;
  };
  const sbMoves = chainAdvance(base);
  const isDouble = sbMoves.length > 1;

  // 暴投/捕逸: 全走者1つ進塁
  const allAdvanceMoves = [3, 2, 1]
    .filter((b) => game.runners[b])
    .map((b) => ({ from: b, to: b + 1 >= 4 ? 4 : b + 1 }));

  if (!runner) {
    return (
      <Sheet title={`${baseName} (走者なし)`} onClose={onClose}>
        <p className="small dim">この塁に走者はいません。修正用に走者を手動配置できます。</p>
        <div className="sheet-actions">
          <button
            onClick={() => {
              dispatch({
                type: 'SET_RUNNER', gameId: game.id, base,
                runner: { playerId: null, pitcherId: isMyTeamBatting(game) ? null : game.currentPitcherId },
              });
              onClose();
            }}
          >
            走者を置く(修正)
          </button>
          <button className="ghost" onClick={onClose}>閉じる</button>
        </div>
      </Sheet>
    );
  }

  const name = runner.playerId ? nameOf(runner.playerId) : '走者';
  // 代走: この走者の打順スロット(自チーム攻撃時のみ存在)
  const runnerSlot = runner.playerId ? game.lineup.find((l) => l.playerId === runner.playerId) : null;

  return (
    <Sheet title={`${baseName}: ${name}`} onClose={onClose}>
      {runnerSlot && onPinchRunner && (
        <button
          className="primary"
          style={{ width: '100%', marginBottom: 10 }}
          onClick={() => onPinchRunner(runnerSlot)}
        >
          🔄 代走を送る({name}に代えて)
        </button>
      )}
      <div className="grid2">
        <button className="primary" onClick={() => fire('sb', sbMoves)}>
          盗塁成功{isDouble ? '(重盗)' : ''} → {next === 4 ? '本塁' : ['', '一', '二', '三'][next] + '塁'}
        </button>
        <button className="danger" onClick={() => fire('cs', [{ from: base, to: 'out' }])}>
          盗塁死
        </button>
        <button onClick={() => fire('wp', allAdvanceMoves)}>暴投(全走者進塁)</button>
        <button onClick={() => fire('pb', allAdvanceMoves)}>捕逸(全走者進塁)</button>
        <button className="danger" onClick={() => fire('pickoff', [{ from: base, to: 'out' }])}>
          牽制死
        </button>
        {base < 3 && (
          <button onClick={() => fire('wp', chainAdvance(base))}>
            この走者が進塁
          </button>
        )}
        {base === 3 && (
          <button onClick={() => fire('wp', [{ from: 3, to: 4 }])}>この走者が生還</button>
        )}
      </div>
      <div className="sheet-actions">
        <button
          className="ghost danger"
          onClick={() => {
            dispatch({ type: 'SET_RUNNER', gameId: game.id, base, runner: null });
            onClose();
          }}
        >
          走者を消す(修正)
        </button>
        <button className="ghost" onClick={onClose}>閉じる</button>
      </div>
    </Sheet>
  );
}

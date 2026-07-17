import React, { useState } from 'react';
import Sheet from './Sheet.jsx';
import { useStore, useT, usePlayerName, isMyTeamBatting } from '../state/store.jsx';

// 塁タップで開く走者イベントシート
// 盗塁・盗塁死・暴投・捕逸・牽制死などの簡易パターンをワンタップ反映
// onPinchRunner(slot): 代走シートを開く(自チーム攻撃時)
// onPinchRunnerOpp(slot): 相手走者への代走シートを開く(相手チーム攻撃時)
export default function RunnerEventSheet({ game, base, onClose, onPinchRunner, onPinchRunnerOpp }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [showCR, setShowCR] = useState(false);
  const runner = game.runners[base];
  const baseName = t(`base.${base}`);
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
      <Sheet title={t('runner.noRunner', { base: baseName })} onClose={onClose}>
        <p className="small dim">{t('runner.noRunnerHint')}</p>
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
            {t('runner.place')}
          </button>
          <button className="ghost" onClick={onClose}>{t('action.close')}</button>
        </div>
      </Sheet>
    );
  }

  const name = runner.playerId ? nameOf(runner.playerId) : runner.letter || t('runner.fallback');
  // 代走: この走者の打順スロット(自チーム攻撃時) / 相手打順スロット(相手チーム攻撃時)
  const runnerSlot = runner.playerId ? game.lineup.find((l) => l.playerId === runner.playerId) : null;
  const oppRunnerSlot = runner.letter ? game.oppLineup?.find((l) => l.letter === runner.letter) : null;

  return (
    <Sheet title={`${baseName}: ${name}`} onClose={onClose}>
      {runnerSlot && onPinchRunner && (
        <button
          className="primary"
          style={{ width: '100%', marginBottom: 10 }}
          onClick={() => onPinchRunner(runnerSlot)}
        >
          {t('runner.pinch', { name })}
        </button>
      )}
      {/* 臨時代走: 塁上だけ差し替え、打順は変えず元の選手は次打席で復帰する */}
      {runner.playerId && (
        <>
          <button className="ghost" style={{ width: '100%', marginBottom: showCR ? 6 : 10 }} onClick={() => setShowCR((v) => !v)}>
            {t('runner.courtesyToggle', { name })}
          </button>
          {showCR && (
            <div className="mb8">
              <p className="small dim">{t('runner.courtesyHint', { name })}</p>
              <div className="grid2">
                {state.players
                  .filter((p) => !p.id.startsWith('demo-') && ![1, 2, 3].some((b) => game.runners[b]?.playerId === p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      className="small"
                      onClick={() => {
                        dispatch({ type: 'COURTESY_RUNNER', gameId: game.id, base, playerId: p.id });
                        onClose();
                      }}
                    >
                      {p.name}{p.number ? ` #${p.number}` : ''}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
      {oppRunnerSlot && onPinchRunnerOpp && (
        <button
          className="primary"
          style={{ width: '100%', marginBottom: 10 }}
          onClick={() => onPinchRunnerOpp(oppRunnerSlot)}
        >
          {t('runner.oppPinch', { name })}
        </button>
      )}
      <div className="grid2">
        <button className="primary" onClick={() => fire('sb', sbMoves)}>
          {t('runner.sbSuccess', { double: isDouble ? t('runner.sbDouble') : '', base: t(`base.${next}`) })}
        </button>
        <button className="danger" onClick={() => fire('cs', [{ from: base, to: 'out' }])}>
          {t('runner.cs')}
        </button>
        <button onClick={() => fire('wp', allAdvanceMoves)}>{t('runner.wp')}</button>
        <button onClick={() => fire('pb', allAdvanceMoves)}>{t('runner.pb')}</button>
        <button className="danger" onClick={() => fire('pickoff', [{ from: base, to: 'out' }])}>
          {t('runner.pickoff')}
        </button>
        <button onClick={() => fire('pickoffThrow', [])}>{t('runner.pickoffSafe')}</button>
        {base < 3 && (
          <button onClick={() => fire('wp', chainAdvance(base))}>
            {t('runner.advance')}
          </button>
        )}
        {base === 3 && (
          <button onClick={() => fire('wp', [{ from: 3, to: 4 }])}>{t('runner.score')}</button>
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
          {t('runner.remove')}
        </button>
        <button className="ghost" onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

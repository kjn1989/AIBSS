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

  // 盗塁死＋ほかの走者の進塁・生還。この走者より前に走者がいるときだけ出す。
  //   前の走者がみんな1つ進む(三塁走者は生還)形と、三塁走者だけが生還する形
  const whoAt = (b) => {
    const r = game.runners[b];
    return r ? (r.playerId ? nameOf(r.playerId) : r.letter || t('runner.fallback')) : '';
  };
  const ahead = [3, 2, 1].filter((b) => b > base && game.runners[b]);
  const csCombos = [];
  if (ahead.length && base < 3) {
    const all = [...ahead.map((b) => ({ from: b, to: b + 1 >= 4 ? 4 : b + 1 })), { from: base, to: 'out' }];
    const scoreOnly = game.runners[3] ? [{ from: 3, to: 4 }, { from: base, to: 'out' }] : null;
    if (scoreOnly) {
      csCombos.push({
        key: 'score3', moves: scoreOnly,
        title: t('runner.csScore', { name }),
        sub: t('runner.csScoreSub', { r3: whoAt(3) }),
      });
    }
    // 前の走者が全員1つ進む形(三塁走者だけの場合は上と同じなので出さない)
    if (!scoreOnly || ahead.length > 1) {
      csCombos.push({
        key: 'all', moves: all,
        title: t('runner.csAdvance', { name }),
        sub: ahead.map((b) => t(b === 3 ? 'runner.csSubScore' : 'runner.csSubAdv', { who: whoAt(b), base: t(`base.${b + 1}`) })).join('・'),
      });
    }
  }
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
      {/* 盗塁死の間に、前の走者が進む・生還する(一三塁で一塁走者が挟まれ、その間に三塁走者が生還 など)。
          よくある形をそのまま1つのボタンにする。押すと「盗塁死」と「その間の生還/進塁」が一度に入る */}
      {csCombos.length > 0 && (
        <div className="cs-combos">
          {csCombos.map((c) => (
            <button key={c.key} className="cs-combo" onClick={() => fire('cs', c.moves)}>
              <b>{c.title}</b>
              <span>{c.sub}</span>
            </button>
          ))}
          {game.outs === 2 && <p className="small dim" style={{ margin: '4px 2px 0' }}>{t('runner.csComboTwoOuts')}</p>}
        </div>
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
        <button onClick={() => fire('balk', allAdvanceMoves)}>{t('runner.balk')}</button>
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

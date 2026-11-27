import { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { isMyTeamBatting } from '../state/store.jsx';
import Sheet from './Sheet.jsx';
import EditPlaySheet from './EditPlaySheet.jsx';

// かんたん記録のスコア入力に足す、止まらないための道具(結果パッドの下に置く)。
//  - 「不明」: 誰がどんな結果か分からないとき、飛ばして先へ進む(あとで入れられる)
//  - 「この回は得点だけ」: 打者ごとに付けず、その回の得点だけ入れて次へ
//  - 「直前の打席を直す」: 結果と守備位置だけを1画面で直す
// detail: くわしく記録の試合。「直前の打席を直す」は既存の「記録を直す」があるので出さない
export default function SimpleExtras({ game, onScoreOnly, detail = false }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [edit, setEdit] = useState(null);
  const mine = isMyTeamBatting(game);
  // 直前の打席(または飛ばした打席)。一番新しいものから直す
  const last = [...game.playLogs].reverse().find((l) => ['atbat', 'defense', 'skip'].includes(l.kind));
  const lastWho = last && (last.kind === 'atbat' || (last.kind === 'skip' && last.payload.mine)
    ? nameOf(last.payload.playerId)
    : (game.oppNames?.[last.payload.letter] || last.payload.letter));
  const skips = game.playLogs.filter((l) => l.kind === 'skip').length;
  return (
    <div className="simple-extras">
      <div className="grid2">
        <button className="skip-btn" onClick={() => dispatch({ type: 'SKIP_BATTER', gameId: game.id })}>
          {t('simple.skip')}
        </button>
        <button className="skip-btn" onClick={onScoreOnly}>
          {t(mine ? 'simple.scoreOnlyMine' : 'simple.scoreOnlyOpp')}
        </button>
      </div>
      <p className="small dim" style={{ margin: '6px 2px 0' }}>{t('simple.skipHint')}</p>
      {last && !detail && (
        <button className="last-fix" onClick={() => setEdit(last)}>
          <span className="dim small">{t('simple.last')}</span>
          <b>{lastWho}</b>
          <span className="grow" />
          <span className="pill blue">{t('simple.fix')}</span>
        </button>
      )}
      {skips > 0 && (
        <div className="warn-box mt8">
          {t('simple.skipsLeft', { n: skips })}
          <div>
            {game.playLogs.filter((l) => l.kind === 'skip').map((l) => (
              <button key={l.id} className="small mt8" style={{ marginRight: 6 }} onClick={() => setEdit(l)}>
                {t('simple.enterResult', { name: l.payload.mine ? nameOf(l.payload.playerId) : (game.oppNames?.[l.payload.letter] || l.payload.letter), n: l.inning })}
              </button>
            ))}
          </div>
        </div>
      )}
      {edit && <EditPlaySheet game={game} log={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// その回の得点だけを入れて次へ進む
export function ScoreOnlySheet({ game, onClose }) {
  const { dispatch } = useStore();
  const t = useT();
  const [runs, setRuns] = useState(0);
  const mine = isMyTeamBatting(game);
  return (
    <Sheet title={t('simple.scoreOnlyTitle', { n: game.inning, half: t(game.isTop ? 'half.top' : 'half.bottom') })} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t(mine ? 'simple.scoreOnlyNoteMine' : 'simple.scoreOnlyNoteOpp')}</p>
      <div className="score-only-step">
        <button onClick={() => setRuns(Math.max(0, runs - 1))} aria-label="-1">−</button>
        <b>{runs}</b>
        <button onClick={() => setRuns(runs + 1)} aria-label="+1">＋</button>
      </div>
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={() => { dispatch({ type: 'SCORE_ONLY_HALF', gameId: game.id, runs }); onClose(); }}>
          {t('simple.scoreOnlyDone', { n: runs })}
        </button>
      </div>
    </Sheet>
  );
}

import React from 'react';
import { useT } from '../state/store.jsx';
import { TRAJECTORIES, CONTACTS, contactCandidate } from '../lib/battedBall.js';

// ============================================================
// 打球パッド: 行=軌道(ゴロ/ライナー/フライ) × 列=強さ(弱い/平凡/強い)
//
// これまでアウトのときだけ4択(ゴロ/フライ/ライナー/併殺)を聞いていた。
// 9マスに置き換えても押す回数は1回のままで、強さが一緒に入る。
// ヒットのときも同じ表を出す(こちらは任意。押さずに確定できる)。
//
// マスの呼び名は「ゴロ＋弱い」を組み立てさせず、実際に口にする言葉
// (ボテボテ・ポテン・大飛球)を置く。探して押すほうが速いため。
//
// 深さが入っていれば、いちばんありそうなマスを点線で「候補」として示す。
// ただし候補は勝手に確定しない。押さずに確定した打席は未記録のまま。
// 押していないものを平凡として数え始めると、ハードヒット率がすぐ嘘になる。
// ============================================================

// 軌道の小さな図。言葉より先に形で見分けられるように添える
const GLYPH = {
  ground: 'M2,14 Q7,4 12,14 Q16,7 20,14 Q23,10 26,14',
  liner: 'M2,13 L26,5',
  fly: 'M2,15 Q14,-6 26,15',
};

export default function BattedBallPad({ trajectory, contact, depth, onChange, dp, onDp, dpDisabled, ifly, onIfly, iflyDisabled }) {
  const t = useT();
  const cand = contactCandidate(trajectory, depth);

  const pick = (tr, c) => {
    // 同じマスをもう一度押したら強さだけ解除(未記録に戻せる道を必ず残す)。
    // 軌道は残す。アウトの種類まで消えると記録が後退してしまう。
    onChange(tr, trajectory === tr && contact === c ? null : c);
  };

  return (
    <>
      <div className="cpad">
        <div />
        {CONTACTS.map((c) => (
          <div key={c} className="cpad-colhead">{t(`contact.${c}`)}</div>
        ))}
        {TRAJECTORIES.map((tr) => (
          <React.Fragment key={tr}>
            <div className="cpad-rowhead">
              <svg width="28" height="18" viewBox="0 0 28 18" aria-hidden="true">
                <path d={GLYPH[tr]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span>{t(`outType.${tr}`)}</span>
            </div>
            {CONTACTS.map((c) => {
              const on = trajectory === tr && contact === c;
              const isCand = !contact && trajectory === tr && cand === c;
              return (
                <button
                  key={c}
                  type="button"
                  className={`cpad-cell${on ? ' sel' : ''}${isCand ? ' cand' : ''}`}
                  data-s={c}
                  aria-pressed={on}
                  onClick={() => pick(tr, c)}
                >
                  {t(`battedBall.${tr}.${c}`)}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {/* 併殺とインフィールドフライは打球の軌道ではなく「そのアウトが何だったか」。
          場面が成り立たないときは押せないようにする(一二塁2アウト未満でだけ宣告される) */}
      <div className="cpad-foot">
        <button
          type="button"
          className={`small${dp ? ' primary' : ''}`}
          onClick={onDp}
          disabled={dpDisabled}
        >
          {t('outType.dp')}
        </button>
        {onIfly && (
          <button
            type="button"
            className={`small${ifly ? ' primary' : ''}`}
            onClick={onIfly}
            disabled={iflyDisabled}
            title={iflyDisabled ? t('outType.iflyWhen') : undefined}
          >
            {t('outType.ifly')}
          </button>
        )}
        <span className="dim small">{t('battedBall.optional')}</span>
      </div>
    </>
  );
}

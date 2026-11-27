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

// マスごとの小さな軌道。形=軌道(行)、長さ・太さ・色=強さ(列)。
// 文字を読む前に「どんな当たりか」が目に入るようにする。
//   弱い: 短く細い青 / 平凡: 中くらいの黄 / 強い: 長く太い赤
const CELL_GLYPH = {
  ground: {
    weak: 'M3,16 Q6,12 9,16 Q11,14 13,16',
    normal: 'M3,16 Q8,9 13,16 Q17,11 21,16 Q24,13 27,16',
    hard: 'M3,16 Q10,7 17,16 Q24,9 31,16 Q35,12 38,16',
  },
  liner: {
    weak: 'M3,13 Q9,9 15,15',
    normal: 'M3,15 L26,8',
    hard: 'M3,16 L38,5',
  },
  fly: {
    weak: 'M3,17 Q9,7 15,17',
    normal: 'M3,17 Q15,1 27,17',
    hard: 'M3,17 Q21,-7 38,13',
  },
};
const END = {
  ground: { weak: [13, 16], normal: [27, 16], hard: [38, 16] },
  liner: { weak: [15, 15], normal: [26, 8], hard: [38, 5] },
  fly: { weak: [15, 17], normal: [27, 17], hard: [38, 13] },
};
const STROKE = { weak: 1.5, normal: 2, hard: 2.7 };

function CellGlyph({ tr, c }) {
  const [x, y] = END[tr][c];
  return (
    <svg className="cpad-glyph" width="40" height="20" viewBox="0 0 40 20" aria-hidden="true">
      <path d={CELL_GLYPH[tr][c]} fill="none" stroke="currentColor" strokeWidth={STROKE[c]} strokeLinecap="round" />
      <circle cx={x} cy={y} r={c === 'hard' ? 2.6 : c === 'normal' ? 2.1 : 1.7} fill="currentColor" />
    </svg>
  );
}

// 列の見出し: 左が小さく右肩上がりに大きくなる三角。青→黄→赤のグラデーション
function StrengthWedge({ t }) {
  return (
    <div className="cpad-wedge">
      <svg viewBox="0 0 300 26" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="cpad-wedge-g" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#4dabf7" />
            <stop offset="0.5" stopColor="#fcc419" />
            <stop offset="1" stopColor="#ff6b6b" />
          </linearGradient>
        </defs>
        <polygon points="0,20 300,1 300,24 0,24" fill="url(#cpad-wedge-g)" />
      </svg>
      <div className="cpad-wedge-labels">
        {CONTACTS.map((c) => <span key={c} data-s={c}>{t(`contact.${c}`)}</span>)}
      </div>
    </div>
  );
}

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
        <StrengthWedge t={t} />
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
                  <CellGlyph tr={tr} c={c} />
                  <span>{t(`battedBall.${tr}.${c}`)}</span>
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

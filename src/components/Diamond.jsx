import React from 'react';
import { usePlayerName, useT } from '../state/store.jsx';

// 走者ダイヤモンド: TV中継風フィールドの上に塁を配置。
// 塁タップで走者イベントシートを開く。クラス名(.base.b1等)はE2E互換のため維持。
// mini=true: 打者行に横並びできる小型3塁ダイヤ(本塁は省略。本塁は実質操作しないため)。
export default function Diamond({ game, onBaseTap, mini = false }) {
  const nameOf = usePlayerName();
  const t = useT();

  const label = (base) => {
    const r = game.runners[base];
    if (!r) return mini ? '' : t(`base.${base}`);
    if (r.playerId) return nameOf(r.playerId);
    if (r.letter) return r.letter;
    return t('runner.fallback');
  };

  return (
    <div
      className={`field-diamond-crop${mini ? ' mini' : ''}`}
      // 小さいダイヤは塁そのものが指より小さい。図のどこを押しても走者に届くようにする
      // (見た目と大きさは変えない):
      //   ・走者がいる塁のマスを押したら、その塁
      //   ・それ以外の場所なら、押した位置にいちばん近い「走者がいる塁」。走者が1人ならどこでもその走者
      //   ・走者がいなければ、左=三塁 / 真ん中=二塁 / 右=一塁
      onClick={mini ? (e) => {
        const hit = e.target.closest?.('.base');
        const exact = hit && [1, 2, 3].find((b) => hit.classList.contains(`b${b}`));
        // 走者がいる塁のマスを押したらその塁。空いている塁のマスは、走者が誰もいないときだけ
        // (走者がいるのに空いた塁が開くと「押したのに走者が出ない」になる)
        if (exact && (game.runners[exact] || ![1, 2, 3].some((b) => game.runners[b]))) { onBaseTap?.(exact); return; }
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const occupied = [1, 2, 3].filter((b) => game.runners[b]);
        const POS_X = { 1: 0.82, 2: 0.5, 3: 0.18 };
        if (occupied.length) {
          const near = occupied.reduce((a, b) => (Math.abs(POS_X[b] - x) < Math.abs(POS_X[a] - x) ? b : a));
          onBaseTap?.(near);
        } else {
          onBaseTap?.(x < 0.36 ? 3 : x > 0.64 ? 1 : 2);
        }
      } : undefined}
      role={mini ? 'button' : undefined}
      aria-label={mini ? t('runner.diamondTap') : undefined}
    >
      <div className="field-diamond bf">
        <div className="bf-dirtfan" />
        <div className="bf-mound" />
        <div className="bf-line left" />
        <div className="bf-line right" />
        <div className="bf-basepath" />
        {[2, 3, 1].map((b) => (
          <div
            key={b}
            className={`base b${b}${game.runners[b] ? ' occupied' : ''}`}
            onClick={mini ? undefined : (e) => { e.stopPropagation(); onBaseTap?.(b); }}
            role="button"
          >
            <span>{label(b)}</span>
          </div>
        ))}
        {!mini && (
          <div className="base home">
            <span>{t('diamond.home')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

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
      // 小さいダイヤは塁そのものが指より小さい。図全体を3つに分けて、
      // 左=三塁 / 真ん中=二塁 / 右=一塁 として押せるようにする(見た目と大きさは変えない)
      onClick={mini ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        onBaseTap?.(x < 0.36 ? 3 : x > 0.64 ? 1 : 2);
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

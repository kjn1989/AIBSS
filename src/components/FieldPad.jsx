import React, { useRef } from 'react';
import { DIRECTIONS } from '../lib/model.js';
import { useT } from '../state/store.jsx';
import { padPointToBall, ballToPadPoint, nearestDirection, depthBand, POS_PCT } from '../lib/battedBall.js';

// 打球方向の選択を「TV中継風」の野球フィールドで行うパッド
// 市松模様の芝・白チョークのファウルライン・内野の土(ラインに沿う)・内野芝・
// マウンド・ベースを描き、守備位置に白チップのボタンを配置する。
// クラス名 .dir-pad を維持して既存のE2Eセレクタとも互換。
//
// フィールドのどこを押しても記録できる。角度で方向が、本塁からの距離で
// 深さが決まる。押した瞬間に一番近いチップが光るので、押し間違いはその場で見える。
// チップはちょうど「定位置」の距離に置いてあるので、今までどおりチップを
// 押した人は今までどおりの記録になる(深さも定位置として入る)。

// ベース(白い正方形)の座標: ファウルライン・土のひし形の角と一致
const BASE_MARKS = [
  { left: '50%', top: '43%' }, // 二塁
  { left: '23.3%', top: '72%' }, // 三塁
  { left: '76.7%', top: '72%' }, // 一塁
];

// 外野の3方向(本塁打は外野のみ選択可)
const OUTFIELD = ['LF', 'CF', 'RF'];

// 深さの目安の円弧(本塁を中心とした同心円)。直径はパッド幅に対する%で、
// battedBall.js の DEPTH_BANDS の境界(0.62/0.73/0.86/0.97)に対応する。
// 幅% = 境界 × フェンス距離0.93 × 2 × 100
const RINGS = [115, 136, 160, 180];

export default function FieldPad({ value, point, onChange, outfieldOnly = false }) {
  const t = useT();
  const ref = useRef(null);
  const keys = Object.keys(DIRECTIONS).filter((k) => (outfieldOnly ? OUTFIELD.includes(k) : true));

  const commit = (fx, fy) => {
    const b = padPointToBall(fx, fy);
    if (b.foul) return; // ファウルゾーンは記録しない
    const dir = nearestDirection(b.angle, b.depth);
    if (outfieldOnly && !OUTFIELD.includes(dir)) return;
    onChange(dir, { angle: b.angle, depth: b.depth });
  };

  const onPadClick = (e) => {
    if (e.target.closest('.field-pos')) return; // チップは自前で処理する
    const r = ref.current.getBoundingClientRect();
    commit((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  const marker = point && point.angle != null ? ballToPadPoint(point.angle, point.depth) : null;
  const band = point && point.depth != null ? depthBand(point.depth) : null;

  return (
    <>
      <div
        className="dir-pad field-pad bf"
        ref={ref}
        onClick={onPadClick}
        role="application"
        aria-label={t('playsheet.direction')}
      >
        <div className="bf-dirtfan" />
        {RINGS.map((d, i) => (
          <div key={d} className={`bf-ring${i === RINGS.length - 1 ? ' fence' : ''}`} style={{ width: `${d}%` }} />
        ))}
        <div className="bf-mound" />
        <div className="bf-line left" />
        <div className="bf-line right" />
        <div className="bf-basepath" />
        {BASE_MARKS.map((s, i) => (
          <div key={i} className="bf-base" style={s} />
        ))}
        {marker && (
          <div className="bf-mark" style={{ left: `${marker.fx * 100}%`, top: `${marker.fy * 100}%` }} />
        )}
        {keys.map((key) => (
          <button
            key={key}
            className={`field-pos${value === key ? ' sel' : ''}`}
            style={{ left: `${POS_PCT[key][0]}%`, top: `${POS_PCT[key][1]}%` }}
            onClick={() => commit(POS_PCT[key][0] / 100, POS_PCT[key][1] / 100)}
          >
            {t(`dir.${key}`)}
          </button>
        ))}
      </div>
      <div className="pad-readout">
        {value ? (
          <>
            <b>{t(`dir.${value}`)}</b>
            {band && <span className="depth-pill">{t(`depth.${band}`)}</span>}
          </>
        ) : (
          <span className="dim small">{t('playsheet.tapField')}</span>
        )}
      </div>
    </>
  );
}

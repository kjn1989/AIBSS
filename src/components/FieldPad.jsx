import React from 'react';
import { DIRECTIONS } from '../lib/model.js';
import { useT } from '../state/store.jsx';

// 打球方向の選択を「TV中継風」の野球フィールドで行うパッド
// 市松模様の芝・白チョークのファウルライン・内野の土(ラインに沿う)・内野芝・
// マウンド・ベースを描き、守備位置に白チップのボタンを配置する。
// クラス名 .dir-pad を維持して既存のE2Eセレクタとも互換。
const POSITIONS = {
  LF: { left: '18%', top: '27%' },
  CF: { left: '50%', top: '15%' },
  RF: { left: '82%', top: '27%' },
  '3B': { left: '20%', top: '61%' },
  SS: { left: '36%', top: '46%' },
  '2B': { left: '64%', top: '46%' },
  '1B': { left: '80%', top: '61%' },
  P: { left: '50%', top: '71%' },
  C: { left: '50%', top: '90%' },
};

// ベース(白い正方形)の座標: ファウルライン・土のひし形の角と一致
const BASE_MARKS = [
  { left: '50%', top: '43%' }, // 二塁
  { left: '23.3%', top: '72%' }, // 三塁
  { left: '76.7%', top: '72%' }, // 一塁
];

// 外野の3方向(本塁打は外野のみ選択可)
const OUTFIELD = ['LF', 'CF', 'RF'];

export default function FieldPad({ value, onChange, outfieldOnly = false }) {
  const t = useT();
  const keys = outfieldOnly ? Object.keys(DIRECTIONS).filter((k) => OUTFIELD.includes(k)) : Object.keys(DIRECTIONS);
  return (
    <div className="dir-pad field-pad bf">
      <div className="bf-dirtfan" />
      <div className="bf-mound" />
      <div className="bf-line left" />
      <div className="bf-line right" />
      <div className="bf-basepath" />
      {BASE_MARKS.map((s, i) => (
        <div key={i} className="bf-base" style={s} />
      ))}
      {keys.map((key) => (
        <button
          key={key}
          className={`field-pos${value === key ? ' sel' : ''}`}
          style={POSITIONS[key]}
          onClick={() => onChange(key)}
        >
          {t(`dir.${key}`)}
        </button>
      ))}
    </div>
  );
}

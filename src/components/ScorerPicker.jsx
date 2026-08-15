import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { scorersOf } from '../lib/scorers.js';
import { uid } from '../lib/model.js';

// ---- 記録員(スコアラー)を選ぶ ----
// 流れタグは記録員の読みそのものなので、誰が付けた試合かが分からないと
// 当たったのか外したのかを積み上げられない。試合ごとに1人置く。
// 名簿は選手と別に持つ(スコアラーは選手とは限らないし、選手として登録すると
// 打席が無いのに打者一覧に出てきてしまう)。
export default function ScorerPicker({ value, onChange, compact = false }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const list = scorersOf(state.settings);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const add = () => {
    const n = name.trim();
    if (!n) return;
    // 同じ名前が居ればそれを選ぶ(押すたびに同名が増えないように)
    const found = list.find((s) => s.name === n);
    const id = found ? found.id : uid();
    if (!found) dispatch({ type: 'ADD_SCORER', id, name: n });
    onChange(id);
    setName('');
    setAdding(false);
  };

  return (
    <div className="scorer-pick">
      <div className="flex">
        <select
          className="grow"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={t('scorer.label')}
        >
          <option value="">{t('scorer.none')}</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="button" className="small" onClick={() => setAdding(!adding)}>
          {adding ? t('action.cancel') : t('scorer.add')}
        </button>
      </div>
      {adding && (
        <div className="flex mt8">
          <input
            className="grow"
            value={name}
            placeholder={t('scorer.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button type="button" className="small primary" onClick={add} disabled={!name.trim()}>
            {t('action.add')}
          </button>
        </div>
      )}
      {!compact && <p className="small dim mt8">{t('scorer.note')}</p>}
    </div>
  );
}

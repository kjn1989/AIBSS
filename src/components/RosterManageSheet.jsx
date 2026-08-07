import React, { useState, useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import Sheet from './Sheet.jsx';
import {
  isArchived, tenureByPlayer, currentSchoolYear, DEFAULT_YEAR_START_MONTH,
  usesGrade, gradeOf, maxGradeOf, defaultSchoolType,
} from '../lib/year.js';

// ============================================================
// 選手をまとめて整理する(アーカイブ・削除)
//
// もとは名簿の各行に 📥 と 🗑 が並んでいた。この2つは毎日触るものではなく、
// 年に数回・卒業のときにまとめて触るものなので、常時出しておく価値がない。
// そのうえ削除は取り消せないのに、行の端で他のボタンと隣り合っていた。
//
// 行から外してこの画面に集約する。卒業は学年まるごと起きるので、
// 「3年をまとめて」で選んで一度に処理できる形にする。
// 「戻す」も同じ画面のタブに置く(アーカイブに関することが1か所に集まる)。
// ============================================================
export default function RosterManageSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [tab, setTab] = useState('active');
  const [sel, setSel] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);

  const thisYear = currentSchoolYear();
  const startMonth = state.settings.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  const gradeOn = usesGrade(state.settings.edition);
  const maxGrade = maxGradeOf(state.settings.schoolType || defaultSchoolType(state.settings.edition)) || 6;
  const tenure = useMemo(
    () => tenureByPlayer(Object.values(state.games), startMonth),
    [state.games, startMonth],
  );

  const active = useMemo(() => {
    const list = state.players.filter((p) => !isArchived(p));
    if (!gradeOn) return list;
    // 卒業する学年が上に来るように、学年の大きい順(未設定は最後)
    return [...list].sort((a, b) => {
      const ga = gradeOf(a, thisYear);
      const gb = gradeOf(b, thisYear);
      if (ga == null) return gb == null ? 0 : 1;
      if (gb == null) return -1;
      return gb - ga;
    });
  }, [state.players, gradeOn, thisYear]);
  const archived = useMemo(() => state.players.filter(isArchived), [state.players]);

  const rows = tab === 'active' ? active : archived;
  const ids = rows.map((p) => p.id);
  // タブを切り替えたときに、見えていない選手が選ばれたままにならないようにする
  const picked = ids.filter((id) => sel.has(id));
  const nPicked = picked.length;

  const toggle = (id) => setSel((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const switchTab = (next) => { setTab(next); setSel(new Set()); setConfirming(false); };

  // 学年ショートカット。もう選び終わっているならもう一度押して外せる
  const pickGrade = (g) => {
    const members = active.filter((p) => (g == null ? gradeOf(p, thisYear) == null : gradeOf(p, thisYear) === g));
    const allOn = members.length > 0 && members.every((p) => sel.has(p.id));
    setSel((prev) => {
      const next = new Set(prev);
      for (const p of members) { if (allOn) next.delete(p.id); else next.add(p.id); }
      return next;
    });
  };
  const grades = gradeOn
    ? Array.from({ length: maxGrade }, (_, i) => maxGrade - i)
      .filter((g) => active.some((p) => gradeOf(p, thisYear) === g))
    : [];
  const hasUnsetGrade = gradeOn && active.some((p) => gradeOf(p, thisYear) == null);

  const gamesOf = (p) => tenure.get(p.id)?.games || 0;
  const withRecords = picked.filter((id) => (tenure.get(id)?.games || 0) > 0);

  const doArchive = () => {
    dispatch({ type: 'ARCHIVE_PLAYERS', ids: picked, year: thisYear });
    setSel(new Set());
  };
  const doRestore = () => {
    dispatch({ type: 'UNARCHIVE_PLAYERS', ids: picked });
    setSel(new Set());
  };
  const doDelete = () => {
    // 1件ずつ消す(取り消しは最後の1人ぶんしか効かないので、先に確認を挟んである)
    for (const id of picked) dispatch({ type: 'DELETE_PLAYER', id });
    setSel(new Set());
    setConfirming(false);
  };

  // ---- 削除の確認。取り消せない操作なので、何が消えるかを名指しで見せる ----
  if (confirming) {
    const names = state.players.filter((p) => picked.includes(p.id));
    return (
      <Sheet title={t('manage.confirmTitle', { n: nPicked })} onClose={() => setConfirming(false)}>
        <p className="small" style={{ margin: '0 0 10px', color: 'var(--red)' }}>{t('manage.confirmBody')}</p>
        <div className="mg-confirm">
          {names.map((p) => (
            <div className="mg-confirm-row" key={p.id}>
              <b>{p.name}</b>
              <span className={gamesOf(p) > 0 ? 'has' : ''}>
                {gamesOf(p) > 0 ? t('archive.games', { n: gamesOf(p) }) : t('manage.noGames')}
              </span>
            </div>
          ))}
        </div>
        {withRecords.length > 0 && (
          <div className="warn-box mt8">{t('manage.confirmRecords', { n: withRecords.length })}</div>
        )}
        <div className="sheet-actions">
          <button className="ghost" onClick={() => setConfirming(false)}>{t('manage.cancel')}</button>
          <button className="danger" onClick={doDelete}>{t('manage.confirmDo')}</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('manage.title')} onClose={onClose}>
      <div className="lens-row" style={{ marginBottom: 10 }}>
        <button className={tab === 'active' ? 'on' : ''} onClick={() => switchTab('active')}>
          {t('manage.tabActive', { n: active.length })}
        </button>
        <button className={tab === 'archived' ? 'on' : ''} onClick={() => switchTab('archived')}>
          {t('manage.tabArchived', { n: archived.length })}
        </button>
      </div>
      <p className="small dim" style={{ margin: '0 0 10px' }}>
        {tab === 'active' ? t('archive.hint') : t('archive.desc')}
      </p>

      {tab === 'active' && (grades.length > 0 || hasUnsetGrade) && (
        <div className="mg-picks">
          {grades.map((g) => (
            <button key={g} className="mg-pick" onClick={() => pickGrade(g)}>
              {t('manage.pickGrade', { g: t('grade.nth', { n: g }) })}
            </button>
          ))}
          {hasUnsetGrade && (
            <button className="mg-pick" onClick={() => pickGrade(null)}>
              {t('manage.pickGrade', { g: t('grade.unsetShort') })}
            </button>
          )}
        </div>
      )}

      <div className="mg-list">
        {rows.map((p) => {
          const on = sel.has(p.id);
          const tn = tenure.get(p.id);
          const g = gradeOn ? gradeOf(p, thisYear) : null;
          return (
            <button
              key={p.id}
              className={`mg-row${on ? ' on' : ''}`}
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(p.id)}
            >
              <span className="mg-ck" aria-hidden="true">{on ? '✓' : ''}</span>
              <span className="mg-name">
                <b>{p.number ? `${p.number} ` : ''}{p.name}</b>
                <i>
                  {gradeOn && `${g == null ? t('grade.unsetShort') : t('grade.nth', { n: g })} ・ `}
                  {tn ? `${tn.from}–${tn.to} ・ ${t('archive.games', { n: tn.games })}` : t('manage.noGames')}
                </i>
              </span>
            </button>
          );
        })}
        {rows.length === 0 && (
          <div className="dim small">{tab === 'active' ? t('manage.emptyActive') : t('manage.emptyArchived')}</div>
        )}
      </div>

      {/* 選んでいる間だけ実行できる。閉じるは常に押せる位置に残す */}
      <div className="sheet-actions mg-bar">
        <button className="ghost close" onClick={onClose}>{t('action.close')}</button>
        <button className="primary go" disabled={nPicked === 0} onClick={tab === 'active' ? doArchive : doRestore}>
          {nPicked === 0
            ? t('manage.none')
            : t(tab === 'active' ? 'manage.archiveN' : 'manage.restoreN', { n: nPicked })}
        </button>
        <button className="danger del" disabled={nPicked === 0} onClick={() => setConfirming(true)}>
          {t('action.delete')}
        </button>
      </div>
    </Sheet>
  );
}

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
// 行から外してこの画面に集約する。選び方は「チェックしてから、下のどちらの
// ボタンを押すか決める」ではなく、行の中で操作そのものを選ぶ。1タップで
// 「誰を・どうするか」まで決まり、アーカイブする人と削除する人を同時に仕分けられる。
// 印を付けるだけなので、実際に動くのは下のボタンを押したとき(削除はさらに確認)。
// ============================================================
export default function RosterManageSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [tab, setTab] = useState('active');
  const [marks, setMarks] = useState(() => new Map()); // id -> 'a'(移す) | 'd'(消す)
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
  const idsOf = (list) => list.map((p) => p.id);
  const marked = (kind) => idsOf(rows).filter((id) => marks.get(id) === kind);
  const nMove = marked('a').length;   // アーカイブする / 名簿に戻す
  const nDelete = marked('d').length;

  const setMark = (ids, kind) => setMarks((prev) => {
    const next = new Map(prev);
    // すでに全員その印なら外す(同じボタンで付け外しできる)
    const allOn = ids.length > 0 && ids.every((id) => next.get(id) === kind);
    for (const id of ids) { if (allOn) next.delete(id); else next.set(id, kind); }
    return next;
  });
  const switchTab = (next) => { setTab(next); setMarks(new Map()); setConfirming(false); };

  // ---- まとめて。全員と、学年ごと ----
  const groups = useMemo(() => {
    const list = [{ key: 'all', label: t('manage.all'), members: rows }];
    if (tab === 'active' && gradeOn) {
      for (let g = maxGrade; g >= 1; g--) {
        const members = rows.filter((p) => gradeOf(p, thisYear) === g);
        if (members.length) list.push({ key: `g${g}`, label: t('grade.nth', { n: g }), members });
      }
      const unset = rows.filter((p) => gradeOf(p, thisYear) == null);
      if (unset.length) list.push({ key: 'none', label: t('grade.unsetShort'), members: unset });
    }
    return list.filter((x) => x.members.length > 0);
  }, [rows, tab, gradeOn, maxGrade, thisYear, t]);

  const gamesOf = (id) => tenure.get(id)?.games || 0;

  const runMove = () => {
    const ids = marked('a');
    if (!ids.length) return;
    dispatch(tab === 'active'
      ? { type: 'ARCHIVE_PLAYERS', ids, year: thisYear }
      : { type: 'UNARCHIVE_PLAYERS', ids });
    setMarks((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };
  const runDelete = () => {
    // 1件ずつ消す(取り消しは最後の1人ぶんしか効かないので、先に確認を挟んである)
    for (const id of marked('d')) dispatch({ type: 'DELETE_PLAYER', id });
    setMarks(new Map());
    setConfirming(false);
  };

  const actMove = tab === 'active' ? t('manage.actArchive') : t('manage.actRestore');

  // 選手の行も「まとめて」の行も、まったく同じ形にする(覚えることを1つにする)。
  // 塗りつぶさず色文字だけにして、押したときに塗る。どちらの操作かは色で分かる
  const Chips = ({ ids, big }) => {
    const all = (kind) => ids.length > 0 && ids.every((id) => marks.get(id) === kind);
    return (
      <>
        <button
          type="button"
          className={`mg-act move${all('a') ? ' on' : ''}${big ? ' big' : ''}`}
          aria-pressed={all('a')}
          onClick={() => setMark(ids, 'a')}
        >
          {actMove}
        </button>
        <button
          type="button"
          className={`mg-act del${all('d') ? ' on' : ''}${big ? ' big' : ''}`}
          aria-pressed={all('d')}
          onClick={() => setMark(ids, 'd')}
        >
          {t('action.delete')}
        </button>
      </>
    );
  };

  // ---- 削除の確認。取り消せない操作なので、何が消えるかを名指しで見せる ----
  if (confirming) {
    const ids = marked('d');
    const names = state.players.filter((p) => ids.includes(p.id));
    const withRecords = ids.filter((id) => gamesOf(id) > 0);
    return (
      <Sheet title={t('manage.confirmTitle', { n: ids.length })} onClose={() => setConfirming(false)}>
        <p className="small" style={{ margin: '0 0 10px', color: 'var(--red)' }}>{t('manage.confirmBody')}</p>
        <div className="mg-confirm">
          {names.map((p) => (
            <div className="mg-confirm-row" key={p.id}>
              <b>{p.name}</b>
              <span className={gamesOf(p.id) > 0 ? 'has' : ''}>
                {gamesOf(p.id) > 0 ? t('archive.games', { n: gamesOf(p.id) }) : t('manage.noGames')}
              </span>
            </div>
          ))}
        </div>
        {withRecords.length > 0 && (
          <div className="warn-box mt8">{t('manage.confirmRecords', { n: withRecords.length })}</div>
        )}
        <div className="sheet-actions">
          <button className="ghost" onClick={() => setConfirming(false)}>{t('manage.cancel')}</button>
          <button className="danger" onClick={runDelete}>{t('manage.confirmDo')}</button>
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

      <div className="mg-list">
        {rows.map((p) => {
          const mk = marks.get(p.id);
          const tn = tenure.get(p.id);
          const g = gradeOn ? gradeOf(p, thisYear) : null;
          return (
            <div className={`mg-row${mk === 'a' ? ' m-move' : mk === 'd' ? ' m-del' : ''}`} key={p.id}>
              <span className="mg-name">
                <b>{p.number ? `${p.number} ` : ''}{p.name}</b>
                <i>
                  {gradeOn && `${g == null ? t('grade.unsetShort') : t('grade.nth', { n: g })} ・ `}
                  {tn ? `${tn.from}–${tn.to} ・ ${t('archive.games', { n: tn.games })}` : t('manage.noGames')}
                </i>
              </span>
              <Chips ids={[p.id]} />
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="dim small">{tab === 'active' ? t('manage.emptyActive') : t('manage.emptyArchived')}</div>
        )}
      </div>

      {/* 印を付けただけでは何も起きない。ここを押して初めて動く(削除はさらに確認) */}
      <div className="sheet-actions mg-bar">
        <button className="ghost close" onClick={onClose}>{t('action.close')}</button>
        <button className="primary go" disabled={nMove === 0} onClick={runMove}>
          {nMove === 0
            ? actMove
            : t(tab === 'active' ? 'manage.archiveN' : 'manage.restoreN', { n: nMove })}
        </button>
        <button className="danger del" disabled={nDelete === 0} onClick={() => setConfirming(true)}>
          {nDelete === 0 ? t('action.delete') : t('manage.deleteN', { n: nDelete })}
        </button>
      </div>

      {/* まとめて。行とまったく同じ形にして、対象が「1人」か「学年ぜんぶ」かだけを変える */}
      {rows.length > 0 && (
        <div className="mg-bulk">
          <div className="mg-bulk-h">{t('manage.bulkHead')}</div>
          {groups.map((gr) => (
            <div className="mg-row bulk" key={gr.key}>
              <span className="mg-name">
                <b>{gr.label}</b>
                <i>{t('manage.groupN', { n: gr.members.length })}</i>
              </span>
              <Chips ids={idsOf(gr.members)} big />
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

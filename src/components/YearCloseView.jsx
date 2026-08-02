import React, { useState, useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import {
  isArchived, tenureByPlayer, gradeOf, willGraduate, maxGradeOf, usesGrade,
  defaultSchoolType, yearLabel, DEFAULT_YEAR_START_MONTH,
} from '../lib/year.js';
import { buildYearArchive, yearSummary, gamesInYear, archiveFileName } from '../lib/yearArchive.js';
import { atBatCSV, downloadCSV } from '../lib/csv.js';

// ============================================================
// 年度を締める
//
// 卒業・退部のフラグを立てる場所を「年に一度必ず通る所」に固定する。
// 設定画面のどこかに置くと付け忘れるため。
// 3段: 抜けた選手を選ぶ → 書き出す → 完了。
//
// アーカイブは削除ではない。記録はすべて残り、通算成績にも入り続ける。
// ============================================================
export default function YearCloseView({ year, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const startMonth = state.settings.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  const gradeOn = usesGrade(state.settings.edition);
  const maxGrade = maxGradeOf(state.settings.schoolType || defaultSchoolType(state.settings.edition));

  const active = state.players.filter((p) => !isArchived(p));
  const tenure = useMemo(() => tenureByPlayer(Object.values(state.games), startMonth), [state.games, startMonth]);
  const summary = useMemo(() => yearSummary(state.games, year, startMonth), [state.games, year, startMonth]);
  const gameCount = summary.games;

  // 卒業予定は最初から選んでおく。学年があれば確実に判定できる
  const [picked, setPicked] = useState(() => {
    const s = new Set();
    if (gradeOn && maxGrade) for (const p of active) if (willGraduate(p, year, maxGrade)) s.add(p.id);
    return s;
  });
  const [notes, setNotes] = useState({}); // playerId -> '卒業' | '退部' | '移籍'
  const [step, setStep] = useState(1);
  const [exported, setExported] = useState(false);

  const toggle = (id) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // その年度に1試合も出ていない選手は別枠に出す。抜けた人はここに現れる。
  // ただし怪我での長期離脱と区別できないので、既定では選ばない。
  const playedThisYear = new Set();
  for (const g of gamesInYear(state.games, year, startMonth)) {
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      for (const id of [p.playerId, p.in, p.out, p.pitcherId]) if (id) playedThisYear.add(id);
    }
  }
  const graduating = active.filter((p) => gradeOn && maxGrade && willGraduate(p, year, maxGrade));
  const gradIds = new Set(graduating.map((p) => p.id));
  const absent = active.filter((p) => !gradIds.has(p.id) && !playedThisYear.has(p.id));
  const staying = active.filter((p) => !gradIds.has(p.id) && playedThisYear.has(p.id));

  const doExport = (kind) => {
    if (kind === 'json' || kind === 'both') {
      const data = buildYearArchive(state, year);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = archiveFileName(year, 'archive.json');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (kind === 'csv' || kind === 'both') {
      const nameOf = (id) => state.players.find((p) => p.id === id)?.name || id;
      downloadCSV(archiveFileName(year, 'atbats.csv'), atBatCSV(gamesInYear(state.games, year, startMonth), nameOf));
    }
    setExported(true);
  };

  const commit = () => {
    const ids = [...picked];
    if (ids.length) {
      // 理由ごとにまとめて適用する(理由は表示にしか使わないので粗くてよい)
      const byNote = new Map();
      for (const id of ids) {
        const note = notes[id] || (gradIds.has(id) ? t('role.grad') : t('role.left'));
        if (!byNote.has(note)) byNote.set(note, []);
        byNote.get(note).push(id);
      }
      for (const [note, group] of byNote) {
        dispatch({ type: 'ARCHIVE_PLAYERS', ids: group, year, note });
      }
    }
    dispatch({ type: 'UPDATE_SETTINGS', patch: { lastClosedYear: year } });
    setStep(3);
  };

  const row = (p, checked, auto) => {
    const tn = tenure.get(p.id);
    const g = gradeOn ? gradeOf(p, year) : null;
    return (
      <div className="yc-row" key={p.id} role="button" onClick={() => toggle(p.id)}>
        <span className={`yc-chk${checked ? ' on' : ''}`} aria-hidden="true" />
        <span className="yc-name">
          <b>{p.name}</b>
          <i>
            {g != null && `${t('grade.nth', { n: g })} ・ `}
            {tn ? `${tn.from}–${tn.to} ・ ${t('archive.games', { n: tn.games })}` : t('yc.noGames')}
          </i>
        </span>
        {checked && (
          <select
            value={notes[p.id] || (auto ? t('role.grad') : t('role.left'))}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
          >
            {[t('role.grad'), t('role.left'), t('role.moved')].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet yc-card">
        <div className="yc-head">
          <button className="small ghost" onClick={onClose}>‹ {t('action.close')}</button>
          <span className="yc-step">{step} / 3</span>
        </div>

        {step === 1 && (
          <>
            <h2>{t('yc.title', { year: yearLabel(year, lang, startMonth) })}</h2>
            <h3 className="yc-sub">{t('yc.step1')}</h3>
            <p className="small dim">{t('yc.step1Desc')}</p>

            {graduating.length > 0 && (
              <div className="yc-auto">
                <b>{t('yc.autoTitle', { n: graduating.length, grade: maxGrade })}</b>
                <span>{t('yc.autoDesc', { year: year + 1 })}</span>
              </div>
            )}
            {graduating.map((p) => row(p, picked.has(p.id), true))}

            {absent.length > 0 && (
              <>
                <div className="section-title">{t('yc.absent')}</div>
                {absent.map((p) => row(p, picked.has(p.id), false))}
              </>
            )}

            {staying.length > 0 && (
              <>
                <div className="section-title">{t('yc.staying', { year: year + 1 })}</div>
                {staying.map((p) => row(p, picked.has(p.id), false))}
              </>
            )}

            <p className="foot-note">{t('yc.step1Note')}</p>
            <button className="primary wide mt12" onClick={() => setStep(2)}>
              {t('yc.next', { n: picked.size })}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>{t('yc.step2')}</h2>
            <p className="small dim">{t('yc.step2Desc')}</p>
            <div className="yc-file">
              <i>📄</i>
              <span><b>{archiveFileName(year, 'archive.json')}</b><small>{t('yc.jsonDesc')}</small></span>
            </div>
            <div className="yc-file">
              <i>📊</i>
              <span><b>{archiveFileName(year, 'atbats.csv')}</b><small>{t('yc.csvDesc')}</small></span>
            </div>
            <p className="foot-note">{t('yc.docNote')}</p>
            <div className="flex mt12">
              <button className="primary grow" onClick={() => doExport('both')}>{t('yc.exportBoth')}</button>
              <button className="grow" onClick={commit}>{exported ? t('yc.next2') : t('yc.later')}</button>
            </div>
            {exported && <p className="foot-note" style={{ color: 'var(--green)' }}>{t('yc.exported')}</p>}
          </>
        )}

        {step === 3 && (
          <>
            <h2>{t('yc.done', { year: yearLabel(year, lang, startMonth) })}</h2>
            <div className="yc-sum">
              <div><b>{gameCount}</b><span>{t('yc.games')}</span></div>
              <div><b>{summary.win}-{summary.lose}{summary.draw ? `-${summary.draw}` : ''}</b><span>{t('yc.record')}</span></div>
              <div><b>{picked.size}</b><span>{t('yc.archived')}</span></div>
            </div>
            {/* アーカイブ適用後に再計算された人数をそのまま使う。
                ここで picked を引くと二重に減る(適用前の人数だと思い込んだのが原因) */}
            <p className="small dim">
              {t('yc.doneDesc', { active: active.length, year: year + 1 })}
            </p>
            <button className="primary wide mt12" onClick={onClose}>{t('action.close')}</button>
          </>
        )}
      </div>
    </div>
  );
}

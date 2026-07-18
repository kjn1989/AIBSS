import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildTemplateCsv, parseGameCsv, mergeCompletion, ipToOuts } from '../lib/importCsv.js';
import { completeBoxScore } from '../lib/gemini.js';
import { downloadCSV } from '../lib/csv.js';
import { POSITIONS, formatIP, positionLabel } from '../lib/model.js';
import FullscreenView from './FullscreenView.jsx';
import Sheet from './Sheet.jsx';

const BAT_POSITIONS = POSITIONS.filter((p) => p !== '打' && p !== '控');
const numOrUndef = (s) => {
  if (s === '') return undefined;
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? n : undefined;
};

function newBlankBatter() {
  return { name: '', number: '', position: '', pa: undefined, ab: undefined, h: undefined, double: undefined, triple: undefined, hr: undefined, rbi: undefined, bb: undefined, hbp: undefined, so: undefined, sacBunt: undefined, sb: undefined, runs: undefined, memo: '' };
}
function newBlankPitcher() {
  return { name: '', outsRecorded: undefined, runs: undefined, earnedRuns: undefined, hitsAllowed: undefined, walks: undefined, hitByPitch: undefined, strikeouts: undefined, pitches: undefined, abFaced: undefined, win: false, save: false, hold: false, memo: '' };
}

// ---- 打者1人分の編集シート ----
function BatterEditSheet({ batter, onSave, onDelete, onClose }) {
  const t = useT();
  const { state } = useStore();
  const lang = state.settings.lang || 'ja';
  const [b, setB] = useState(batter);
  const set = (k) => (e) => setB({ ...b, [k]: e.target.value });
  const setNum = (k) => (e) => setB({ ...b, [k]: numOrUndef(e.target.value) });
  const NUM_FIELDS = ['pa', 'ab', 'h', 'double', 'triple', 'hr', 'rbi', 'bb', 'hbp', 'so', 'sacBunt', 'sb', 'runs'];
  return (
    <Sheet title={t('ics.editBatter')} onClose={onClose}>
      <label className="small dim">{t('ics.name')}</label>
      <input value={b.name || ''} onChange={set('name')} placeholder={t('set.playerName')} />
      <div className="grid2 mt8">
        <div>
          <label className="small dim">{t('set.number')}</label>
          <input value={b.number || ''} onChange={set('number')} />
        </div>
        <div>
          <label className="small dim">{t('order.sub.position')}</label>
          <select value={b.position || ''} onChange={set('position')}>
            <option value="">{t('ics.unknown')}</option>
            {BAT_POSITIONS.map((p) => <option key={p} value={p}>{positionLabel(p, lang)}</option>)}
          </select>
        </div>
      </div>
      <div className="section-title small mt8">{t('ics.statsOptional')}</div>
      <div className="grid3">
        {NUM_FIELDS.map((k) => (
          <div key={k}>
            <label className="small dim">{t(`ics.f.${k}`)}</label>
            <input type="number" inputMode="numeric" value={b[k] ?? ''} onChange={setNum(k)} />
          </div>
        ))}
      </div>
      <label className="small dim mt8" style={{ display: 'block' }}>{t('ics.memo')}</label>
      <textarea rows={3} value={b.memo || ''} onChange={set('memo')} />
      <div className="sheet-actions">
        <button className="ghost danger" onClick={onDelete}>{t('ics.deleteRow')}</button>
        <button className="primary" disabled={!b.name.trim()} onClick={() => onSave(b)}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

// ---- 投手1人分の編集シート ----
function PitcherEditSheet({ pitcher, onSave, onDelete, onClose }) {
  const t = useT();
  const [p, setP] = useState({ ...pitcher, ipText: pitcher.outsRecorded != null ? formatIP(pitcher.outsRecorded) : '' });
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const setNum = (k) => (e) => setP({ ...p, [k]: numOrUndef(e.target.value) });
  const toggle = (k) => () => setP({ ...p, [k]: !p[k] });
  const NUM_FIELDS = ['runs', 'earnedRuns', 'hitsAllowed', 'walks', 'hitByPitch', 'strikeouts', 'pitches', 'abFaced'];
  const save = () => {
    const { ipText, ...rest } = p;
    onSave({ ...rest, outsRecorded: ipToOuts(ipText) });
  };
  return (
    <Sheet title={t('ics.editPitcher')} onClose={onClose}>
      <label className="small dim">{t('ics.name')}</label>
      <input value={p.name || ''} onChange={set('name')} placeholder={t('set.playerName')} />
      <label className="small dim mt8" style={{ display: 'block' }}>{t('ics.ipLabel')}</label>
      <input value={p.ipText || ''} onChange={set('ipText')} placeholder={t('ics.ipPlaceholder')} />
      <div className="section-title small mt8">{t('ics.statsOptional')}</div>
      <div className="grid3">
        {NUM_FIELDS.map((k) => (
          <div key={k}>
            <label className="small dim">{t(`ics.pf.${k}`)}</label>
            <input type="number" inputMode="numeric" value={p[k] ?? ''} onChange={setNum(k)} />
          </div>
        ))}
      </div>
      <div className="grid3 mt8">
        {['win', 'save', 'hold'].map((k) => (
          <button key={k} className={p[k] ? 'primary' : ''} onClick={toggle(k)}>{t(`ics.${k}`)}</button>
        ))}
      </div>
      <label className="small dim mt8" style={{ display: 'block' }}>{t('ics.memo')}</label>
      <textarea rows={3} value={p.memo || ''} onChange={set('memo')} />
      <div className="sheet-actions">
        <button className="ghost danger" onClick={onDelete}>{t('ics.deleteRow')}</button>
        <button className="primary" disabled={!p.name.trim()} onClick={save}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

// 指定フォーマットCSVからボックススコア＋線スコアを取り込む
export default function ImportCsvView({ onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const myTeam = state.settings.teamName || t('restab.teamFallback');
  const apiKey = state.settings.geminiApiKey;
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completeNote, setCompleteNote] = useState(null); // { ok, filledCount } | { ok:false, error }
  const [editBatterIdx, setEditBatterIdx] = useState(null); // number | 'new' | null
  const [editPitcherIdx, setEditPitcherIdx] = useState(null);

  // downloadCSV()はUTF-8 BOM付きでダウンロードする(BOM無しだとExcelがShift-JIS等と誤認して文字化けするため)
  const downloadTemplate = () => downloadCSV('aibss-import-template.csv', buildTemplateCsv(myTeam));

  const onFile = (file) => {
    setError('');
    setParsed(null);
    setCompleteNote(null);
    const reader = new FileReader();
    reader.onload = () => {
      const r = parseGameCsv(reader.result);
      if (!r.ok) { setError(r.error); return; }
      setParsed(r);
    };
    reader.onerror = () => setError(t('ics.readError'));
    reader.readAsText(file, 'utf-8');
  };

  const hasMemo = !!(parsed && (parsed.meta.memo || parsed.batters.some((b) => b.memo) || parsed.pitchers.some((p) => p.memo)));

  const runCompletion = async () => {
    setCompleteNote(null);
    setCompleting(true);
    const r = await completeBoxScore({ apiKey, meta: parsed.meta, linescore: parsed.linescore, batters: parsed.batters, pitchers: parsed.pitchers });
    setCompleting(false);
    if (!r) {
      setCompleteNote({ ok: false, error: t('ics.completeOffline') });
      return;
    }
    if (r.error) {
      setCompleteNote({ ok: false, error: r.error });
      return;
    }
    const merged = mergeCompletion(parsed, r);
    setParsed({ ...parsed, batters: merged.batters, pitchers: merged.pitchers });
    setCompleteNote({ ok: true, filledCount: merged.filledCount });
  };

  const updateMeta = (patch) => setParsed({ ...parsed, meta: { ...parsed.meta, ...patch } });

  const lsKeys = parsed ? Object.keys(parsed.linescore).sort((a, b) => Number(a) - Number(b)) : [];
  let myScore = 0, oppScore = 0;
  if (parsed) {
    if (lsKeys.length) for (const k of lsKeys) { myScore += parsed.linescore[k].my; oppScore += parsed.linescore[k].opp; }
    else if (parsed.meta.myScore != null || parsed.meta.oppScore != null) { myScore = parsed.meta.myScore || 0; oppScore = parsed.meta.oppScore || 0; }
    else myScore = parsed.batters.reduce((s, b) => s + (b.runs || 0), 0);
  }

  const updateLinescoreCell = (inning, team, value) => {
    const n = value === '' ? 0 : Math.max(0, Math.round(Number(value)) || 0);
    setParsed({ ...parsed, linescore: { ...parsed.linescore, [inning]: { ...parsed.linescore[inning], [team]: n } } });
  };

  const saveBatter = (idx, b) => {
    const batters = [...parsed.batters];
    const { aiFilled, aiFieldCount, ...clean } = b;
    if (idx === 'new') batters.push(clean);
    else batters[idx] = clean;
    setParsed({ ...parsed, batters });
    setEditBatterIdx(null);
  };
  const deleteBatter = (idx) => {
    if (idx === 'new') { setEditBatterIdx(null); return; }
    setParsed({ ...parsed, batters: parsed.batters.filter((_, i) => i !== idx) });
    setEditBatterIdx(null);
  };
  const savePitcher = (idx, p) => {
    const pitchers = [...parsed.pitchers];
    const { aiFilled, aiFieldCount, ...clean } = p;
    if (idx === 'new') pitchers.push(clean);
    else pitchers[idx] = clean;
    setParsed({ ...parsed, pitchers });
    setEditPitcherIdx(null);
  };
  const deletePitcher = (idx) => {
    if (idx === 'new') { setEditPitcherIdx(null); return; }
    setParsed({ ...parsed, pitchers: parsed.pitchers.filter((_, i) => i !== idx) });
    setEditPitcherIdx(null);
  };

  const doImport = () => {
    // aiFilled/aiFieldCountはUI表示専用のフラグなので、保存前に取り除く
    const payload = {
      ...parsed,
      batters: parsed.batters.map(({ aiFilled, aiFieldCount, ...b }) => b),
      pitchers: parsed.pitchers.map(({ aiFilled, aiFieldCount, ...p }) => p),
    };
    dispatch({ type: 'IMPORT_BOX_GAME', payload });
    window.alert(t('ics.importDone', { team: myTeam, my: myScore, opp: oppScore, opponent: parsed.meta.opponent || t('ics.oppFallback') }));
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('action.back')}</button>
        <h2>{t('ics.title')}</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="card">
          <h2>{t('ics.howto')}</h2>
          <p className="small dim" style={{ marginBottom: 10, lineHeight: 1.7 }}>
            {t('ics.howtoDesc')}
          </p>
          <button onClick={downloadTemplate} style={{ width: '100%', marginBottom: 8 }}>{t('ics.downloadTemplate')}</button>
          <label className="file-btn" style={{ display: 'block', textAlign: 'center' }}>
            {t('ics.uploadCsv')}
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </label>
          {error && <div className="warn-box mt8">⚠️ {error}</div>}
        </div>

        {parsed && (
          <div className="card">
            <h2>{t('ics.reviewTitle')}</h2>
            <p className="small dim" style={{ marginBottom: 10 }}>{t('ics.reviewHint')}</p>

            <div className="grid2">
              <div>
                <label className="small dim">{t('gamesetup.opponent')}</label>
                <input value={parsed.meta.opponent || ''} onChange={(e) => updateMeta({ opponent: e.target.value })} />
              </div>
              <div>
                <label className="small dim">{t('restab.date')}</label>
                <input value={parsed.meta.date || ''} onChange={(e) => updateMeta({ date: e.target.value })} placeholder="YYYY-MM-DD" />
              </div>
            </div>
            <div className="grid2 mt8">
              <div>
                <label className="small dim">{t('ics.firstSecond')}</label>
                <div className="toggle-row">
                  <button className={!parsed.meta.isHome ? 'active' : ''} onClick={() => updateMeta({ isHome: false })}>{t('gamesetup.first')}</button>
                  <button className={parsed.meta.isHome ? 'active' : ''} onClick={() => updateMeta({ isHome: true })}>{t('gamesetup.second')}</button>
                </div>
              </div>
              <div>
                <label className="small dim">{t('ics.season')}</label>
                <input value={parsed.meta.season || ''} onChange={(e) => updateMeta({ season: e.target.value })} />
              </div>
            </div>

            <div className="hl-score" style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 10, margin: '12px 0' }}>
              <div className="hl-final" style={{ fontSize: 28 }}>{myTeam} {myScore} - {oppScore} {parsed.meta.opponent || t('ics.oppFallback')}</div>
            </div>

            {parsed.meta.memo && (
              <div className="warn-box" style={{ marginBottom: 12, borderColor: 'var(--accent-2)', color: 'var(--text)' }}>
                {t('ics.gameMemo', { memo: parsed.meta.memo })}
              </div>
            )}

            {hasMemo && (
              <div className="mt8" style={{ marginBottom: 12 }}>
                <button onClick={runCompletion} disabled={!apiKey || completing} style={{ width: '100%' }}>
                  {completing ? t('ics.completing') : t('ics.completeBtn')}
                </button>
                {!apiKey && <p className="small dim mt8">{t('ics.noApiKey')}</p>}
                {completeNote?.ok && (
                  <p className="small mt8" style={{ color: 'var(--green)' }}>
                    {t('ics.completedNote', { n: completeNote.filledCount })}
                  </p>
                )}
                {completeNote && !completeNote.ok && (
                  <p className="small mt8" style={{ color: 'var(--amber)' }}>{t('ics.completeFail', { error: completeNote.error })}</p>
                )}
              </div>
            )}

            {lsKeys.length > 0 && (
              <>
                <div className="section-title small">{t('ics.linescore')}</div>
                <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                  <table className="linescore-table">
                    <thead><tr><th></th>{lsKeys.map((k) => <th key={k}>{k}</th>)}<th>{t('gp.total')}</th></tr></thead>
                    <tbody>
                      <tr>
                        <td className="team">{myTeam}</td>
                        {lsKeys.map((k) => (
                          <td key={k} className="num">
                            <input
                              type="number" inputMode="numeric"
                              style={{ width: 40, textAlign: 'center', padding: '4px 2px' }}
                              value={parsed.linescore[k].my}
                              onChange={(e) => updateLinescoreCell(k, 'my', e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="num">{myScore}</td>
                      </tr>
                      <tr>
                        <td className="team">{parsed.meta.opponent || t('ics.oppFallback')}</td>
                        {lsKeys.map((k) => (
                          <td key={k} className="num">
                            <input
                              type="number" inputMode="numeric"
                              style={{ width: 40, textAlign: 'center', padding: '4px 2px' }}
                              value={parsed.linescore[k].opp}
                              onChange={(e) => updateLinescoreCell(k, 'opp', e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="num">{oppScore}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="section-title small">{t('ics.battersN', { n: parsed.batters.length })}</div>
            {parsed.batters.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {parsed.batters.map((b, i) => (
                  <div className="row" key={i} role="button" onClick={() => setEditBatterIdx(i)}>
                    <div className="grow">
                      <div>
                        {b.aiFilled && '🤖 '}<b>{b.name || t('ics.noName')}</b>
                        {b.position && <span className="pill" style={{ marginLeft: 6 }}>{positionLabel(b.position, state.settings.lang || 'ja')}</span>}
                        <span className="dim small" style={{ marginLeft: 8 }}>
                          {b.h ?? 0}{t('ics.hitsUnit')}{b.hr ? ` ${b.hr}${t('ics.hrUnit')}` : ''}{b.rbi ? ` ${b.rbi}${t('ics.rbiUnit')}` : ''}
                        </span>
                      </div>
                      {b.memo && <div className="dim small" style={{ marginTop: 2 }}>{b.memo}</div>}
                    </div>
                    <span className="dim">›</span>
                  </div>
                ))}
              </div>
            )}
            <button className="small" onClick={() => setEditBatterIdx('new')}>{t('ics.addBatter')}</button>

            <div className="section-title small mt12">{t('ics.pitchersN', { n: parsed.pitchers.length })}</div>
            {parsed.pitchers.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {parsed.pitchers.map((p, i) => (
                  <div className="row" key={i} role="button" onClick={() => setEditPitcherIdx(i)}>
                    <div className="grow">
                      <div>
                        {p.aiFilled && '🤖 '}<b>{p.name || t('ics.noName')}</b>
                        <span className="dim small" style={{ marginLeft: 8 }}>
                          {p.outsRecorded != null ? t('ics.ipSuffix', { ip: formatIP(p.outsRecorded) }) : t('ics.ipUnknown')}
                          {p.earnedRuns != null ? t('ics.erSuffix', { er: p.earnedRuns }) : ''}
                        </span>
                      </div>
                      {p.memo && <div className="dim small" style={{ marginTop: 2 }}>{p.memo}</div>}
                    </div>
                    <span className="dim">›</span>
                  </div>
                ))}
              </div>
            )}
            <button className="small" onClick={() => setEditPitcherIdx('new')}>{t('ics.addPitcher')}</button>

            <p className="small dim mt12">{t('ics.mergeNote')}</p>
            <button className="primary mt12" style={{ width: '100%' }} onClick={doImport}>{t('ics.importBtn')}</button>
          </div>
        )}
      </div>

      {editBatterIdx !== null && (
        <BatterEditSheet
          batter={editBatterIdx === 'new' ? newBlankBatter() : parsed.batters[editBatterIdx]}
          onSave={(b) => saveBatter(editBatterIdx, b)}
          onDelete={() => deleteBatter(editBatterIdx)}
          onClose={() => setEditBatterIdx(null)}
        />
      )}
      {editPitcherIdx !== null && (
        <PitcherEditSheet
          pitcher={editPitcherIdx === 'new' ? newBlankPitcher() : parsed.pitchers[editPitcherIdx]}
          onSave={(p) => savePitcher(editPitcherIdx, p)}
          onDelete={() => deletePitcher(editPitcherIdx)}
          onClose={() => setEditPitcherIdx(null)}
        />
      )}
    </FullscreenView>
  );
}

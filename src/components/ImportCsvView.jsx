import React, { useState } from 'react';
import { useStore } from '../state/store.jsx';
import { buildTemplateCsv, parseGameCsv, mergeCompletion, ipToOuts } from '../lib/importCsv.js';
import { completeBoxScore } from '../lib/gemini.js';
import { downloadCSV } from '../lib/csv.js';
import { POSITIONS, formatIP } from '../lib/model.js';
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
  const [b, setB] = useState(batter);
  const set = (k) => (e) => setB({ ...b, [k]: e.target.value });
  const setNum = (k) => (e) => setB({ ...b, [k]: numOrUndef(e.target.value) });
  const NUM_FIELDS = [
    ['pa', '打席'], ['ab', '打数'], ['h', '安打'], ['double', '二塁打'], ['triple', '三塁打'], ['hr', '本塁打'],
    ['rbi', '打点'], ['bb', '四球'], ['hbp', '死球'], ['so', '三振'], ['sacBunt', '犠打'], ['sb', '盗塁'], ['runs', '得点'],
  ];
  return (
    <Sheet title="打者を編集" onClose={onClose}>
      <label className="small dim">名前</label>
      <input value={b.name || ''} onChange={set('name')} placeholder="選手名" />
      <div className="grid2 mt8">
        <div>
          <label className="small dim">背番号</label>
          <input value={b.number || ''} onChange={set('number')} />
        </div>
        <div>
          <label className="small dim">守備位置</label>
          <select value={b.position || ''} onChange={set('position')}>
            <option value="">(不明)</option>
            {BAT_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="section-title small mt8">成績(空欄可)</div>
      <div className="grid3">
        {NUM_FIELDS.map(([k, label]) => (
          <div key={k}>
            <label className="small dim">{label}</label>
            <input type="number" inputMode="numeric" value={b[k] ?? ''} onChange={setNum(k)} />
          </div>
        ))}
      </div>
      <label className="small dim mt8" style={{ display: 'block' }}>メモ</label>
      <textarea rows={3} value={b.memo || ''} onChange={set('memo')} />
      <div className="sheet-actions">
        <button className="ghost danger" onClick={onDelete}>この行を削除</button>
        <button className="primary" disabled={!b.name.trim()} onClick={() => onSave(b)}>保存</button>
      </div>
    </Sheet>
  );
}

// ---- 投手1人分の編集シート ----
function PitcherEditSheet({ pitcher, onSave, onDelete, onClose }) {
  const [p, setP] = useState({ ...pitcher, ipText: pitcher.outsRecorded != null ? formatIP(pitcher.outsRecorded) : '' });
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const setNum = (k) => (e) => setP({ ...p, [k]: numOrUndef(e.target.value) });
  const toggle = (k) => () => setP({ ...p, [k]: !p[k] });
  const NUM_FIELDS = [
    ['runs', '失点'], ['earnedRuns', '自責点'], ['hitsAllowed', '被安打'], ['walks', '与四球'],
    ['hitByPitch', '与死球'], ['strikeouts', '奪三振'], ['pitches', '投球数'], ['abFaced', '被打数'],
  ];
  const save = () => {
    const { ipText, ...rest } = p;
    onSave({ ...rest, outsRecorded: ipToOuts(ipText) });
  };
  return (
    <Sheet title="投手を編集" onClose={onClose}>
      <label className="small dim">名前</label>
      <input value={p.name || ''} onChange={set('name')} placeholder="選手名" />
      <label className="small dim mt8" style={{ display: 'block' }}>投球回(例: 4.2 = 4回2/3)</label>
      <input value={p.ipText || ''} onChange={set('ipText')} placeholder="例: 5.0" />
      <div className="section-title small mt8">成績(空欄可)</div>
      <div className="grid3">
        {NUM_FIELDS.map(([k, label]) => (
          <div key={k}>
            <label className="small dim">{label}</label>
            <input type="number" inputMode="numeric" value={p[k] ?? ''} onChange={setNum(k)} />
          </div>
        ))}
      </div>
      <div className="grid3 mt8">
        {[['win', '勝利'], ['save', 'セーブ'], ['hold', 'ホールド']].map(([k, label]) => (
          <button key={k} className={p[k] ? 'primary' : ''} onClick={toggle(k)}>{label}</button>
        ))}
      </div>
      <label className="small dim mt8" style={{ display: 'block' }}>メモ</label>
      <textarea rows={3} value={p.memo || ''} onChange={set('memo')} />
      <div className="sheet-actions">
        <button className="ghost danger" onClick={onDelete}>この行を削除</button>
        <button className="primary" disabled={!p.name.trim()} onClick={save}>保存</button>
      </div>
    </Sheet>
  );
}

// 指定フォーマットCSVからボックススコア＋線スコアを取り込む
export default function ImportCsvView({ onClose }) {
  const { state, dispatch } = useStore();
  const myTeam = state.settings.teamName || 'マイチーム';
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
    reader.onerror = () => setError('ファイルを読み込めませんでした。');
    reader.readAsText(file, 'utf-8');
  };

  const hasMemo = !!(parsed && (parsed.meta.memo || parsed.batters.some((b) => b.memo) || parsed.pitchers.some((p) => p.memo)));

  const runCompletion = async () => {
    setCompleteNote(null);
    setCompleting(true);
    const r = await completeBoxScore({ apiKey, meta: parsed.meta, linescore: parsed.linescore, batters: parsed.batters, pitchers: parsed.pitchers });
    setCompleting(false);
    if (!r) {
      setCompleteNote({ ok: false, error: 'Gemini APIキーが未設定か、オフラインです。' });
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
    window.alert(`試合を取り込みました。\n${myTeam} ${myScore} - ${oppScore} ${parsed.meta.opponent || '相手'}\n(試合結果・成績タブに反映されます)`);
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>CSVで試合を取り込む</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="card">
          <h2>使い方</h2>
          <p className="small dim" style={{ marginBottom: 10, lineHeight: 1.7 }}>
            ① テンプレCSVをダウンロード → ② Excel/スプレッドシートで手書きスコアの内容を入力(各自のAI-OCRや手入力で)
            → ③ ここでアップロード。空欄は「不明」として扱われるので、分かる範囲だけでも取り込めます。取り込み前に内容を確認・修正できます。
          </p>
          <button onClick={downloadTemplate} style={{ width: '100%', marginBottom: 8 }}>⬇ テンプレートCSVをダウンロード</button>
          <label className="file-btn" style={{ display: 'block', textAlign: 'center' }}>
            ⬆ 記入済みCSVを選択
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
            <h2>取り込み内容の確認・修正</h2>
            <p className="small dim" style={{ marginBottom: 10 }}>誤読みがあれば、この画面でそのまま修正してから取り込めます。</p>

            <div className="grid2">
              <div>
                <label className="small dim">対戦相手</label>
                <input value={parsed.meta.opponent || ''} onChange={(e) => updateMeta({ opponent: e.target.value })} />
              </div>
              <div>
                <label className="small dim">日付</label>
                <input value={parsed.meta.date || ''} onChange={(e) => updateMeta({ date: e.target.value })} placeholder="YYYY-MM-DD" />
              </div>
            </div>
            <div className="grid2 mt8">
              <div>
                <label className="small dim">先攻/後攻(自チーム)</label>
                <div className="toggle-row">
                  <button className={!parsed.meta.isHome ? 'active' : ''} onClick={() => updateMeta({ isHome: false })}>先攻</button>
                  <button className={parsed.meta.isHome ? 'active' : ''} onClick={() => updateMeta({ isHome: true })}>後攻</button>
                </div>
              </div>
              <div>
                <label className="small dim">大会・シーズン</label>
                <input value={parsed.meta.season || ''} onChange={(e) => updateMeta({ season: e.target.value })} />
              </div>
            </div>

            <div className="hl-score" style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 10, margin: '12px 0' }}>
              <div className="hl-final" style={{ fontSize: 28 }}>{myTeam} {myScore} - {oppScore} {parsed.meta.opponent || '相手'}</div>
            </div>

            {parsed.meta.memo && (
              <div className="warn-box" style={{ marginBottom: 12, borderColor: 'var(--accent-2)', color: 'var(--text)' }}>
                📝 試合メモ: {parsed.meta.memo}
              </div>
            )}

            {hasMemo && (
              <div className="mt8" style={{ marginBottom: 12 }}>
                <button onClick={runCompletion} disabled={!apiKey || completing} style={{ width: '100%' }}>
                  {completing ? '🤔 補完中...' : '🤖 AIで不足項目を補完する'}
                </button>
                {!apiKey && <p className="small dim mt8">※ Gemini APIキー未設定です。設定タブから追加すると使えます。</p>}
                {completeNote?.ok && (
                  <p className="small mt8" style={{ color: 'var(--green)' }}>
                    ✨ メモをもとに{completeNote.filledCount}項目を補完しました(🤖マークの選手)。内容を確認してから取り込んでください。
                  </p>
                )}
                {completeNote && !completeNote.ok && (
                  <p className="small mt8" style={{ color: 'var(--amber)' }}>⚠️ 補完に失敗しました({completeNote.error})</p>
                )}
              </div>
            )}

            {lsKeys.length > 0 && (
              <>
                <div className="section-title small">線スコア(タップして修正できます)</div>
                <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                  <table className="linescore-table">
                    <thead><tr><th></th>{lsKeys.map((k) => <th key={k}>{k}</th>)}<th>計</th></tr></thead>
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
                        <td className="team">{parsed.meta.opponent || '相手'}</td>
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

            <div className="section-title small">打者 {parsed.batters.length}人(タップして修正)</div>
            {parsed.batters.length > 0 && (
              <div className="atbat-history" style={{ marginBottom: 8 }}>
                {parsed.batters.map((b, i) => (
                  <span className="hist-chip" key={i} role="button" onClick={() => setEditBatterIdx(i)}>
                    {b.aiFilled && '🤖 '}{b.name}{b.position && `(${b.position})`}（{b.h ?? 0}安打{b.hr ? ` ${b.hr}本` : ''}{b.rbi ? ` ${b.rbi}打点` : ''}）
                    {b.memo && <span className="dim"> ・{b.memo}</span>}
                  </span>
                ))}
              </div>
            )}
            <button className="small" onClick={() => setEditBatterIdx('new')}>＋ 打者を追加</button>

            <div className="section-title small mt12">投手 {parsed.pitchers.length}人(タップして修正)</div>
            {parsed.pitchers.length > 0 && (
              <div className="atbat-history" style={{ marginBottom: 8 }}>
                {parsed.pitchers.map((p, i) => (
                  <span className="hist-chip" key={i} role="button" onClick={() => setEditPitcherIdx(i)}>
                    {p.aiFilled && '🤖 '}{p.name}（{p.outsRecorded != null ? `${formatIP(p.outsRecorded)}回` : '回不明'}{p.earnedRuns != null ? ` 自責${p.earnedRuns}` : ''}）
                    {p.memo && <span className="dim"> ・{p.memo}</span>}
                  </span>
                ))}
              </div>
            )}
            <button className="small" onClick={() => setEditPitcherIdx('new')}>＋ 投手を追加</button>

            <p className="small dim mt12">名前が既存の選手と一致すればその選手に、なければ新規登録されます。空欄の項目は0として集計されます。</p>
            <button className="primary mt12" style={{ width: '100%' }} onClick={doImport}>この内容で取り込む</button>
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

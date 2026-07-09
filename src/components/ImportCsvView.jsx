import React, { useState } from 'react';
import { useStore } from '../state/store.jsx';
import { buildTemplateCsv, parseGameCsv, mergeCompletion } from '../lib/importCsv.js';
import { completeBoxScore } from '../lib/gemini.js';
import { downloadCSV } from '../lib/csv.js';
import FullscreenView from './FullscreenView.jsx';

// 指定フォーマットCSVからボックススコア＋線スコアを取り込む
export default function ImportCsvView({ onClose }) {
  const { state, dispatch } = useStore();
  const myTeam = state.settings.teamName || 'マイチーム';
  const apiKey = state.settings.geminiApiKey;
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completeNote, setCompleteNote] = useState(null); // { ok, filledCount } | { ok:false, error }

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

  const lsKeys = parsed ? Object.keys(parsed.linescore) : [];
  let myScore = 0, oppScore = 0;
  if (parsed) {
    if (lsKeys.length) for (const k of lsKeys) { myScore += parsed.linescore[k].my; oppScore += parsed.linescore[k].opp; }
    else if (parsed.meta.myScore != null || parsed.meta.oppScore != null) { myScore = parsed.meta.myScore || 0; oppScore = parsed.meta.oppScore || 0; }
    else myScore = parsed.batters.reduce((s, b) => s + (b.runs || 0), 0);
  }

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
            → ③ ここでアップロード。空欄は「不明」として扱われるので、分かる範囲だけでも取り込めます。
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
            <h2>取り込み内容の確認</h2>
            <div className="hl-score" style={{ background: 'var(--bg-3)', borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <span className="hl-vs">{parsed.meta.date || '日付なし'} / {parsed.meta.isHome ? '後攻' : '先攻'}{parsed.meta.season ? ` / ${parsed.meta.season}` : ''}</span>
              <div className="hl-final" style={{ fontSize: 30 }}>{myTeam} {myScore} - {oppScore} {parsed.meta.opponent || '相手'}</div>
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
                <div className="section-title small">線スコア</div>
                <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                  <table className="linescore-table">
                    <thead><tr><th></th>{lsKeys.map((k) => <th key={k}>{k}</th>)}<th>計</th></tr></thead>
                    <tbody>
                      <tr><td className="team">{myTeam}</td>{lsKeys.map((k) => <td key={k} className="num">{parsed.linescore[k].my}</td>)}<td className="num">{myScore}</td></tr>
                      <tr><td className="team">{parsed.meta.opponent || '相手'}</td>{lsKeys.map((k) => <td key={k} className="num">{parsed.linescore[k].opp}</td>)}<td className="num">{oppScore}</td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="section-title small">打者 {parsed.batters.length}人 / 投手 {parsed.pitchers.length}人</div>
            {parsed.batters.length > 0 && (
              <div className="atbat-history" style={{ marginBottom: 8 }}>
                {parsed.batters.map((b, i) => (
                  <span className="hist-chip" key={i}>
                    {b.aiFilled && '🤖 '}{b.name}{b.position && `(${b.position})`}（{b.h ?? 0}安打{b.hr ? ` ${b.hr}本` : ''}{b.rbi ? ` ${b.rbi}打点` : ''}）
                    {b.memo && <span className="dim"> ・{b.memo}</span>}
                  </span>
                ))}
              </div>
            )}
            {parsed.pitchers.length > 0 && (
              <div className="atbat-history">
                {parsed.pitchers.map((p, i) => (
                  <span className="hist-chip" key={i}>
                    {p.aiFilled && '🤖 '}{p.name}（{p.outsRecorded != null ? `${Math.floor(p.outsRecorded / 3)}${p.outsRecorded % 3 ? '.' + (p.outsRecorded % 3) : ''}回` : '回不明'}{p.earnedRuns != null ? ` 自責${p.earnedRuns}` : ''}）
                    {p.memo && <span className="dim"> ・{p.memo}</span>}
                  </span>
                ))}
              </div>
            )}

            <p className="small dim mt8">名前が既存の選手と一致すればその選手に、なければ新規登録されます。空欄の項目は0として集計されます。</p>
            <button className="primary mt12" style={{ width: '100%' }} onClick={doImport}>この内容で取り込む</button>
          </div>
        )}
      </div>
    </FullscreenView>
  );
}

import React, { useState } from 'react';
import { useStore } from '../state/store.jsx';
import { buildTemplateCsv, parseGameCsv } from '../lib/importCsv.js';
import FullscreenView from './FullscreenView.jsx';

// 指定フォーマットCSVからボックススコア＋線スコアを取り込む
export default function ImportCsvView({ onClose }) {
  const { state, dispatch } = useStore();
  const myTeam = state.settings.teamName || 'マイチーム';
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv(myTeam)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aibss-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (file) => {
    setError('');
    setParsed(null);
    const reader = new FileReader();
    reader.onload = () => {
      const r = parseGameCsv(reader.result);
      if (!r.ok) { setError(r.error); return; }
      setParsed(r);
    };
    reader.onerror = () => setError('ファイルを読み込めませんでした。');
    reader.readAsText(file, 'utf-8');
  };

  const lsKeys = parsed ? Object.keys(parsed.linescore) : [];
  let myScore = 0, oppScore = 0;
  if (parsed) {
    if (lsKeys.length) for (const k of lsKeys) { myScore += parsed.linescore[k].my; oppScore += parsed.linescore[k].opp; }
    else if (parsed.meta.myScore != null || parsed.meta.oppScore != null) { myScore = parsed.meta.myScore || 0; oppScore = parsed.meta.oppScore || 0; }
    else myScore = parsed.batters.reduce((s, b) => s + (b.runs || 0), 0);
  }

  const doImport = () => {
    dispatch({ type: 'IMPORT_BOX_GAME', payload: parsed });
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
                  <span className="hist-chip" key={i}>{b.name}（{b.h ?? 0}安打{b.hr ? ` ${b.hr}本` : ''}{b.rbi ? ` ${b.rbi}打点` : ''}）</span>
                ))}
              </div>
            )}
            {parsed.pitchers.length > 0 && (
              <div className="atbat-history">
                {parsed.pitchers.map((p, i) => (
                  <span className="hist-chip" key={i}>{p.name}（{p.outsRecorded != null ? `${Math.floor(p.outsRecorded / 3)}${p.outsRecorded % 3 ? '.' + (p.outsRecorded % 3) : ''}回` : '回不明'}{p.earnedRuns != null ? ` 自責${p.earnedRuns}` : ''}）</span>
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

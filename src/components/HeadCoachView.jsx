import React, { useState, useMemo } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { aggregateBatting, battingMetrics, fmtAvg } from '../lib/stats.js';
import { generateLineup } from '../lib/gemini.js';
import { POSITIONS } from '../lib/model.js';
import FullscreenView from './FullscreenView.jsx';

// AIヘッドコーチ: 今季の打撃成績をもとにGeminiが打順・守備位置を提案する(参考・おまけ機能)
export default function HeadCoachView({ game, canApply, onClose }) {
  const { state, dispatch } = useStore();
  const nameOf = usePlayerName();
  const apiKey = state.settings.geminiApiKey;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { lineup, pitcher, strategy }
  const [error, setError] = useState('');
  const [dh, setDh] = useState(false); // DH制の有無(有=10人/無=9人)

  const games = useMemo(() => Object.values(state.games), [state.games]);
  const batting = useMemo(() => aggregateBatting(games), [games]);

  // 対象選手: ロースター全員(今季成績を1行サマリーに)
  const players = state.players.map((p) => {
    const s = batting[p.id];
    const m = s && s.pa > 0 ? battingMetrics(s) : null;
    const statsLine = m
      ? `打率${fmtAvg(m.ba)} 出塁率${fmtAvg(m.obp)} OPS${m.ops === null ? '-' : m.ops.toFixed(3)} 打点${s.rbi} 本${s.hr}`
      : '成績データ少';
    return { name: p.name, statsLine };
  });

  const run = async () => {
    setError('');
    setLoading(true);
    const r = await generateLineup({ apiKey, players, dh });
    setLoading(false);
    if (!r) {
      setError('Gemini APIキーが未設定か、オフラインです。設定タブでキーを追加してください。');
      return;
    }
    if (r.error) {
      setError(r.error);
      return;
    }
    setResult(r);
  };

  const apply = () => {
    const nameToId = Object.fromEntries(state.players.map((p) => [p.name, p.id]));
    const lineup = [];
    let order = 1;
    for (const item of result.lineup) {
      const pid = nameToId[item.name];
      if (!pid) continue;
      const position = POSITIONS.includes(item.position) ? item.position : '';
      lineup.push({ order: order++, playerId: pid, position });
    }
    if (lineup.length === 0) {
      setError('提案された選手名をロースターと照合できませんでした。');
      return;
    }
    dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup });
    // 先発投手: DHなしは打順内の「投」、DHありは打順外のpitcher
    const pid = dh
      ? nameToId[result.pitcher?.name]
      : lineup.find((l) => l.position === '投')?.playerId;
    if (pid) dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: pid, label: `先発: ${nameOf(pid)}` });
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>AIヘッドコーチ</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="card">
          <p className="small dim" style={{ marginBottom: 10 }}>
            今季の打撃成績をもとに、AIが打順と守備位置を提案します。あくまで参考の「おまけ」機能です
            (最終判断は監督であるあなたの目で)。
          </p>
          <div className="flex" style={{ marginBottom: 10 }}>
            <span className="grow small">DH制（指名打者）</span>
            <div className="toggle-row" style={{ margin: 0, width: 150 }}>
              <button className={dh ? '' : 'active'} onClick={() => { setDh(false); setResult(null); }}>なし(9人)</button>
              <button className={dh ? 'active' : ''} onClick={() => { setDh(true); setResult(null); }}>あり(10人)</button>
            </div>
          </div>
          <button className="primary" onClick={run} disabled={loading} style={{ width: '100%' }}>
            {loading ? '🤔 考え中...' : result ? '🔄 もう一度提案してもらう' : `🤖 スタメン(${dh ? '10' : '9'}人)を提案してもらう`}
          </button>
          {error && <div className="warn-box mt8">⚠️ {error}</div>}
          {!apiKey && <p className="small dim mt8">※ Gemini APIキー未設定です。設定タブから追加すると生成できます。</p>}
        </div>

        {result && (
          <>
            {result.strategy && (
              <div className="card">
                <h2>💡 狙い</h2>
                <p style={{ lineHeight: 1.7 }}>{result.strategy}</p>
              </div>
            )}
            <div className="card">
              <h2>提案オーダー</h2>
              {result.lineup.map((item, i) => (
                <div className="row" key={`${item.name}-${i}`}>
                  <span className="rank-badge">{i + 1}</span>
                  <div className="grow">
                    <b>{item.name}</b>
                    {item.position && <span className="pill blue" style={{ marginLeft: 6 }}>{item.position}</span>}
                    {item.reason && <div className="small dim">{item.reason}</div>}
                  </div>
                </div>
              ))}
              {dh && result.pitcher && (
                <div className="row">
                  <span className="rank-badge">投</span>
                  <div className="grow">
                    <b>{result.pitcher.name}</b>
                    <span className="pill" style={{ marginLeft: 6 }}>投手・打順外</span>
                    {result.pitcher.reason && <div className="small dim">{result.pitcher.reason}</div>}
                  </div>
                </div>
              )}
              {canApply ? (
                <>
                  <button className="primary mt8" onClick={apply} style={{ width: '100%' }}>このオーダーを採用</button>
                  <p className="small dim mt8">採用すると現在の打順・守備位置が置き換わります(試合開始前のみ)。</p>
                </>
              ) : (
                <p className="small dim mt8">試合が始まっているため、この提案は参考表示のみです。</p>
              )}
            </div>
          </>
        )}
      </div>
    </FullscreenView>
  );
}

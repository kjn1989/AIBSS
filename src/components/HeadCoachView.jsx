import React, { useState, useMemo } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { aggregateBatting, battingMetrics, fmtAvg } from '../lib/stats.js';
import { generateLineup } from '../lib/gemini.js';
import { kindOf } from '../lib/editionKind.js';
import { POSITIONS, uncoveredPositions, attendeesOf, positionListLabel, positionLabel } from '../lib/model.js';
import FullscreenView from './FullscreenView.jsx';

// AIヘッドコーチ: 今季の打撃成績をもとにGeminiが打順・守備位置を提案する(参考・おまけ機能)
export default function HeadCoachView({ game, canApply, onClose }) {
  const { state, dispatch } = useStore();
  const nameOf = usePlayerName();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const apiKey = state.settings.geminiApiKey;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { lineup, pitcher, strategy }
  const [error, setError] = useState('');
  const [dh, setDh] = useState(false); // DH制の有無(有=10人/無=9人)

  const games = useMemo(() => Object.values(state.games), [state.games]);
  const batting = useMemo(() => aggregateBatting(games), [games]);

  // 対象選手: 今日来ているメンバー(今季成績を1行サマリーに)。
  // ロースター全員を送っていた頃は、その日に来ていない選手が提案に出てきた
  const here = useMemo(() => attendeesOf(game, state.players), [game, state.players]);
  const players = here.map((p) => {
    const s = batting[p.id];
    const m = s && s.pa > 0 ? battingMetrics(s) : null;
    const statsLine = m
      ? t('hc.statsLine', {
        ba: fmtAvg(m.ba), obp: fmtAvg(m.obp),
        ops: m.ops === null ? '-' : m.ops.toFixed(3), rbi: s.rbi, hr: s.hr,
      })
      : t('hc.statsThin');
    return {
      name: p.name,
      statsLine,
      // 守備位置を渡さないと、AIは誰がどこを守れるか知らないまま9枠を埋める
      mainPos: p.position || '',
      subPos: p.subPositions || [],
    };
  });

  // 誰も守れない位置があるなら、AIに投げる前に言う(投げても埋まらない)
  const holes = useMemo(() => uncoveredPositions(here), [here]);

  const run = async () => {
    setError('');
    setLoading(true);
    const r = await generateLineup({
      apiKey, players, dh,
      edition: state.settings.edition,
      kind: kindOf(state.settings),
      lang,
    });
    setLoading(false);
    if (!r) {
      setError(t('hc.errNoKey'));
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
      setError(t('hc.errNoMatch'));
      return;
    }
    dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup });
    // 先発投手: DHなしは打順内の「投」、DHありは打順外のpitcher
    const pid = dh
      ? nameToId[result.pitcher?.name]
      : lineup.find((l) => l.position === '投')?.playerId;
    if (pid) dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: pid, label: t('hc.starterLabel', { name: nameOf(pid) }) });
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('common.back')}</button>
        <h2>{t('hc.title')}</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <div className="card">
          <p className="small dim" style={{ marginBottom: 10 }}>{t('hc.desc')}</p>
          <div className="flex" style={{ marginBottom: 10 }}>
            <span className="grow small">{t('hc.dh')}</span>
            <div className="toggle-row" style={{ margin: 0, width: 150 }}>
              <button className={dh ? '' : 'active'} onClick={() => { setDh(false); setResult(null); }}>{t('hc.dhOff')}</button>
              <button className={dh ? 'active' : ''} onClick={() => { setDh(true); setResult(null); }}>{t('hc.dhOn')}</button>
            </div>
          </div>
          {holes.length > 0 && (
            <div className="warn-box mt8">{t('pos.uncovered', { list: positionListLabel(holes, lang) })}</div>
          )}
          <button className="primary" onClick={run} disabled={loading} style={{ width: '100%' }}>
            {loading ? t('hc.thinking') : result ? t('hc.again') : t('hc.ask', { n: dh ? 10 : 9 })}
          </button>
          {error && <div className="warn-box mt8">⚠️ {error}</div>}
          {!apiKey && <p className="small dim mt8">{t('hc.noKeyHint')}</p>}
        </div>

        {result && (
          <>
            {result.strategy && (
              <div className="card">
                <h2>{t('hc.strategy')}</h2>
                <p style={{ lineHeight: 1.7 }}>{result.strategy}</p>
              </div>
            )}
            {result.unfilled && result.unfilled.length > 0 && (
              <div className="warn-box mt8">{t('pos.aiUnfilled', { list: positionListLabel(result.unfilled, lang) })}</div>
            )}
            <div className="card">
              <h2>{t('hc.proposed')}</h2>
              {result.lineup.map((item, i) => (
                <div className="row" key={`${item.name}-${i}`}>
                  <span className="rank-badge">{i + 1}</span>
                  <div className="grow">
                    <b>{item.name}</b>
                    {item.position && <span className="pill blue" style={{ marginLeft: 6 }}>{positionLabel(item.position, lang)}</span>}
                    {/* 主の位置か、可で回ってもらった位置か。理由を読む前に分かる */}
                    {item.fit === 'sub' && <span className="pill amber" style={{ marginLeft: 4 }}>{t('pos.fitSub')}</span>}
                    {item.fit === 'main' && <span className="pill" style={{ marginLeft: 4 }}>{t('pos.fitMain')}</span>}
                    {item.reason && <div className="small dim">{item.reason}</div>}
                  </div>
                </div>
              ))}
              {dh && result.pitcher && (
                <div className="row">
                  <span className="rank-badge">{positionLabel('投', lang)}</span>
                  <div className="grow">
                    <b>{result.pitcher.name}</b>
                    <span className="pill" style={{ marginLeft: 6 }}>{t('hc.pitcherNotBatting')}</span>
                    {result.pitcher.reason && <div className="small dim">{result.pitcher.reason}</div>}
                  </div>
                </div>
              )}
              {canApply ? (
                <>
                  <button className="primary mt8" onClick={apply} style={{ width: '100%' }}>{t('hc.apply')}</button>
                  <p className="small dim mt8">{t('hc.applyNote')}</p>
                </>
              ) : (
                <p className="small dim mt8">{t('hc.readOnly')}</p>
              )}
            </div>
          </>
        )}
      </div>
    </FullscreenView>
  );
}

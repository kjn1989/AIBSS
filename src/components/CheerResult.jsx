import React, { useEffect, useState } from 'react';
import { useStore, useT, usePlayerName, playerAliasMap } from '../state/store.jsx';
import { teamLiveStats, CHEER_STAMPS, CHEER_EMOJI } from '../lib/officialCloud.js';
import { cheerSummary, CheerTop } from './Cheer.jsx';

// ============================================================
// 観戦の応援(スタンプ・応援コイン)を試合結果に残す
//
// 応援はクラウドの表(live_cheers)にだけあり、試合が終わると観戦ページでしか見られなかった。
// 試合が終わったら要約を試合そのもの(game.cheers)に書き込む。試合と一緒に同期されるので、
// 観戦リンクを止めても、別の端末でも、あとから見返せる。
// ============================================================

// 試合の応援の要約。保存する形(players は統合済みの選手IDにそろえる)
const snapshotOf = (r, aliases) => {
  const s = cheerSummary(r, aliases);
  return { total: s.total, byStamp: s.byStamp, byLog: s.byLog, top: s.top, players: s.players.filter((x) => x.coins > 0 || x.n > 0) };
};

// 終わった試合のうち、応援の要約がまだ無いものを取りに行って残す(試合結果タブを開いたとき)。
// 大会で続けて何試合もした日も、開けば全部そろう
export function useCheerBackfill() {
  const { state, dispatch } = useStore();
  const teamId = state.settings.officialTeamId;
  const on = !!teamId && state.cloudStatus === 'on';
  useEffect(() => {
    if (!on) return undefined;
    let alive = true;
    const aliases = playerAliasMap(state.players);
    const todo = Object.values(state.games)
      .filter((g) => g.status === 'finished' && !g.cheers && !String(g.id).startsWith('demo-'))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 12);
    (async () => {
      for (const g of todo) {
        try {
          const r = await teamLiveStats(teamId, g.id, 0);
          if (!alive) return;
          // 応援が1つも無い試合にも「無かった」を残す(毎回取りに行かないため)
          if (r && !r.error) dispatch({ type: 'SET_GAME_CHEERS', gameId: g.id, cheers: snapshotOf(r, aliases) });
        } catch { /* 取れなければ次に開いたとき */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, teamId]);
}

// 試合結果タブに出す「観戦の応援」
export default function CheerResult({ game }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const teamId = state.settings.officialTeamId;
  const on = !!teamId && state.cloudStatus === 'on';
  const [live, setLive] = useState(null);

  // 開いた試合は、いまのクラウドの値で取り直す(終わった試合なら残し直す)
  useEffect(() => {
    if (!on || !game) return undefined;
    let alive = true;
    teamLiveStats(teamId, game.id, 0).then((r) => {
      if (!alive || !r || r.error) return;
      const snap = snapshotOf(r, playerAliasMap(state.players));
      setLive(snap);
      if (game.status === 'finished') dispatch({ type: 'SET_GAME_CHEERS', gameId: game.id, cheers: snap });
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, teamId, game?.id, game?.status]);

  const c = live || game?.cheers;
  if (!c || !c.total) return null;
  const players = (c.players || []).filter((x) => x.coins > 0).slice(0, 5);
  return (
    <div className="card cheer-result">
      <h2>{t('cheerres.title')}</h2>
      <div className="cheer-res-total">
        <b>{t('cheerres.total', { n: c.total })}</b>
        <span className="cheer-counts">
          {CHEER_STAMPS.filter((s) => c.byStamp?.[s]).map((s) => <span key={s}>{CHEER_EMOJI[s]}{c.byStamp[s]}</span>)}
        </span>
      </div>
      {players.length > 0 && (
        <>
          <div className="section-title">{t('cheer.playersTitle')}</div>
          {players.map((x, i) => (
            <div className="row" key={x.id}>
              <span className="rank-badge">{i + 1}</span>
              <div className="grow"><b>{nameOf(x.id)}</b></div>
              <b className="cheer-coins">🪙 {x.coins}</b>
            </div>
          ))}
        </>
      )}
      <div className="cheer-res-top"><CheerTop game={game} top={c.top} /></div>
      <p className="small dim" style={{ margin: '6px 0 0' }}>{t('cheerres.note')}</p>
    </div>
  );
}

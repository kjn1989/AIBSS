import React, { useEffect, useRef, useState } from 'react';
import { useStore, useT, usePlayerName } from '../state/store.jsx';
import { fetchLive } from '../lib/officialCloud.js';
import Scoreboard from './Scoreboard.jsx';
import Diamond from './Diamond.jsx';
import CurrentBatter from './CurrentBatter.jsx';
import { useViewerCheer, CheerBar, CheerOverlay, CheerCounts, CheerTop, CheerPlayers, ViewerCount } from './Cheer.jsx';
import ScoreSheetView from './ScoreSheetView.jsx';
import { renderPlayLog } from '../lib/playLogText.js';

// ログイン不要のライブ観戦ページ(?live=<トークン>)。読み取り専用。
// 数秒おきに live_view(supabase/live_share.sql) を呼んで、試合の最新の状態を表示する。
// 受け取った試合と選手はこのページのメモリにだけ置き、端末には保存しない(main.jsx で保存を止めている)。
const POLL_MS = 4000;

export default function LiveWatch({ token }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const [info, setInfo] = useState(null); // { teamName, list, gameId }
  const [pick, setPick] = useState(null); // 見たい試合のid。null = 自動(進行中の最新)
  const [status, setStatus] = useState('connecting'); // connecting | on | error | stopped
  const [at, setAt] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false); // スコアシート(読み取り専用)
  const last = useRef({ gameId: null, since: 0 });
  const pickRef = useRef(null);
  pickRef.current = pick;

  useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      try {
        const sel = pickRef.current;
        const res = await fetchLive(token, { game: sel, last: last.current.gameId, since: last.current.since });
        if (!alive) return;
        if (res?.error === 'not_found') { setStatus('stopped'); return; } // リンクが止められた。再試行しない
        setStatus('on');
        setAt(new Date());
        setInfo({ teamName: res.teamName, list: res.list || [], gameId: res.gameId });
        if (res.game) {
          last.current = { gameId: res.gameId, since: res.updatedAt || 0 };
          dispatch({ type: 'UPDATE_SETTINGS', patch: { teamName: res.teamName, edition: res.edition || state.settings.edition } });
          dispatch({ type: 'MERGE_REMOTE', games: [res.game], players: res.players || [] });
        }
      } catch {
        if (alive) setStatus((s) => (s === 'on' ? 'error' : s === 'connecting' ? 'connecting' : 'error'));
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 別の試合を選んだら、すぐ取りに行く(次の周期を待たない)
  const choose = async (id) => {
    setPick(id);
    pickRef.current = id;
    last.current = { gameId: null, since: 0 };
    try {
      const res = await fetchLive(token, { game: id, last: null, since: 0 });
      if (res?.game) {
        last.current = { gameId: res.gameId, since: res.updatedAt || 0 };
        dispatch({ type: 'MERGE_REMOTE', games: [res.game], players: res.players || [] });
        setInfo({ teamName: res.teamName, list: res.list || [], gameId: res.gameId });
      }
    } catch { /* 次の周期で再試行される */ }
  };

  const liveGame = info?.gameId ? state.games[info.gameId] : null;
  const cheer = useViewerCheer(status === 'stopped' ? null : token, liveGame);

  if (status === 'stopped') {
    return (
      <div className="watch-view">
        <p className="big-note">{t('live.stopped')}</p>
      </div>
    );
  }

  const game = info?.gameId ? state.games[info.gameId] : null;
  const ongoing = game?.status === 'ongoing';
  const others = (info?.list || []).filter((g) => g.id !== info?.gameId);

  return (
    <div className="watch-view">
      <header className="watch-header">
        <h1>{info?.teamName ? `${info.teamName}${game?.opponent ? ` vs ${game.opponent}` : ''}` : t('live.title')}</h1>
        {/* 「ライブ」と観戦中の人数は縦に積む。横に並べると、チーム名が長いときに「ラ/イブ」と折れていた */}
        <div className="watch-badges">
          <span className={`pill ${status === 'on' ? (ongoing ? 'green' : '') : 'amber'}`}>
            {status !== 'on' ? t(status === 'error' ? 'live.reconnecting' : 'watch.connecting') : ongoing ? t('watch.live') : t('live.finished')}
          </span>
          <ViewerCount n={cheer.feed?.viewers} />
        </div>
      </header>

      {!game && (
        <p className="big-note">{status === 'on' ? t('watch.waitingData') : t('watch.connecting')}</p>
      )}

      {game && (
        <>
          <Scoreboard game={game} />
          <Diamond game={game} onBaseTap={() => {}} />
          <CurrentBatter game={game} />
          <button className="live-sheet-btn" onClick={() => setSheetOpen(true)}>{t('live.scoresheet')}</button>
          <div className="card">
            <h2>{t('watch.playLog')}</h2>
            {[...game.playLogs].filter((l) => l.kind !== 'run').slice(-15).reverse().map((l) => (
              <div className="log-line" key={l.id}>
                <b>{t('score.logInning', { inning: l.inning, half: t(l.isTop ? 'half.top' : 'half.bottom') })}</b>{' '}
                {renderPlayLog(game, l, { lang, t, nameOf, edition: state.settings.edition })}
                <CheerCounts m={cheer.feed?.byLog[l.id]} />
              </div>
            ))}
            {game.playLogs.length === 0 && <div className="dim small">{t('score.noPlays')}</div>}
          </div>
        </>
      )}

      {/* 終わった試合は、記録係の端末が残した要約(統合した選手の名前にそろえてある)を優先する */}
      {game && <CheerPlayers players={(game.status === 'finished' && game.cheers?.players) || cheer.feed?.players} />}
      {game && <CheerTop game={game} top={(game.status === 'finished' && game.cheers?.top) || cheer.feed?.top} />}
      {game && cheer.feed && ongoing && (
        <CheerBar token={token} game={game} wallet={cheer.feed.wallet} onSent={(s, cost) => { cheer.pushFloats([s]); if (cost) cheer.spend(cost); }} />
      )}
      <CheerOverlay floats={cheer.floats} hype={cheer.hype} />

      {sheetOpen && game && <ScoreSheetView game={game} readOnly onClose={() => setSheetOpen(false)} />}

      {others.length > 0 && (
        <div className="card">
          <h2>{t('live.otherGames')}</h2>
          {others.map((g) => (
            <button key={g.id} className="live-game-row" onClick={() => choose(g.id)}>
              <span className="grow">
                <b>{g.date}</b> vs {g.opponent || '—'}
              </span>
              <span className="live-score">{g.myScore}-{g.oppScore}</span>
              <span className={`pill ${g.status === 'ongoing' ? 'green' : ''}`}>{g.status === 'ongoing' ? t('watch.live') : t('live.finished')}</span>
            </button>
          ))}
          {pick && (
            <button className="small mt8" onClick={() => { setPick(null); pickRef.current = null; last.current = { gameId: null, since: 0 }; }}>
              {t('live.backToLatest')}
            </button>
          )}
        </div>
      )}

      <p className="small dim" style={{ textAlign: 'center', marginTop: 12 }}>
        {at ? t('live.updated', { time: at.toLocaleTimeString() }) : ''} {t('live.footer')}
      </p>
    </div>
  );
}

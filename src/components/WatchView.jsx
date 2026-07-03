import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store.jsx';
import { connectCloud } from '../lib/cloud.js';
import Scoreboard from './Scoreboard.jsx';
import Diamond from './Diamond.jsx';

// URLの ?watch=1&team=<チームコード>&cfg=<base64のfirebaseConfig> を読み取って
// 読み取り専用でFirestoreを購読し、試合速報だけを表示する観戦者向けページ。
// スコア入力タブ等は一切表示せず、書き込みも行わない。
function decodeConfig(cfgParam) {
  try {
    return decodeURIComponent(escape(atob(cfgParam)));
  } catch {
    return '';
  }
}

export function encodeWatchLink({ configText, teamCode }) {
  const cfg = btoa(unescape(encodeURIComponent(configText)));
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('watch', '1');
  url.searchParams.set('team', teamCode);
  url.searchParams.set('cfg', cfg);
  return url.toString();
}

export default function WatchView() {
  const { dispatch } = useStore();
  const [games, setGames] = useState([]);
  const [status, setStatus] = useState('connecting');

  const params = new URLSearchParams(window.location.search);
  const team = params.get('team') || '';
  const configText = decodeConfig(params.get('cfg') || '');

  useEffect(() => {
    if (!team || !configText) {
      setStatus('error');
      return;
    }
    const conn = connectCloud({
      configText,
      teamCode: team,
      onGames: setGames,
      onPlayers: (players) => dispatch({ type: 'MERGE_REMOTE', games: [], players }),
      onStatus: setStatus,
    });
    return () => conn?.teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, configText]);

  const game =
    [...games].filter((g) => g.status === 'ongoing').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] ||
    [...games].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

  if (!team || !configText || status === 'error') {
    return (
      <div className="watch-view">
        <p className="big-note">
          観戦リンクを読み取れませんでした。共有された最新のリンクを確認してください。
        </p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="watch-view">
        <header className="watch-header">
          <h1>⚾ 試合速報</h1>
          <span className="pill amber">{status === 'on' ? '待機中' : '接続中…'}</span>
        </header>
        <p className="big-note">試合データを待っています…</p>
      </div>
    );
  }

  return (
    <div className="watch-view">
      <header className="watch-header">
        <h1>⚾ {game.opponent ? `vs ${game.opponent}` : '試合速報'}</h1>
        <span className={`pill ${status === 'on' ? 'green' : 'amber'}`}>
          {status === 'on' ? '🔴 ライブ' : '接続中…'}
        </span>
      </header>
      <Scoreboard game={game} />
      <Diamond game={game} onBaseTap={() => {}} />
      <div className="card">
        <h2>プレイログ</h2>
        {[...game.playLogs].slice(-15).reverse().map((l) => (
          <div className="log-line" key={l.id}>
            <b>{l.inning}回{l.isTop ? '表' : '裏'}</b> {l.text}
          </div>
        ))}
        {game.playLogs.length === 0 && <div className="dim small">まだプレイがありません。</div>}
      </div>
      <p className="small dim" style={{ textAlign: 'center', marginTop: 12 }}>
        観戦専用ページです(書き込みはできません)。自動で更新されます。
      </p>
    </div>
  );
}

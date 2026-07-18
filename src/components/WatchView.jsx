import React, { useEffect, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { connectCloud } from '../lib/cloud.js';
import Scoreboard from './Scoreboard.jsx';
import Diamond from './Diamond.jsx';

// URLの ?watch=1&team=<チームコード>&cfg=<base64のfirebaseConfig> を読み取って
// 読み取り専用でFirestoreを購読し、試合速報だけを表示する観戦者向けページ。
// スコア入力タブ等は一切表示せず、書き込みも行わない。
export function decodeConfig(cfgParam) {
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

// チーム招待リンク: 開くと同期設定(config+チームコード)を自動で取り込み、
// 書き込み可能なメンバーとして参加できる。観戦(閲覧専用)リンクとは別物。
export function encodeInviteLink({ configText, teamCode }) {
  const cfg = btoa(unescape(encodeURIComponent(configText)));
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('invite', '1');
  url.searchParams.set('team', teamCode);
  url.searchParams.set('cfg', cfg);
  return url.toString();
}

export default function WatchView() {
  const { dispatch } = useStore();
  const t = useT();
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
          {t('watch.linkError')}
        </p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="watch-view">
        <header className="watch-header">
          <h1>{t('watch.title')}</h1>
          <span className="pill amber">{status === 'on' ? t('watch.waiting') : t('watch.connecting')}</span>
        </header>
        <p className="big-note">{t('watch.waitingData')}</p>
      </div>
    );
  }

  return (
    <div className="watch-view">
      <header className="watch-header">
        <h1>{game.opponent ? `${t('watch.titlePrefix')}vs ${game.opponent}` : t('watch.title')}</h1>
        <span className={`pill ${status === 'on' ? 'green' : 'amber'}`}>
          {status === 'on' ? t('watch.live') : t('watch.connecting')}
        </span>
      </header>
      <Scoreboard game={game} />
      <Diamond game={game} onBaseTap={() => {}} />
      <div className="card">
        <h2>{t('watch.playLog')}</h2>
        {[...game.playLogs].slice(-15).reverse().map((l) => (
          <div className="log-line" key={l.id}>
            <b>{t('score.logInning', { inning: l.inning, half: t(l.isTop ? 'half.top' : 'half.bottom') })}</b> {l.text}
          </div>
        ))}
        {game.playLogs.length === 0 && <div className="dim small">{t('score.noPlays')}</div>}
      </div>
      <p className="small dim" style={{ textAlign: 'center', marginTop: 12 }}>
        {t('watch.footer')}
      </p>
    </div>
  );
}

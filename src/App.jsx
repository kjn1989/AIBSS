import React, { useState, useEffect } from 'react';
import { useStore } from './state/store.jsx';
import HomeTab from './components/HomeTab.jsx';
import ScoreTab from './components/ScoreTab.jsx';
import OrderTab from './components/OrderTab.jsx';
import StatsTab from './components/StatsTab.jsx';
import ResultTab from './components/ResultTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import CloudSync from './components/CloudSync.jsx';
import { decodeConfig } from './components/WatchView.jsx';

const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏆' },
  { id: 'score', label: 'スコア入力', icon: '⚾' },
  { id: 'order', label: 'オーダー', icon: '📋' },
  { id: 'stats', label: '成績', icon: '📊' },
  { id: 'result', label: '試合結果', icon: '🏟️' },
];

// 招待リンク(?invite=1&team=...&cfg=...)で開かれたら、同期設定を取り込むか確認する
function useInvite(dispatch) {
  const [invite, setInvite] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('invite') !== '1') return;
    const team = params.get('team') || '';
    const configText = decodeConfig(params.get('cfg') || '');
    if (team && configText) setInvite({ team, configText });
    // URLからクエリを消して、リロード時に再度出ないようにする
    const clean = new URL(window.location.href);
    clean.search = '';
    window.history.replaceState({}, '', clean.toString());
  }, []);

  const accept = () => {
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: { firebaseConfigText: invite.configText, teamCode: invite.team, cloudEnabled: true },
    });
    setInvite(null);
  };
  return { invite, accept, dismiss: () => setInvite(null) };
}

export default function App() {
  const [tab, setTab] = useState('home');
  const { state, dispatch } = useStore();
  const { invite, accept, dismiss } = useInvite(dispatch);

  const cloudBadge =
    state.cloudStatus === 'on' ? '☁️' : state.cloudStatus === 'connecting' ? '⏳' : state.cloudStatus === 'error' ? '⚠️' : '';

  return (
    <div className="app">
      <CloudSync />
      {invite && (
        <div className="invite-overlay">
          <div className="invite-card">
            <h2>チームに参加</h2>
            <p className="small dim">
              チーム「{invite.team}」への招待リンクです。参加すると、このチームの
              試合データがこの端末とリアルタイムで同期されます(書き込みも可能)。
            </p>
            <div className="sheet-actions">
              <button className="ghost" onClick={dismiss}>今はしない</button>
              <button className="primary" onClick={accept}>参加する</button>
            </div>
          </div>
        </div>
      )}
      <header className="app-header">
        <div>
          <h1>⚾ {state.settings.teamName || 'スコアラー'}</h1>
          <div className="sub">音声実況＆タップUIスコアラー {cloudBadge}</div>
        </div>
        <div className="header-btns">
          <button className="ghost small" onClick={() => setTab('settings')} aria-label="設定">
            ⚙️
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'home' && <HomeTab />}
        {tab === 'score' && <ScoreTab />}
        {tab === 'order' && <OrderTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'result' && <ResultTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

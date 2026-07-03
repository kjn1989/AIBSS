import React, { useState } from 'react';
import { useStore } from './state/store.jsx';
import HomeTab from './components/HomeTab.jsx';
import ScoreTab from './components/ScoreTab.jsx';
import OrderTab from './components/OrderTab.jsx';
import StatsTab from './components/StatsTab.jsx';
import PitchingTab from './components/PitchingTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import CloudSync from './components/CloudSync.jsx';

const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏆' },
  { id: 'score', label: 'スコア入力', icon: '⚾' },
  { id: 'order', label: 'オーダー', icon: '📋' },
  { id: 'stats', label: '成績', icon: '📊' },
  { id: 'pitching', label: '投手', icon: '🎯' },
];

export default function App() {
  const [tab, setTab] = useState('home');
  const { state } = useStore();

  const cloudBadge =
    state.cloudStatus === 'on' ? '☁️' : state.cloudStatus === 'connecting' ? '⏳' : state.cloudStatus === 'error' ? '⚠️' : '';

  return (
    <div className="app">
      <CloudSync />
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
        {tab === 'pitching' && <PitchingTab />}
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

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
import { officialAvailable, currentUserAsync, loginWithPassword, joinByInvite } from './lib/officialCloud.js';
import { addProfile, switchActiveProfile } from './lib/profiles.js';
import { persist } from './state/store.jsx';
import { DiamondIcon, LedWordmark } from './components/BrandMark.jsx';
import { editionLabel } from './lib/model.js';

const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏆' },
  { id: 'score', label: 'スコア入力', icon: '⚾' },
  { id: 'order', label: 'オーダー', icon: '📋' },
  { id: 'stats', label: '成績', icon: '📊' },
  { id: 'result', label: '試合結果', icon: '🏟️' },
];

// ヘッダーのエディション表示。括弧の補足(例: ブカツ(中高大)の「(中高大)」)だけを
// 小さく控えめにして1行に収める。「草野球・社会人」は両者を並列(同サイズ)で表示する。
function EditionLabel({ edition }) {
  const label = editionLabel(edition);
  const m = label.match(/^(.+?)(（.*）|\(.*\))$/); // 括弧内のみ補足扱い(・区切りは同サイズ)
  return (
    <>
      for {m ? m[1] : label}
      {m && <span className="ed-paren">{m[2]}</span>}
    </>
  );
}

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

// 公式クラウドの招待リンク(?ct=トークン)で開かれたら、ログイン→チーム参加→専用の
// チームプロフィール作成、まで面倒を見る
function useOfficialJoin(state) {
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needLogin, setNeedLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('ct');
    if (!t) return;
    setToken(t);
    const clean = new URL(window.location.href);
    clean.search = '';
    window.history.replaceState({}, '', clean.toString());
    if (officialAvailable()) currentUserAsync().then((u) => setNeedLogin(!u));
  }, []);

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      if (!(await currentUserAsync())) {
        if (!email.includes('@') || password.length < 6) {
          throw new Error('メールアドレスとパスワード(6文字以上)を入力してください');
        }
        await loginWithPassword(email.trim(), password);
      }
      const meta = await joinByInvite(token);
      // 参加したクラウドチーム専用のローカルプロフィールを作って切り替える
      persist(state); // 現在のチームを保存してから
      const p = addProfile(meta.name, meta.edition, { officialTeamId: meta.teamId });
      switchActiveProfile(p.id);
      window.location.reload();
    } catch (e) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  };
  return { token, busy, error, join, needLogin, email, setEmail, password, setPassword, dismiss: () => setToken(null) };
}

export default function App() {
  const [tab, setTab] = useState('home');
  const { state, dispatch } = useStore();
  const { invite, accept, dismiss } = useInvite(dispatch);
  const officialJoin = useOfficialJoin(state);

  return (
    <div className="app" data-edition={state.settings.edition || '草野球'}>
      <CloudSync />
      {officialJoin.token && (
        <div className="invite-overlay">
          <div className="invite-card">
            <h2>チームに参加 (AI-BASE公式クラウド)</h2>
            <p className="small dim">
              招待リンクからの参加です。参加するとこのチーム専用のプロフィールが作られて、
              選手・試合データが同期されます。
            </p>
            {officialJoin.needLogin && (
              <>
                <input
                  type="email" placeholder="メールアドレス"
                  value={officialJoin.email} onChange={(e) => officialJoin.setEmail(e.target.value)}
                />
                <input
                  type="password" placeholder="パスワード(6文字以上・初回は自動登録)" className="mt8"
                  value={officialJoin.password} onChange={(e) => officialJoin.setPassword(e.target.value)}
                />
              </>
            )}
            {officialJoin.error && <div className="warn-box mt8">⚠️ {officialJoin.error}</div>}
            <div className="sheet-actions">
              <button className="ghost" onClick={officialJoin.dismiss} disabled={officialJoin.busy}>今はしない</button>
              <button className="primary" onClick={officialJoin.join} disabled={officialJoin.busy}>
                {officialJoin.busy ? '参加中…' : officialJoin.needLogin ? 'ログインして参加' : '参加する'}
              </button>
            </div>
          </div>
        </div>
      )}
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
        {/* ロゴ(アイコン+LEDワードマーク+DIAMOND)の右隣にチーム情報を寄せてひとまとまりにし、
            設定歯車だけを右上角に固定。下部の余白を詰めてコンパクトに見せる。
            LEDドットマトリクスは装飾(aria-hidden)、実テキストはsr-onlyで併記。 */}
        <div className="header-brand">
          <h1 className="brand-row">
            <DiamondIcon size={36} className="brand-mark" />
            <div className="brand-text" aria-hidden="true">
              <LedWordmark dot={3.4} gap={1.05} letterGap={2.3} sepGap={2.55} />
              <div className="brand-diamond-sub">DIAMOND</div>
            </div>
            <span className="sr-only">AI-BASE DIAMOND</span>
          </h1>
          <div className="header-team">
            <div className="brand-for"><EditionLabel edition={state.settings.edition || '草野球'} /></div>
            <div className="brand-team">{state.settings.teamName || 'マイチーム'}</div>
          </div>
        </div>
        <button className="ghost small header-gear" onClick={() => setTab('settings')} aria-label="設定">
          ⚙️
        </button>
      </header>

      <main className="main">
        {tab === 'home' && <HomeTab onNavigate={setTab} />}
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

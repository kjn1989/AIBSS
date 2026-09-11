import React, { useState, useEffect, useRef } from 'react';
import { useStore, useT } from './state/store.jsx';
import ErrorBoundary, { CrashProbe } from './components/ErrorBoundary.jsx';
import HomeTab from './components/HomeTab.jsx';
import ScoreTab from './components/ScoreTab.jsx';
import OrderTab from './components/OrderTab.jsx';
import StatsTab from './components/StatsTab.jsx';
import ResultTab from './components/ResultTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import CloudSync from './components/CloudSync.jsx';
import PersistWarning from './components/PersistWarning.jsx';
import UndoSnackbar from './components/UndoSnackbar.jsx';
import { decodeConfig } from './components/WatchView.jsx';
import { officialAvailable, currentUserAsync, loginWithPassword, joinByInvite } from './lib/officialCloud.js';
import { addProfile, switchActiveProfile } from './lib/profiles.js';
import { persist } from './state/store.jsx';
import { DiamondIcon, LedWordmark } from './components/BrandMark.jsx';
import EditionText from './components/EditionText.jsx';
import { registerBackButtonHandler } from './lib/nativeBridge.js';
import { applyDocumentLang } from './lib/documentLang.js';

// ラベルは i18n キー(lib/i18n.js)。表示時に useT() で現在の言語に解決する
const TABS = [
  { id: 'home', labelKey: 'tab.home', icon: '🏆' },
  { id: 'score', labelKey: 'tab.score', icon: '⚾' },
  { id: 'order', labelKey: 'tab.order', icon: '📋' },
  { id: 'stats', labelKey: 'tab.stats', icon: '📊' },
  { id: 'result', labelKey: 'tab.result', icon: '🏟️' },
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

// 公式クラウドの招待リンク(?ct=トークン)で開かれたら、ログイン→チーム参加→専用の
// チームプロフィール作成、まで面倒を見る
function useOfficialJoin(state, t) {
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
          throw new Error(t('join.errFields'));
        }
        await loginWithPassword(email.trim(), password);
      }
      const meta = await joinByInvite(token);
      // 参加したクラウドチーム専用のローカルプロフィールを作って切り替える。
      // 招待のロール(観戦/記録係)も即時に保存し、観戦URL参加直後から正しく権限が効くようにする。
      persist(state); // 現在のチームを保存してから
      const p = addProfile(meta.name, meta.edition, { officialTeamId: meta.teamId, officialRole: meta.role || null });
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
  const t = useT();
  const { invite, accept, dismiss } = useInvite(dispatch);
  const officialJoin = useOfficialJoin(state, t);

  // Android物理/ジェスチャー「戻る」: ホーム以外ならホームタブへ、ホームなら最小化(Webでは無効)
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // 落ちた画面からバックアップを書き出すために、いまの状態を参照で渡す。
  // ErrorBoundary はクラスなので useStore を呼べない
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    return registerBackButtonHandler(() => tabRef.current === 'home', () => setTab('home'));
  }, []);

  // 言語を切り替えた瞬間に、タブの名前と <html lang> も追いつかせる。
  // 起動時(main.jsx)だけだと、切り替えても次に開くまで古いままになる
  const lang = state.settings.lang || 'ja';
  useEffect(() => { applyDocumentLang(lang); }, [lang]);

  return (
    <div className="app" data-edition={state.settings.edition || '草野球'}>
      <CloudSync />
      <PersistWarning />
      {officialJoin.token && (
        <div className="invite-overlay">
          <div className="invite-card">
            <h2>{t('join.officialTitle')}</h2>
            <p className="small dim">{t('join.officialDesc')}</p>
            {officialJoin.needLogin && (
              <>
                <input
                  type="email" placeholder={t('join.email')}
                  value={officialJoin.email} onChange={(e) => officialJoin.setEmail(e.target.value)}
                />
                <input
                  type="password" placeholder={t('join.password')} className="mt8"
                  value={officialJoin.password} onChange={(e) => officialJoin.setPassword(e.target.value)}
                />
              </>
            )}
            {officialJoin.error && <div className="warn-box mt8">⚠️ {officialJoin.error}</div>}
            <div className="sheet-actions">
              <button className="ghost" onClick={officialJoin.dismiss} disabled={officialJoin.busy}>{t('join.notNow')}</button>
              <button className="primary" onClick={officialJoin.join} disabled={officialJoin.busy}>
                {officialJoin.busy ? t('join.joining') : officialJoin.needLogin ? t('join.signInAndJoin') : t('join.join')}
              </button>
            </div>
          </div>
        </div>
      )}
      {invite && (
        <div className="invite-overlay">
          <div className="invite-card">
            <h2>{t('join.title')}</h2>
            <p className="small dim">{t('join.desc', { team: invite.team })}</p>
            <div className="sheet-actions">
              <button className="ghost" onClick={dismiss}>{t('join.notNow')}</button>
              <button className="primary" onClick={accept}>{t('join.join')}</button>
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
            <DiamondIcon size={31} className="brand-mark" />
            <div className="brand-text" aria-hidden="true">
              <LedWordmark dot={3.4} gap={0.5} letterGap={2.3} sepGap={2.55} glow />
              <div className="brand-diamond-sub">DIAMOND</div>
            </div>
            <span className="sr-only">AI-BASE DIAMOND</span>
          </h1>
          <div className="header-team">
            <div className="brand-for"><EditionText edition={state.settings.edition || '草野球'} withFor withLevel /></div>
            <div className="brand-team">{state.settings.teamName || t('app.teamFallback')}</div>
          </div>
        </div>
        <button className="ghost small header-gear" onClick={() => setTab('settings')} aria-label={t('tab.settings')}>
          ⚙️
        </button>
      </header>

      {/* 1つのタブが落ちても下のタブバーは生きている。別のタブへ移れば記録は続く。
          resetKey にタブを渡してあるので、移った先ではもう一度描画を試す */}
      <main className="main">
        <ErrorBoundary resetKey={tab} lang={state.settings.lang || 'ja'} stateRef={stateRef}>
          <CrashProbe tab={tab} />
          {tab === 'home' && <HomeTab onNavigate={setTab} />}
          {tab === 'score' && <ScoreTab />}
          {tab === 'order' && <OrderTab />}
          {tab === 'stats' && <StatsTab />}
          {tab === 'result' && <ResultTab />}
          {tab === 'settings' && <SettingsTab />}
        </ErrorBoundary>
      </main>

      <nav className="tabbar">
        {TABS.map((tb) => (
          <button key={tb.id} className={tab === tb.id ? 'active' : ''} onClick={() => setTab(tb.id)}>
            <span className="tab-icon">{tb.icon}</span>
            {t(tb.labelKey)}
          </button>
        ))}
      </nav>

      <UndoSnackbar />
    </div>
  );
}

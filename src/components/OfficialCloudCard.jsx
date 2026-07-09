import React, { useState, useEffect } from 'react';
import { useStore } from '../state/store.jsx';
import {
  officialAvailable, watchAuth, loginWithGoogle, sendLoginLink, logout,
  createCloudTeam, createInvite, inviteUrl, listMyTeams, listMembers, setMemberRole, removeMember,
} from '../lib/officialCloud.js';
import QRCode from './QRCode.jsx';

const ROLE_LABEL = { owner: '管理者', scorer: '記録係', viewer: '観戦' };

// AI-BSS公式クラウド: ログイン+チーム登録+招待+メンバー管理。
// 旧方式(自前Firebase)のCloudCardとは独立(公式が設定されていれば同期はこちらを優先)。
export default function OfficialCloudCard() {
  const { state, dispatch } = useStore();
  const [user, setUser] = useState(undefined); // undefined=確認中 / null=未ログイン
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState(null); // { url, role }
  const [showQr, setShowQr] = useState(false);
  const [members, setMembers] = useState(null);
  const [myRole, setMyRole] = useState('');
  const teamId = state.settings.officialTeamId;
  const available = officialAvailable();

  useEffect(() => {
    if (!available) return undefined;
    return watchAuth((u) => setUser(u));
  }, [available]);

  // 接続中チームの自分のロールとメンバー一覧を取得
  useEffect(() => {
    if (!user || !teamId) { setMembers(null); setMyRole(''); return; }
    (async () => {
      try {
        const mine = (await listMyTeams()).find((t) => t.teamId === teamId);
        setMyRole(mine?.role || '');
        setMembers(await listMembers(teamId));
      } catch (e) {
        setErr(e?.message || 'メンバー情報の取得に失敗しました');
      }
    })();
  }, [user, teamId]);

  const run = (fn) => async () => {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const registerTeam = run(async () => {
    const id = await createCloudTeam({ name: state.settings.teamName || 'マイチーム', edition: state.settings.edition || '草野球' });
    // officialTeamIdを設定するとCloudSyncが接続し、既存の選手・試合・参加メンバーを自動アップロードする
    dispatch({ type: 'UPDATE_SETTINGS', patch: { officialTeamId: id } });
  });

  const makeInvite = (role) => run(async () => {
    const token = await createInvite(teamId, role);
    const url = inviteUrl(token);
    setInvite({ url, role });
    setShowQr(false);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* コピー不可でもURLは画面に出す */
    }
  })();

  const statusLabel = {
    off: 'オフ', connecting: '接続中…', on: '✅ 同期中', error: '⚠️ エラー',
  }[state.cloudStatus];

  if (!available) {
    return (
      <div className="card">
        <h2>☁️ AI-BSS公式クラウド</h2>
        <p className="small dim">
          準備中です。ログイン+招待リンクだけでチーム同期ができる公式クラウド機能が、まもなく使えるようになります。
          (運営者向け: docs/firebase-setup.md の手順で接続設定を注入すると有効になります)
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>☁️ AI-BSS公式クラウド</h2>

      {user === undefined && <p className="small dim">ログイン状態を確認中…</p>}

      {user === null && (
        <>
          <p className="small dim" style={{ marginBottom: 10 }}>
            ログインすると、このチームをクラウドに登録して、招待リンクだけでチームメイトと同期できます(Firebase設定の貼り付けは不要)。
          </p>
          <button className="primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy} onClick={run(loginWithGoogle)}>
            Googleでログイン
          </button>
          <div className="flex" style={{ gap: 6 }}>
            <input className="grow" type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button
              className="small"
              disabled={busy || !email.includes('@')}
              onClick={run(async () => { await sendLoginLink(email.trim()); setSent(true); })}
            >
              リンク送信
            </button>
          </div>
          {sent && <p className="small mt8" style={{ color: 'var(--green)' }}>✉️ ログイン用リンクを送信しました。メールを開いてリンクをタップしてください。</p>}
        </>
      )}

      {user && !teamId && (
        <>
          <p className="small" style={{ marginBottom: 8 }}>
            ログイン中: <b>{user.displayName || user.email}</b>
            <button className="small ghost" style={{ marginLeft: 8 }} onClick={run(logout)}>ログアウト</button>
          </p>
          <p className="small dim" style={{ marginBottom: 10 }}>
            「クラウドに登録」すると、このチームの選手・試合・参加メンバーがアップロードされ、
            以後の記録が自動同期されます。チームメイトの参加は招待リンクから。
          </p>
          <button className="primary" style={{ width: '100%' }} disabled={busy} onClick={registerTeam}>
            ⬆ このチームをクラウドに登録
          </button>
          <p className="small dim mt8">別チームへの参加は、管理者から受け取った招待リンクを開いてください。</p>
        </>
      )}

      {user && teamId && (
        <>
          <div className="flex" style={{ marginBottom: 8 }}>
            <span className="grow small">
              状態: {statusLabel} / あなた: <b>{ROLE_LABEL[myRole] || myRole || '確認中'}</b>
            </span>
            <button className="small ghost" onClick={run(logout)}>ログアウト</button>
          </div>

          {(myRole === 'owner') && (
            <>
              <div className="section-title">チームメイトを招待</div>
              <div className="grid2">
                <button disabled={busy} onClick={() => makeInvite('scorer')}>🔗 記録係を招待</button>
                <button disabled={busy} onClick={() => makeInvite('viewer')}>👀 観戦を招待</button>
              </div>
              {invite && (
                <div className="mt8">
                  <p className="small" style={{ color: 'var(--green)' }}>
                    ✅ {ROLE_LABEL[invite.role]}用の招待リンクを作成しました(コピー済み・14日有効):
                  </p>
                  <input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
                  <button className="small mt8" onClick={() => setShowQr(!showQr)}>{showQr ? 'QRを閉じる' : '📱 QRを表示'}</button>
                  {showQr && (
                    <div className="qr-box"><QRCode text={invite.url} /><span className="small dim">スマホのカメラで読み取ってもらってください</span></div>
                  )}
                </div>
              )}
            </>
          )}

          {members && (
            <>
              <div className="section-title">メンバー ({members.length}人)</div>
              {members.map((m) => (
                <div className="row" key={m.uid}>
                  <div className="grow">
                    <b>{m.name}</b>
                    <div className="dim small">{m.email}</div>
                  </div>
                  {myRole === 'owner' && m.uid !== user.uid ? (
                    <>
                      <select
                        className="small"
                        style={{ width: 90 }}
                        value={m.role}
                        onChange={(e) => run(async () => {
                          await setMemberRole(teamId, m.uid, e.target.value);
                          setMembers(await listMembers(teamId));
                        })()}
                      >
                        {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button
                        className="small ghost"
                        style={{ color: 'var(--red)' }}
                        onClick={() => window.confirm(`${m.name} をチームから外しますか？`) && run(async () => {
                          await removeMember(teamId, m.uid);
                          setMembers(await listMembers(teamId));
                        })()}
                      >
                        除名
                      </button>
                    </>
                  ) : (
                    <span className="pill">{ROLE_LABEL[m.role] || m.role}</span>
                  )}
                </div>
              ))}
            </>
          )}

          <button
            className="ghost small mt12"
            style={{ color: 'var(--red)' }}
            onClick={() => {
              if (!window.confirm('このチームとクラウドの接続を解除しますか？(クラウド上のデータは残ります。端末のデータもそのまま)')) return;
              dispatch({ type: 'UPDATE_SETTINGS', patch: { officialTeamId: null } });
            }}
          >
            接続を解除
          </button>
        </>
      )}

      {err && <div className="warn-box mt8">⚠️ {err}</div>}
    </div>
  );
}

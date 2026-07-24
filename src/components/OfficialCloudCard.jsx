import React, { useState, useEffect } from 'react';
import { useStore, useT } from '../state/store.jsx';
import {
  officialAvailable, watchAuth, loginWithPassword, logout,
  createCloudTeam, createInvite, inviteUrl, listMyTeams, listMembers, setMemberRole, removeMember,
} from '../lib/officialCloud.js';
import QRCode from './QRCode.jsx';

const ROLE_KEYS = ['owner', 'scorer', 'viewer'];

// AI-BASE公式クラウド(Supabase): ログイン+チーム登録+招待+メンバー管理。
// 旧方式(自前Firebase)のCloudCardとは独立(公式が設定されていれば同期はこちらを優先)。
export default function OfficialCloudCard() {
  const { state, dispatch } = useStore();
  const t = useT();
  const roleLabel = (k) => t(`occ.role.${k}`);
  const [user, setUser] = useState(undefined); // undefined=確認中 / null=未ログイン
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState(null); // { url, role }
  const [showQr, setShowQr] = useState(false);
  const [members, setMembers] = useState(null);
  const [myRole, setMyRole] = useState('');
  const [myTeams, setMyTeams] = useState(null); // このアカウントが参加済みのクラウドのチーム
  const teamId = state.settings.officialTeamId;
  const available = officialAvailable();

  useEffect(() => {
    if (!available) return undefined;
    return watchAuth((u) => setUser(u));
  }, [available]);

  // ログイン中は、このアカウントが参加済みのチーム一覧を取得(別端末での再接続・切替に使う)
  useEffect(() => {
    if (!user) { setMyTeams(null); return; }
    listMyTeams().then(setMyTeams).catch(() => setMyTeams([]));
  }, [user, teamId]);

  const connectTeam = (tid) => run(async () => {
    // 既存のクラウドのチームに接続。CloudSyncが選手・試合・メンバーをこの端末へ同期する
    dispatch({ type: 'UPDATE_SETTINGS', patch: { officialTeamId: tid } });
  });

  // 接続中チームの自分のロールとメンバー一覧を取得
  useEffect(() => {
    if (!user || !teamId) { setMembers(null); setMyRole(''); return; }
    (async () => {
      try {
        const mine = (await listMyTeams()).find((t) => t.teamId === teamId);
        setMyRole(mine?.role || '');
        setMembers(await listMembers(teamId));
      } catch (e) {
        setErr(e?.message || t('occ.membersError'));
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
    const id = await createCloudTeam({ name: state.settings.teamName || t('app.teamFallback'), edition: state.settings.edition || '草野球' });
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
    off: t('occ.status.off'), connecting: t('occ.status.connecting'), on: t('occ.status.on'), error: t('occ.status.error'),
  }[state.cloudStatus];

  if (!available) {
    return (
      <div className="card">
        <h2>{t('occ.title')}</h2>
        <p className="small dim">
          {t('occ.unavailableDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>{t('occ.title')}</h2>

      {user === undefined && <p className="small dim">{t('occ.checkingAuth')}</p>}

      {user === null && (
        <>
          <p className="small dim" style={{ marginBottom: 10 }}>
            {t('occ.loginDesc')}
          </p>
          <input type="email" placeholder={t('occ.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            type="password" placeholder={t('occ.password')} className="mt8"
            value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && password.length >= 6 && run(() => loginWithPassword(email.trim(), password))()}
          />
          <button
            className="primary mt8" style={{ width: '100%' }}
            disabled={busy || !email.includes('@') || password.length < 6}
            onClick={run(() => loginWithPassword(email.trim(), password))}
          >
            {busy ? t('occ.busy') : t('occ.loginBtn')}
          </button>
          <details className="forgot-help mt8">
            <summary>{t('occ.forgotSummary')}</summary>
            <p className="small dim" style={{ whiteSpace: 'pre-line', marginTop: 6 }}>{t('occ.forgotBody')}</p>
          </details>
        </>
      )}

      {user && !teamId && (
        <>
          <p className="small" style={{ marginBottom: 8 }}>
            {t('occ.loggedInAs')}<b>{user.email}</b>
            <button className="small ghost" style={{ marginLeft: 8 }} onClick={run(logout)}>{t('occ.logout')}</button>
          </p>

          {myTeams === null && <p className="small dim">{t('occ.checkingTeams')}</p>}
          {myTeams && myTeams.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>{t('occ.yourTeamsTitle')}</div>
              <p className="small dim" style={{ marginBottom: 8 }}>{t('occ.connectDesc')}</p>
              {myTeams.map((tm) => (
                <div className="row" key={tm.teamId}>
                  <div className="grow">
                    <b>{tm.teamName}</b> <span className="pill">{roleLabel(tm.role)}</span>
                  </div>
                  <button className="primary small" disabled={busy} onClick={connectTeam(tm.teamId)}>
                    {t('occ.connectTeam')}
                  </button>
                </div>
              ))}
              <div className="section-title">{t('occ.orRegisterTitle')}</div>
            </>
          )}

          <p className="small dim" style={{ marginBottom: 10 }}>
            {t('occ.registerDesc')}
          </p>
          <button
            className={myTeams && myTeams.length ? 'ghost' : 'primary'}
            style={{ width: '100%' }}
            disabled={busy}
            onClick={registerTeam}
          >
            {t('occ.registerBtn')}
          </button>
          <p className="small dim mt8">{t('occ.joinHint')}</p>
        </>
      )}

      {user && teamId && (
        <>
          <div className="flex" style={{ marginBottom: 8 }}>
            <span className="grow small">
              {t('occ.stateYou', { status: statusLabel })}<b>{myRole ? roleLabel(myRole) : t('occ.roleChecking')}</b>
            </span>
            <button className="small ghost" onClick={run(logout)}>{t('occ.logout')}</button>
          </div>

          {(myRole === 'owner') && (
            <>
              <div className="section-title">{t('occ.inviteTitle')}</div>
              <div className="grid2">
                <button disabled={busy} onClick={() => makeInvite('scorer')}>{t('occ.inviteScorer')}</button>
                <button disabled={busy} onClick={() => makeInvite('viewer')}>{t('occ.inviteViewer')}</button>
              </div>
              {invite && (
                <div className="mt8">
                  <p className="small" style={{ color: 'var(--green)' }}>
                    {t('occ.inviteCreated', { role: roleLabel(invite.role) })}
                  </p>
                  <input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
                  <button className="small mt8" onClick={() => setShowQr(!showQr)}>{showQr ? t('occ.hideQr') : t('occ.showQr')}</button>
                  {showQr && (
                    <div className="qr-box"><QRCode text={invite.url} /><span className="small dim">{t('set.qrHint')}</span></div>
                  )}
                </div>
              )}
            </>
          )}

          {members && (
            <>
              <div className="section-title">{t('occ.membersCount', { n: members.length })}</div>
              {members.map((m) => (
                <div className="row" key={m.uid}>
                  <div className="grow">
                    <b>{m.name || m.email}</b>
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
                        {ROLE_KEYS.map((k) => <option key={k} value={k}>{roleLabel(k)}</option>)}
                      </select>
                      <button
                        className="small ghost"
                        style={{ color: 'var(--red)' }}
                        onClick={() => window.confirm(t('occ.removeConfirm', { name: m.name || m.email })) && run(async () => {
                          await removeMember(teamId, m.uid);
                          setMembers(await listMembers(teamId));
                        })()}
                      >
                        {t('occ.remove')}
                      </button>
                    </>
                  ) : (
                    <span className="pill">{roleLabel(m.role)}</span>
                  )}
                </div>
              ))}
            </>
          )}

          {myTeams && myTeams.filter((tm) => tm.teamId !== teamId).length > 0 && (
            <>
              <div className="section-title">{t('occ.switchTeamTitle')}</div>
              {myTeams.filter((tm) => tm.teamId !== teamId).map((tm) => (
                <div className="row" key={tm.teamId}>
                  <div className="grow"><b>{tm.teamName}</b> <span className="pill">{roleLabel(tm.role)}</span></div>
                  <button className="primary small" disabled={busy} onClick={connectTeam(tm.teamId)}>{t('occ.connectTeam')}</button>
                </div>
              ))}
            </>
          )}

          <button
            className="ghost small mt12"
            style={{ color: 'var(--red)' }}
            onClick={() => {
              if (!window.confirm(t('occ.disconnectConfirm'))) return;
              dispatch({ type: 'UPDATE_SETTINGS', patch: { officialTeamId: null } });
            }}
          >
            {t('occ.disconnect')}
          </button>
        </>
      )}

      {err && <div className="warn-box mt8">⚠️ {err}</div>}
    </div>
  );
}

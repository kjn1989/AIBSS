import React, { useEffect, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { liveShareGet, liveShareCreate, liveUrl, createInvite, inviteUrl } from '../lib/officialCloud.js';
import { buildTeamKit } from '../lib/teamKit.js';
import Sheet from './Sheet.jsx';

// チームに配る案内を作る(管理者だけ)。
// 全員向け(観戦リンク)と記録係向け(ログイン情報＋記録員リンク)を分けて、LINEにそのまま貼れる文にする。
// 記録係のパスワードは文を作るためだけに使い、どこにも保存しない。
export default function TeamKitSheet({ teamId, onClose, onSent }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [live, setLive] = useState(undefined); // undefined=確認中 / null=まだ無い
  const [scorer, setScorer] = useState(null); // { url, expiresAt }
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let alive = true;
    liveShareGet(teamId).then((tk) => alive && setLive(tk || null), () => alive && setLive(null));
    // 記録員リンクは開くたびに新しく作る(14日で切れるので、配る直前に作るのがいちばん長く使える)
    createInvite(teamId, 'scorer').then(
      (tk) => alive && setScorer({ url: inviteUrl(tk, lang), expiresAt: Date.now() + 14 * 86400000 }),
      (e) => alive && setErr(e.message || String(e)),
    );
    return () => { alive = false; };
  }, [teamId, lang]);

  const makeLive = async () => {
    setBusy(true); setErr('');
    try { setLive(await liveShareCreate(teamId)); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  const kit = buildTeamKit({
    team: state.settings.teamName, lang,
    liveUrl: live ? liveUrl(live, lang) : '',
    scorerUrl: scorer?.url || '', expiresAt: scorer?.expiresAt,
    email: email.trim(), password,
  });

  const copy = (key, text) => {
    const done = () => { setCopied(key); onSent?.(); setTimeout(() => setCopied(''), 1800); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  };
  const share = (text) => navigator.share?.({ text }).then(() => onSent?.()).catch(() => {});

  const block = (key, title, desc, text) => (
    <div className="kit-block">
      <div className="kit-title">{title}</div>
      <p className="small dim" style={{ margin: '0 0 6px' }}>{desc}</p>
      <textarea className="kit-text" readOnly value={text} rows={Math.min(14, text.split('\n').length + 1)} onFocus={(e) => e.target.select()} />
      <div className="grid2 mt8">
        <button className="primary" onClick={() => copy(key, text)}>{copied === key ? t('livelink.copied') : t('kit.copy')}</button>
        {navigator.share ? <button onClick={() => share(text)}>{t('kit.share')}</button> : <span />}
      </div>
    </div>
  );

  return (
    <Sheet title={t('kit.title')} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('kit.desc')}</p>

      {live === undefined && <p className="small dim">{t('occ.busy')}</p>}
      {live === null && (
        <button className="primary" style={{ width: '100%' }} disabled={busy} onClick={makeLive}>{t('kit.makeLive')}</button>
      )}
      {live && block('all', t('kit.allTitle'), t('kit.allDesc'), kit.all)}

      <div className="kit-block">
        <div className="kit-title">{t('kit.scorerTitle')}</div>
        <p className="small dim" style={{ margin: '0 0 6px' }}>{t('kit.loginDesc')}</p>
        <input type="email" autoComplete="off" placeholder={t('kit.emailPh')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="text" autoComplete="off" className="mt8" placeholder={t('kit.passwordPh')} value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="small dim" style={{ margin: '4px 0 8px' }}>{t('kit.passwordNote')}</p>
        {!scorer && !err && <p className="small dim">{t('occ.busy')}</p>}
        {scorer && (
          <>
            <textarea className="kit-text" readOnly value={kit.scorer} rows={Math.min(16, kit.scorer.split('\n').length + 1)} onFocus={(e) => e.target.select()} />
            <div className="grid2 mt8">
              <button className="primary" onClick={() => copy('scorer', kit.scorer)}>{copied === 'scorer' ? t('livelink.copied') : t('kit.copy')}</button>
              {navigator.share ? <button onClick={() => share(kit.scorer)}>{t('kit.share')}</button> : <span />}
            </div>
            <div className="warn-box mt8">{t('kit.scorerWarn')}</div>
          </>
        )}
      </div>
      {err && <div className="warn-box mt8">{err}</div>}
      <div className="sheet-actions"><button onClick={onClose}>{t('action.close')}</button></div>
    </Sheet>
  );
}

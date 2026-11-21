import { useEffect, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { liveShareGet, liveShareCreate, liveShareRevoke, liveUrl } from '../lib/officialCloud.js';
import QRCode from './QRCode.jsx';
import Sheet from './Sheet.jsx';

// ライブ観戦リンクの作成・コピー・停止(supabase/live_share.sql)。
// リンクを開いた人は、ログインなしで、そのチームの試合のスコアと打席を見られる(読み取り専用)。
export default function LiveLinkPanel({ teamId }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [token, setToken] = useState(undefined); // undefined = 確認中 / null = まだ無い
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    liveShareGet(teamId).then((tk) => alive && setToken(tk), (e) => { if (alive) { setToken(null); setErr(e.message); } });
    return () => { alive = false; };
  }, [teamId]);

  const run = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };
  const url = token ? liveUrl(token, lang) : '';
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => {});
  };
  const share = () => navigator.share?.({ title: t('livelink.shareTitle'), text: t('livelink.shareText'), url }).catch(() => {});

  return (
    <div className="live-link">
      <p className="small dim" style={{ marginTop: 0 }}>{t('livelink.desc')}</p>
      {token === undefined && <p className="small dim">{t('occ.busy')}</p>}
      {token === null && (
        <button className="primary" style={{ width: '100%' }} disabled={busy} onClick={() => run(async () => setToken(await liveShareCreate(teamId)))}>
          {t('livelink.create')}
        </button>
      )}
      {token && (
        <>
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('livelink.title')} />
          <div className="grid2 mt8">
            <button className="primary" onClick={copy}>{copied ? t('livelink.copied') : t('livelink.copy')}</button>
            {navigator.share
              ? <button onClick={share}>{t('livelink.share')}</button>
              : <button onClick={() => setShowQr(!showQr)}>{showQr ? t('occ.hideQr') : t('occ.showQr')}</button>}
          </div>
          {navigator.share && <button className="small mt8" onClick={() => setShowQr(!showQr)}>{showQr ? t('occ.hideQr') : t('occ.showQr')}</button>}
          {showQr && <div className="qr-box"><QRCode text={url} /><span className="small dim">{t('livelink.qrHint')}</span></div>}
          <div className="warn-box mt8">{t('livelink.warn')}</div>
          <button
            className="small ghost danger mt8"
            disabled={busy}
            onClick={() => window.confirm(t('livelink.stopConfirm')) && run(async () => { await liveShareRevoke(teamId); setToken(null); setShowQr(false); })}
          >
            {t('livelink.stop')}
          </button>
        </>
      )}
      {err && <div className="warn-box mt8">{err}</div>}
    </div>
  );
}

// スコア入力画面から1タップで開くシート版
export function LiveLinkSheet({ teamId, onClose }) {
  const t = useT();
  return (
    <Sheet title={t('livelink.title')} onClose={onClose}>
      <LiveLinkPanel teamId={teamId} />
      <div className="sheet-actions"><button className="primary" onClick={onClose}>{t('action.close')}</button></div>
    </Sheet>
  );
}

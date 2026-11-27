import React, { useEffect, useRef, useState } from 'react';
import { useStore, useT, usePlayerName } from '../state/store.jsx';
import { livePresence, liveCheer, teamLiveStats, CHEER_STAMPS, CHEER_EMOJI } from '../lib/officialCloud.js';
import { renderPlayLog } from '../lib/playLogText.js';

// ============================================================
// 観戦中の人数と応援スタンプ(supabase/live_cheer.sql)
//
// ・スタンプは「直前のプレー」に付く。どの打席でスタンドが沸いたかが残り、
//   打席ごとの数と「応援が集まったプレー」の順位になる
// ・短い間にたくさん押されると「スタンドが沸いています」が記録係の画面にも出る。
//   ベンチにいる選手が、見ている人の熱を感じられるように
// ・文章は送れない(決まったスタンプだけ)。荒らしようがない形にしてある
// ============================================================

const POLL_MS = 4000;
const HYPE_MIN = 8; // 1回の取得(約4秒)でこれ以上の新しいスタンプが来たら「沸いた」

// 打席の記録だけ(スタンプを付ける相手)
const isPlay = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');
export const lastPlayOf = (game) => [...(game?.playLogs || [])].reverse().find(isPlay) || null;

// この端末の観戦者番号(使い捨て。名前などとは結び付かない)
const VKEY = 'bbscorer.viewerId';
export function viewerId() {
  try {
    let v = localStorage.getItem(VKEY);
    if (!v) { v = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(VKEY, v); }
    return v;
  } catch {
    return `v-${Math.random().toString(36).slice(2, 12)}`;
  }
}

// 数秒おきに人数とスタンプを取りに行く。fetcher(since) が null を返したら(SQL未設定)何も出さない
export function useCheerFeed(fetcher, key, myViewer = null) {
  const [feed, setFeed] = useState(null); // { viewers, total, byLog: {logId: {stamp: n}}, top }
  const [floats, setFloats] = useState([]); // 画面に流すスタンプ
  const [hype, setHype] = useState(false);
  const since = useRef(0);
  const fRef = useRef(fetcher);
  fRef.current = fetcher;

  const pushFloats = (stamps) => {
    if (!stamps.length) return;
    const now = Date.now();
    const add = stamps.slice(-14).map((s, i) => ({ id: `${now}-${i}-${Math.random()}`, s, x: 8 + Math.random() * 84, d: i * 120 }));
    setFloats((f) => [...f, ...add].slice(-30));
    setTimeout(() => setFloats((f) => f.filter((x) => !add.includes(x))), 2600 + add.length * 120);
  };

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    let timer = null;
    since.current = 0;
    let first = true;
    const tick = async () => {
      try {
        const r = await fRef.current(since.current);
        if (!alive) return;
        if (r && !r.error) {
          const byLog = {};
          for (const c of r.cheers || []) {
            (byLog[c.log || ''] ||= {})[c.stamp] = Number(c.n) || 0;
          }
          const top = Object.entries(byLog)
            .filter(([log]) => log)
            .map(([log, m]) => ({ log, m, n: Object.values(m).reduce((a, b) => a + b, 0) }))
            .sort((a, b) => b.n - a.n)
            .slice(0, 3);
          setFeed({ viewers: Number(r.viewers) || 0, total: Number(r.total) || 0, byLog, top });
          const recent = (r.recent || []).filter((x) => !myViewer || x.viewer !== myViewer);
          if (r.now) since.current = Number(r.now);
          // 開いた直後に過去のスタンプをまとめて流さない
          if (!first) {
            pushFloats(recent.map((x) => x.stamp));
            if (recent.length >= HYPE_MIN) { setHype(true); setTimeout(() => setHype(false), 3500); }
          }
          first = false;
        }
      } catch { /* 次の周期で取り直す */ }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { feed, floats, hype, pushFloats };
}

// 流れていくスタンプと「沸いた」の帯
export function CheerOverlay({ floats, hype }) {
  const t = useT();
  return (
    <>
      <div className="cheer-floats" aria-hidden="true">
        {floats.map((f) => (
          <span key={f.id} className="cheer-float" style={{ left: `${f.x}%`, animationDelay: `${f.d}ms` }}>{CHEER_EMOJI[f.s] || '👏'}</span>
        ))}
      </div>
      {hype && <div className="cheer-hype" role="status">{t('cheer.hype')}</div>}
    </>
  );
}

// 打席ごとのスタンプの数(試合経過の行の後ろに出す)
export function CheerCounts({ m }) {
  if (!m) return null;
  const items = CHEER_STAMPS.filter((s) => m[s]);
  if (!items.length) return null;
  return (
    <span className="cheer-counts">
      {items.map((s) => <span key={s}>{CHEER_EMOJI[s]}{m[s]}</span>)}
    </span>
  );
}

// 観戦ページの人数
export function ViewerCount({ n }) {
  const t = useT();
  if (!n) return null;
  return <span className="viewer-count">{t('cheer.viewers', { n })}</span>;
}

// 応援が集まったプレー TOP3
export function CheerTop({ game, top }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const lang = state.settings.lang || 'ja';
  const rows = (top || []).map((x) => ({ ...x, l: (game.playLogs || []).find((l) => l.id === x.log) })).filter((x) => x.l);
  if (!rows.length) return null;
  return (
    <div className="card cheer-top">
      <h2>{t('cheer.topTitle')}</h2>
      {rows.map((x, i) => (
        <div className="log-line" key={x.log}>
          <b>{['🥇', '🥈', '🥉'][i]}</b>{' '}
          {t('score.logInning', { inning: x.l.inning, half: t(x.l.isTop ? 'half.top' : 'half.bottom') })}{' '}
          {renderPlayLog(game, x.l, { lang, t, nameOf, edition: state.settings.edition })}
          <CheerCounts m={x.m} />
        </div>
      ))}
    </div>
  );
}

// 観戦ページの下に固定するスタンプのボタン
export function CheerBar({ token, game, onSent }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const lang = state.settings.lang || 'ja';
  const [note, setNote] = useState('');
  const last = lastPlayOf(game);
  if (!game || !last) return null;
  const send = async (s) => {
    onSent?.(s);
    try {
      const r = await liveCheer(token, viewerId(), game.id, last.id, s);
      if (r?.error === 'too_many') { setNote(t('cheer.tooMany')); setTimeout(() => setNote(''), 3000); }
    } catch { /* 届かなくても観戦は続ける */ }
  };
  return (
    <div className="cheer-bar">
      <div className="cheer-target small">
        {note || <>{t('cheer.target')} <b>{renderPlayLog(game, last, { lang, t, nameOf, edition: state.settings.edition })}</b></>}
      </div>
      <div className="cheer-buttons">
        {CHEER_STAMPS.map((s) => (
          <button key={s} type="button" onClick={() => send(s)} aria-label={t(`cheer.s.${s}`)}>{CHEER_EMOJI[s]}</button>
        ))}
      </div>
    </div>
  );
}

// 記録係・見るだけの端末の画面に出す、観戦の人数と応援
export function CheerStrip({ game }) {
  const { state } = useStore();
  const t = useT();
  const teamId = state.settings.officialTeamId;
  const on = !!teamId && game?.status === 'ongoing' && state.cloudStatus === 'on';
  const { feed, floats, hype } = useCheerFeed(
    (since) => teamLiveStats(teamId, game.id, since),
    on ? `${teamId}:${game.id}` : null,
  );
  if (!on || !feed) return null;
  const last = lastPlayOf(game);
  const lastM = last ? feed.byLog[last.id] : null;
  return (
    <>
      <div className="cheer-strip small">
        <span>{t('cheer.viewers', { n: feed.viewers })}</span>
        {feed.total > 0 && <span className="dim">{t('cheer.total', { n: feed.total })}</span>}
        {lastM && <span className="dim">{t('cheer.lastPlay')}<CheerCounts m={lastM} /></span>}
      </div>
      <CheerOverlay floats={floats} hype={hype} />
    </>
  );
}

// 観戦ページで使う: 人数・スタンプの取得
export function useViewerCheer(token, game) {
  const me = viewerId();
  return useCheerFeed(
    (since) => livePresence(token, me, game?.id || null, since),
    token && game?.id ? `${token}:${game.id}` : null,
    me,
  );
}

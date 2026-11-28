import React, { useEffect, useRef, useState } from 'react';
import { useStore, useT, usePlayerName } from '../state/store.jsx';
import { livePresence, liveCheer, teamLiveStats, CHEER_STAMPS, CHEER_EMOJI, CHEER_COST, CHEER_WALLET } from '../lib/officialCloud.js';
import { renderPlayLog } from '../lib/playLogText.js';
import { cheerSummary, playersFromLogs, recipientOf } from '../lib/cheerSummary.js';

export { cheerSummary, playersFromLogs, recipientOf };

// ============================================================
// 観戦中の人数と応援スタンプ(supabase/live_cheer.sql)
//
// ・スタンプは「直前のプレー」に付く。どの打席でスタンドが沸いたかが残り、
//   打席ごとの数と「応援が集まったプレー」の順位になる
// ・短い間にたくさん押されると「スタンドが沸いています」が記録係の画面にも出る。
//   ベンチにいる選手が、見ている人の熱を感じられるように
// ・文章は送れない(決まったスタンプだけ)。荒らしようがない形にしてある
// ・投げ銭の代わりの「応援コイン」: 観戦者は1試合50コイン。🔥⚾🏆 はコインを使って
//   そのプレーの選手に贈る(👏😱 は無料で何度でも)。数に限りがあるので、贈ること自体に意味が出る。
//   選手ごとの応援コインは「応援コインランキング」と推定年俸のボーナスになる。お金は動かない
// ============================================================

const POLL_MS = 4000;

// 記録係の画面で、取りに行った応援を「試合経過」の行にも出すための小さな置き場。
// CheerStrip が取りに行き、ほかの場所(試合経過の行)は読むだけ。取りに行くのは1か所だけにする
const feedStore = { byGame: new Map(), subs: new Set() };
function publishFeed(gameId, feed) {
  feedStore.byGame.set(gameId, feed);
  feedStore.subs.forEach((f) => f());
}
export function useCheerByLog(gameId) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    feedStore.subs.add(f);
    return () => { feedStore.subs.delete(f); };
  }, []);
  return feedStore.byGame.get(gameId)?.byLog || null;
}
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

  const [ticker, setTicker] = useState([]); // 最近のスタンプ(新しい順・最大8)
  // stamps: 'clap' か { s, label }(コインのスタンプは贈った相手の名前を添える)
  const pushFloats = (stamps) => {
    if (!stamps.length) return;
    const now = Date.now();
    const add = stamps.slice(-14).map((x, i) => {
      const o = typeof x === 'string' ? { s: x } : x;
      return { id: `${now}-${i}-${Math.random()}`, s: o.s, player: o.player || null, x: 8 + Math.random() * 78, d: i * 120 };
    });
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
          const { byLog, top, players, total } = cheerSummary(r);
          setFeed({ viewers: Number(r.viewers) || 0, total, byLog, top, players, wallet: r.wallet == null ? null : Number(r.wallet) });
          const recent = (r.recent || []).filter((x) => !myViewer || x.viewer !== myViewer);
          if (r.now) since.current = Number(r.now);
          // 開いた直後に過去のスタンプをまとめて流さない
          if (recent.length) {
            setTicker((tk) => [...recent.map((x) => ({ s: x.stamp, player: x.player || null, at: x.at })).reverse(), ...tk].slice(0, 8));
          }
          if (!first) {
            pushFloats(recent.map((x) => ({ s: x.stamp, player: x.player || null })));
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

  // 送った直後に残りコインを画面だけ先に減らす(次の取得で正しい値に戻る)
  const spend = (n) => setFeed((f) => (f && f.wallet != null ? { ...f, wallet: Math.max(0, f.wallet - n) } : f));
  return { feed, floats, hype, pushFloats, spend, ticker };
}

// 流れていくスタンプと「沸いた」の帯
export function CheerOverlay({ floats, hype }) {
  const t = useT();
  const nameOf = usePlayerName();
  return (
    <>
      <div className="cheer-floats" aria-hidden="true">
        {floats.map((f) => (
          <span key={f.id} className="cheer-float" style={{ left: `${f.x}%`, animationDelay: `${f.d}ms` }}>
            {CHEER_EMOJI[f.s] || '👏'}
            {/* コインのスタンプは、誰に贈られたかを添える */}
            {f.player && CHEER_COST[f.s] > 0 && <small className="cheer-float-to">{nameOf(f.player)}</small>}
          </span>
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
export function CheerBar({ token, game, wallet, onSent }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const lang = state.settings.lang || 'ja';
  const [note, setNote] = useState('');
  const last = lastPlayOf(game);
  if (!game || !last) return null;
  const to = recipientOf(last);
  const left = wallet == null ? CHEER_WALLET : wallet;
  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 3000); };
  const send = async (s) => {
    const cost = CHEER_COST[s] || 0;
    if (cost > 0 && !to) { flash(t('cheer.noTarget')); return; }
    if (cost > left) { flash(t('cheer.noCoins')); return; }
    onSent?.(s, cost);
    try {
      const r = await liveCheer(token, viewerId(), game.id, last.id, s, to);
      if (r?.error === 'no_coins') flash(t('cheer.noCoins'));
    } catch { /* 届かなくても観戦は続ける */ }
  };
  return (
    <div className="cheer-bar">
      <div className="cheer-target small">
        {note || (
          <>
            {to ? <>{t('cheer.to', { name: nameOf(to) })} </> : null}
            <span className="dim">{renderPlayLog(game, last, { lang, t, nameOf, edition: state.settings.edition })}</span>
          </>
        )}
      </div>
      <div className="cheer-buttons">
        {CHEER_STAMPS.map((s) => {
          const cost = CHEER_COST[s] || 0;
          const off = cost > 0 && (cost > left || !to);
          return (
            <button key={s} type="button" className={off ? 'off' : ''} onClick={() => send(s)} aria-label={t(`cheer.s.${s}`)}>
              <span className="cb-emoji">{CHEER_EMOJI[s]}</span>
              {/* コインのスタンプは「あと何回送れるか」を出す。👏😱 は回数に制限が無い */}
              <span className="cb-cost">{cost ? t('cheer.left', { n: Math.floor(left / cost) }) : t('cheer.unlimited')}</span>
            </button>
          );
        })}
      </div>
      <div className="cheer-wallet small dim">{t('cheer.wallet', { n: left, max: CHEER_WALLET })}</div>
    </div>
  );
}

// 選手ごとの応援コイン(この試合)
export function CheerPlayers({ players }) {
  const t = useT();
  const nameOf = usePlayerName();
  const rows = (players || []).filter((x) => x.coins > 0).slice(0, 5);
  if (!rows.length) return null;
  return (
    <div className="card cheer-players">
      <h2>{t('cheer.playersTitle')}</h2>
      {rows.map((x, i) => (
        <div className="row" key={x.id}>
          <span className="rank-badge">{i + 1}</span>
          <div className="grow"><b>{nameOf(x.id)}</b></div>
          <b className="cheer-coins">🪙 {x.coins}</b>
        </div>
      ))}
      <p className="small dim">{t('cheer.playersNote')}</p>
    </div>
  );
}

// 記録係・見るだけの端末の画面に出す、観戦の人数と応援
export function CheerStrip({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const teamId = state.settings.officialTeamId;
  const on = !!teamId && game?.status === 'ongoing' && state.cloudStatus === 'on';
  const { feed, floats, hype, ticker } = useCheerFeed(
    (since) => teamLiveStats(teamId, game.id, since),
    on ? `${teamId}:${game.id}` : null,
  );
  useEffect(() => { if (feed && game?.id) publishFeed(game.id, feed); }, [feed, game?.id]);
  if (!on || !feed) return null;
  const last = lastPlayOf(game);
  const lastM = last ? feed.byLog[last.id] : null;
  // 応援王はプレーから数え直す(統合した選手も、いまの名前で出る)
  const king = (playersFromLogs(game, feed.byLog) || feed.players || [])[0];
  return (
    <>
      <div className="cheer-strip small">
        <span>{t('cheer.viewers', { n: feed.viewers })}</span>
        {feed.total > 0 && <span className="dim">{t('cheer.total', { n: feed.total })}</span>}
        {lastM && <span className="dim">{t('cheer.lastPlay')}<CheerCounts m={lastM} /></span>}
        {king?.coins > 0 && <span className="dim">{t('cheer.king', { name: nameOf(king.id), n: king.coins })}</span>}
      </div>
      {/* 届いたばかりの応援(新しい順)。記録しながらでも、横目で見られる1行だけ */}
      {ticker.length > 0 && (
        <div className="cheer-ticker small" aria-live="polite">
          {ticker.map((x, i) => (
            <span key={`${x.at}-${i}`}>
              {CHEER_EMOJI[x.s] || '👏'}
              {x.player && CHEER_COST[x.s] > 0 && <b>{nameOf(x.player)}</b>}
            </span>
          ))}
        </div>
      )}
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

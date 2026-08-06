import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DIRECTIONS } from '../lib/model.js';
import { useT } from '../state/store.jsx';
import {
  padPointToBall, ballToPadPoint, nearestDirection, depthBand,
  POS_BALL, POS_PAD, PAD_FENCE, DEPTH_BANDS,
} from '../lib/battedBall.js';

// ============================================================
// 打球の落下点を選ぶパッド
//
// フィールドのどこを押しても記録できる。角度で方向が、本塁からの距離で
// 深さが決まる。ただし初見では「押せるのは9つのチップだけ」に見えてしまう。
// 白く大きなチップが画面でいちばん目立つのが原因だったので、次のようにした:
//
//   - 深さの目盛りを図の横に立てる。上下方向に意味があることが一目で分かり、
//     図が「背景」ではなく「計器」になる
//   - チップは小さく半透明に。空いている芝のほうが押せる場所に見えるようにする
//     (速く済ませたい人のための近道としては残す)
//   - 押した点にボールが落ちてくる。0.5秒見せてから畳む。
//     自分の押した点を一度も見ないまま次に進むのが、いちばん分かりにくかった
//   - 押したまま指を動かすと追いかけてくる。位置そのものがデータだと伝わる
//   - 各試合の最初の打席だけ、図の上に説明を重ねる
//
// 縮尺は実際の球場に合わせ、フェンスの外にスタンドを描く。
// 柵が図の外周だと本塁打を押す場所が無かった。詳しくは battedBall.js。
// ============================================================

const OUTFIELD = ['LF', 'CF', 'RF'];
// 説明を最後に出した試合のID。試合が変われば、その試合の最初の打席でまた出す。
// 一度きりにすると、久しぶりの試合や交代した記録係には届かない。
// 一方で毎打席出すとただの邪魔になるので、1試合1回にする。
const HINT_KEY = 'bbscorer.hint.fieldpad.game';

// 深さ(フェンスまでを1)→ パッド幅に対する円の直径(%)
const dia = (d) => d * PAD_FENCE * 200;
// 深さ → パッド上端からの位置(%)。目盛りの行を置くのに使う
const topOf = (d) => ballToPadPoint(0, d).fy * 100;

export function resetFieldPadHint() {
  try { localStorage.removeItem(HINT_KEY); } catch { /* 使えなくても支障はない */ }
}
function hintSeenInGame(gameId) {
  if (!gameId) return true; // 試合が分からないときは出さない(取り込み画面等)
  try { return localStorage.getItem(HINT_KEY) === String(gameId); } catch { return true; }
}
function markHintSeen(gameId) {
  try { localStorage.setItem(HINT_KEY, String(gameId || '')); } catch { /* 出し続けても害はない */ }
}

// ---- ルーペ ----
// 置き場所の決まりはひとつだけ: 「指の真上」。例外を作らない。
//
// 以前は上に入らなければ横へ逃がしていたが、パッドの上端は画面の y=249 で、
// レンズ(116)+すき間 が入らない領域が外野ぜんぶに広がっていた。つまり
// 「例外」のはずの横配置が、いちばんよく押す打球で毎回発動していた。
// 左を押せば右に、右を押せば左に出るので、出るたびに探すことになる。
// しかも指と同じ高さなので、本物の打点とレンズの中の点が並んで見えて
// どちらが自分の指か分からない。
//
// パッドの上には画面の上端まで 249px 空いている。シートの中に閉じ込めず
// body へ portal して画面座標で置けば、どこを押しても必ず上に入る。
const LOUPE = 116;      // レンズの直径。指の腹(約40px)より十分大きく取る
const LOUPE_ZOOM = 2.3;
const LOUPE_GAP = 26;   // 指先とレンズ下端のすき間 = 茎の長さ
const LOUPE_CAP = 22;   // レンズの上に載せる読み上げの高さ
const LOUPE_EDGE = 6;   // 画面端に残す余白

// フィールドの絵。本体とルーペの両方で同じものを描くために切り出す。
// ルーペ側は拡大して覗くだけなので、押せる必要はない(span で描く)。
function FieldScene({ t, keys, value, live = false }) {
  const Chip = live ? 'button' : 'span';
  return (
    <>
      {/* 外周はスタンド。柵の外を描くことで本塁打を押す場所ができる */}
      <div className="bf-grass" style={{ width: `${dia(1)}%` }} />
      <div className="bf-track" style={{ width: `${dia(1)}%` }} />
      <div className="bf-grass" style={{ width: `${dia(0.955)}%` }} />
      <div className="bf-dirtfan" style={{ width: `${dia(0.47)}%` }} />
      <div className="bf-mound" />
      <div className="bf-line left" />
      <div className="bf-line right" />
      <div className="bf-basepath" />
      <div className="bf-base b2" />
      <div className="bf-base b3" />
      <div className="bf-base b1" />
      {DEPTH_BANDS.slice(0, -2).map((b) => (
        <div key={b.key} className="bf-ring" style={{ width: `${dia(b.max)}%` }} />
      ))}
      <div className="bf-ring wall" style={{ width: `${dia(1)}%` }} />
      {keys.map((key) => (
        <Chip
          key={key}
          {...(live ? { type: 'button', 'data-k': key } : {})}
          className={`field-pos${value === key ? ' sel' : ''}`}
          style={{ left: `${POS_PAD[key].fx * 100}%`, top: `${POS_PAD[key].fy * 100}%` }}
        >
          {t(`dir.${key}`)}
        </Chip>
      ))}
    </>
  );
}

export default function FieldPad({ value, point, onChange, onDone, outfieldOnly = false, gameId }) {
  const t = useT();
  const ref = useRef(null);
  const timer = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [loupe, setLoupe] = useState(false); // 押し続けている間だけ出す
  // ルーペの拡大と配置に使う実寸(画面座標)。押している間は動かないので一度だけ測る
  const [size, setSize] = useState({ w: 0, h: 0, left: 0, top: 0, vw: 0 });
  const loupeTimer = useRef(null);
  const [coach, setCoach] = useState(() => !hintSeenInGame(gameId));
  const keys = Object.keys(DIRECTIONS).filter((k) => (outfieldOnly ? OUTFIELD.includes(k) : true));

  const commit = (fx, fy) => {
    const b = padPointToBall(fx, fy);
    if (b.foul) return; // ファウルゾーンは記録しない
    const dir = nearestDirection(b.angle, b.depth);
    if (outfieldOnly && !OUTFIELD.includes(dir)) return;
    onChange(dir, { angle: b.angle, depth: b.depth });
  };

  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const onDown = (e) => {
    if (coach) return;
    clearTimeout(timer.current);
    setDragging(true);
    const r = ref.current.getBoundingClientRect();
    setSize({ w: r.width, h: r.height, left: r.left, top: r.top, vw: window.innerWidth });
    // すぐ出すと、素早く押しただけのときに一瞬ちらつく。少しだけ待つ
    clearTimeout(loupeTimer.current);
    loupeTimer.current = setTimeout(() => setLoupe(true), 110);
    ref.current.setPointerCapture?.(e.pointerId);
    const chip = e.target.closest?.('.field-pos');
    if (chip) {
      const p = POS_PAD[chip.dataset.k];
      commit(p.fx, p.fy);
    } else {
      const [fx, fy] = at(e);
      commit(fx, fy);
    }
  };
  const onMove = (e) => {
    if (!dragging) return;
    const [fx, fy] = at(e);
    commit(fx, fy);
  };
  const onUp = () => {
    if (!dragging) return;
    setDragging(false);
    clearTimeout(loupeTimer.current);
    setLoupe(false);
    // ボールが落ちるのを見せてから畳む。押した点を一度も見ないのが分かりにくさの元だった
    if (onDone) timer.current = setTimeout(onDone, 520);
  };

  const marker = point && point.angle != null ? ballToPadPoint(point.angle, point.depth) : null;
  const band = point && point.depth != null ? depthBand(point.depth) : null;
  // 目盛りの行(外側から内側へ)。帯の真ん中に名前を置く
  const rulerRows = DEPTH_BANDS.map((b, i) => {
    const lo = i === 0 ? 0 : DEPTH_BANDS[i - 1].max;
    const hi = b.max === Infinity ? 1.18 : b.max;
    return { key: b.key, top: Math.max(2.5, Math.min(96, topOf((lo + hi) / 2))) };
  });

  return (
    <>
      <div className="pad-lead">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="1.9" fill="currentColor" />
        </svg>
        <span>{t('playsheet.tapField')}</span>
      </div>

      <div className="pad-frame">
        {/* 深さの目盛り。上下方向に意味があることを、図の外で先に言い切る */}
        <div className="pad-ruler" aria-hidden="true">
          <i className="axis" />
          {rulerRows.map((r) => (
            <span key={r.key} style={{ top: `${r.top}%` }}>{t(`depth.${r.key}`)}</span>
          ))}
        </div>

        <div
          className={`dir-pad field-pad bf-field bf${dragging ? ' dragging' : ''}`}
          ref={ref}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          role="application"
          aria-label={t('playsheet.direction')}
        >
          <FieldScene t={t} keys={keys} value={value} live />

          {/* 打点はチップより後に描く。チップの裏に隠れると、押した点が見えなくなる */}
          {marker && (
            <div className={`bf-mark${dragging ? '' : ' drop'}`} style={{ left: `${marker.fx * 100}%`, top: `${marker.fy * 100}%` }} />
          )}


          {coach && (
            <div className="pad-coach">
              <span
                className="ripple"
                style={{
                  left: `${ballToPadPoint(-24, 0.82).fx * 100}%`,
                  top: `${ballToPadPoint(-24, 0.82).fy * 100}%`,
                }}
              />
              <p>
                <b>{t('padHint.title')}</b>
                {t('padHint.body')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setCoach(false);
                  markHintSeen(gameId);
                }}
              >
                {t('padHint.ok')}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ルーペ。指がフィールドに重なると、どこを指しているのか自分で見えない。
          押している間だけ、指の真上に拡大して出す。
          - 例外なく真上。出る場所が毎回同じなら、探さずに視線が行く
          - レンズの下端から打点まで細い線(茎)を引く。離れた場所にある丸が
            「いま押している点」だと、線があれば一度で分かる
          - 読み上げはレンズの上。手からいちばん遠く、拡大した図も汚さない
          画面座標で置きたいので body へ portal する(シートの overflow に切られない) */}
      {loupe && marker && createPortal((() => {
        const fingerX = size.left + marker.fx * size.w;
        const fingerY = size.top + marker.fy * size.h;
        // 画面からはみ出さない範囲で、できるかぎり指の真上
        const cx = Math.max(
          LOUPE / 2 + LOUPE_EDGE,
          Math.min(size.vw - LOUPE / 2 - LOUPE_EDGE, fingerX),
        );
        const top = Math.max(LOUPE_EDGE, fingerY - LOUPE_GAP - LOUPE);
        return (
          <div className="pad-loupe-layer">
            {/* 茎。端に寄って真上に置けなかったときは少し傾き、打点を指し続ける */}
            <svg className="pad-loupe-stem" aria-hidden="true">
              <line
                x1={cx} y1={top + LOUPE} x2={fingerX} y2={fingerY}
                stroke="rgba(0,0,0,.5)" strokeWidth="4.5" strokeLinecap="round"
              />
              <line
                x1={cx} y1={top + LOUPE} x2={fingerX} y2={fingerY}
                stroke="#fff" strokeWidth="2" strokeLinecap="round"
              />
            </svg>
            <div className="pad-loupe" style={{ left: cx - LOUPE / 2, top }}>
              <div
                className="pad-loupe-scene bf-field bf"
                style={{
                  width: size.w, height: size.h,
                  transform: `scale(${LOUPE_ZOOM})`,
                  transformOrigin: '0 0',
                  left: LOUPE / 2 - LOUPE_ZOOM * marker.fx * size.w,
                  top: LOUPE / 2 - LOUPE_ZOOM * marker.fy * size.h,
                }}
              >
                <FieldScene t={t} keys={keys} value={value} />
              </div>
              <i className="pad-loupe-cross" />
            </div>
            <b className="pad-loupe-label" style={{ left: cx, top: top - LOUPE_CAP - 4 }}>
              {t(`dir.${value}`)}{band ? ` ${t(`depth.${band}`)}` : ''}
            </b>
          </div>
        );
      })(), document.body)}

      <div className="pad-readout">
        {value ? (
          <>
            <b>{t(`dir.${value}`)}</b>
            {band && <span className={`depth-pill${band === 'over' ? ' hr' : ''}`}>{t(`depth.${band}`)}</span>}
            <span className="dim small">{t(dragging ? 'playsheet.dragHint' : 'playsheet.willRecord')}</span>
          </>
        ) : (
          <span className="dim small">{t('playsheet.notTapped')}</span>
        )}
      </div>
    </>
  );
}

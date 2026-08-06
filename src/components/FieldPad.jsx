import React, { useRef, useState } from 'react';
import { DIRECTIONS } from '../lib/model.js';
import { useT } from '../state/store.jsx';
import {
  padPointToBall, ballToPadPoint, nearestDirection, depthBand, isFoul,
  POS_PAD, PAD_FENCE, DEPTH_BANDS,
  PAD_VB, PAD_MAX, PAD_FOUL_MAX, padArc, padSector, padWedge, padBandRange,
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
// 押している間は指が図に重なって、自分がどこを指しているのか見えない。
// 一度はルーペ(拡大鏡)を出したが、芝には拡大するほどの細部が無く、
// 図の1/3を覆うだけで情報が増えなかった。いまは指で隠れる半径の外側に
// 目印を出す方式にしている。幾何と考え方は battedBall.js を参照。
//
// 縮尺は実際の球場に合わせ、フェンスの外にスタンドを描く。
// 柵が図の外周だと本塁打を押す場所が無かった。
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

export default function FieldPad({
  value, point, onChange, onDone, outfieldOnly = false, allowFoul = false, gameId,
}) {
  const t = useT();
  const ref = useRef(null);
  const timer = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [coach, setCoach] = useState(() => !hintSeenInGame(gameId));
  const keys = Object.keys(DIRECTIONS).filter((k) => (outfieldOnly ? OUTFIELD.includes(k) : true));

  const commit = (fx, fy) => {
    const b = padPointToBall(fx, fy);
    // ファウルフライは凡打なので、ファウルグラウンドも押せる必要がある。
    // 一方でファウルの安打は無いので、結果によっては受け付けない
    if (b.foul && !allowFoul) return;
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
    // ボールが落ちるのを見せてから畳む。押した点を一度も見ないのが分かりにくさの元だった
    if (onDone) timer.current = setTimeout(onDone, 520);
  };

  const marker = point && point.angle != null ? ballToPadPoint(point.angle, point.depth) : null;
  const band = point && point.depth != null ? depthBand(point.depth) : null;
  // 目盛りの行(外側から内側へ)。帯の真ん中に名前を置く
  const rulerRows = DEPTH_BANDS.map((b, i) => {
    const lo = i === 0 ? 0 : DEPTH_BANDS[i - 1].max;
    const hi = b.max === Infinity ? PAD_MAX : b.max;
    return { key: b.key, top: Math.max(2.5, Math.min(96, topOf((lo + hi) / 2))) };
  });

  // 目印の幾何。押している間だけでなく、選ばれている間ずっと出す。
  // ファウルは方向のくさびを持たない(区画はフェアゾーンの5分割なので)
  const foul = marker ? isFoul(point.angle) : false;
  const wedge = marker && !foul ? padWedge(point.angle) : null;
  const range = marker ? padBandRange(point.depth) : null;
  const spot = marker ? { left: `${marker.fx * 100}%`, top: `${marker.fy * 100}%` } : null;
  const depthArc = marker ? padArc(-45, 45, Math.min(point.depth, PAD_MAX)) : null;

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
        {/* 深さの目盛り。上下方向に意味があることを、図の外で先に言い切る。
            いまいる帯だけ白く光らせる。手が絶対に来ない場所にある読み札 */}
        <div className="pad-ruler" aria-hidden="true">
          <i className="axis" />
          {rulerRows.map((r) => (
            <span key={r.key} className={r.key === band ? 'lit' : ''} style={{ top: `${r.top}%` }}>
              {t(`depth.${r.key}`)}
            </span>
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

          {/* ファウルグラウンド。ファウルフライを押せる結果のときは
              「使える地面」に、そうでないときは沈めて押せないと分かるように。
              芝の円をそのまま敷いていた頃は、ファウル側もフェアと同じ緑で、
              押しても記録されない場所が押せそうに見えていた */}
          <svg
            className={`bf-foulground${allowFoul ? ' on' : ''}`}
            viewBox={`0 0 ${PAD_VB.w} ${PAD_VB.h}`}
            aria-hidden="true"
          >
            <path d={padSector(-PAD_FOUL_MAX, -45, 0, PAD_MAX)} />
            <path d={padSector(45, PAD_FOUL_MAX, 0, PAD_MAX)} />
          </svg>
          {allowFoul && (
            <>
              <i className="bf-foultag left">{t('dir.foul')}</i>
              <i className="bf-foultag right">{t('dir.foul')}</i>
            </>
          )}

          {/* 粗い層: いまいる深さの帯と方向のくさびが光る。
              指が点に乗っていても、図の広い面積が「何が記録されるか」を答える。
              図の座標なので拡大縮小に追随してほしく、SVG で描く */}
          {marker && (
            <svg className="bf-overlay" viewBox={`0 0 ${PAD_VB.w} ${PAD_VB.h}`} aria-hidden="true">
              <path className="bf-band" d={padSector(-45, 45, range.dIn, range.dOut)} />
              {wedge && <path className="bf-wedge" d={padSector(wedge.a1, wedge.a2, 0, 1)} />}
              {wedge && <path className="bf-cell" d={padSector(wedge.a1, wedge.a2, range.dIn, range.dOut)} />}
              {/* 帯は「定位置」までしか言えない。いまの正確な深さを弧1本で足す。
                  この弧はそのまま左の目盛りへ届く */}
              <path className="bf-depth back" d={depthArc} />
              <path className="bf-depth" d={depthArc} />
            </svg>
          )}

          {keys.map((key) => (
            <button
              key={key}
              type="button"
              data-k={key}
              className={`field-pos${value === key ? ' sel' : ''}`}
              style={{ left: `${POS_PAD[key].fx * 100}%`, top: `${POS_PAD[key].fy * 100}%` }}
            >
              {t(`dir.${key}`)}
            </button>
          ))}

          {/* 精密な層: 打点を中心にした同心円。中心が指で隠れても、
              輪の対称性から目が中心を復元する。
              指の大きさは画面の広さで変わらないので、こちらは実寸(px)で描く */}
          {marker && (
            <>
              <i className="bf-ripple r3" style={spot} />
              <i className="bf-ripple r2" style={spot} />
              <i className="bf-ripple r1" style={spot} />
              {dragging && <i className="bf-ping" style={spot} />}
            </>
          )}

          {/* 方向名はセンター奥のスタンドに固定する。どこを押しても同じ場所。
              打点に合わせて動かしていた頃は、一塁・三塁で札が枠の外へ出て
              字が切れた。位置で方向を示す役目はくさびが担っているので、
              札は名前を言う役に徹してよく、動かす必要がない。
              フェンスの頂点(PAD_STANDS_TOP)より上はどの横位置も芝が無いので、
              札がどれだけ長くても図には被らない */}
          {marker && value && (
            <b className={`bf-dirlabel${foul ? ' foul' : ''}`}>
              {foul ? `${t('dir.foul')} ${t(`dir.${value}`)}` : t(`dir.${value}`)}
            </b>
          )}

          {/* 打点はチップより後に描く。チップの裏に隠れると、押した点が見えなくなる */}
          {marker && (
            <div className={`bf-mark${dragging ? '' : ' drop'}`} style={spot} />
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

      <div className="pad-readout">
        {value ? (
          <>
            <b>{t(`dir.${value}`)}</b>
            {foul && <span className="depth-pill foul">{t('dir.foul')}</span>}
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

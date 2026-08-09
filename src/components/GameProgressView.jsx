import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, SO_TYPES, resultCategory, multiOutLabel, outTypeLabel, allowsFoul } from '../lib/model.js';
import FieldPad from './FieldPad.jsx';
import BattedBallPad from './BattedBallPad.jsx';
import { depthBand, isFoul } from '../lib/battedBall.js';

// バットに当たって前に飛んだ結果か。三振・四球に直すときは軌道と強さを消す
const BATTED_BALL_RESULTS = new Set(['single', 'double', 'triple', 'hr', 'out', 'error', 'sacBunt', 'sacFly']);
import { playLabel } from '../lib/voiceParser.js';
import { computeBoxScore } from '../lib/boxscore.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitutions, parseBatterReassignments, parseResultCorrections, assignResultTargets, mergeResultCorrections, parsePositionCorrections, parseDefensiveAlignment, parsePositionSwaps, parseSlotBatters, parseAtBatDeletions, isExplicitSubText, explicitOrderChange, inGamePlayerIds, preferInGamePlayers } from '../lib/correctionParser.js';
import { posFull, buildLineupRows, findPositionIssues, alignmentByInning } from '../lib/lineupBox.js';
import { findDuplicateAtBats, canRebuildOrders, findOrderBreaks } from '../lib/battersRebuild.js';
import { oppNameOf } from '../lib/oppBox.js';
import { interpretCorrection } from '../lib/gemini.js';
import Sheet from './Sheet.jsx';
import FullscreenView from './FullscreenView.jsx';

// 塁上の走者を丸で示す簡易ダイヤモンド(そのプレイ開始時点の状況)
function MiniDiamond({ runners }) {
  const on = (b) => (runners ? !!runners[b] : false);
  return (
    <svg viewBox="0 0 40 40" width="32" height="32" className="mini-diamond">
      <polygon points="20,6 34,20 20,34 6,20" fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle cx="20" cy="6" r="4.5" fill={on(2) ? 'var(--gold)' : 'var(--bg-3)'} stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="34" cy="20" r="4.5" fill={on(1) ? 'var(--gold)' : 'var(--bg-3)'} stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="6" cy="20" r="4.5" fill={on(3) ? 'var(--gold)' : 'var(--bg-3)'} stroke="var(--border)" strokeWidth="1.5" />
    </svg>
  );
}

// B-S-O のカウント表示(データがない旧プレイでは何も出さない)
function CountDots({ balls, strikes, outsBefore }) {
  if (balls === undefined || balls === null) return null;
  return (
    <div className="mini-count">
      <div><b>B</b>{[0, 1, 2].map((i) => <i key={i} className={`mc-dot ball${i < balls ? ' on' : ''}`} />)}</div>
      <div><b>S</b>{[0, 1].map((i) => <i key={i} className={`mc-dot strike${i < strikes ? ' on' : ''}`} />)}</div>
      <div><b>O</b>{[0, 1].map((i) => <i key={i} className={`mc-dot out${i < outsBefore ? ' on' : ''}`} />)}</div>
    </div>
  );
}

// 打席系プレイ(kind: atbat/defense)の1件カード
function PlayCard({ log, nameOf, numberOf, onEdit, edition, lang, t, oppName }) {
  const p = log.payload || {};
  const isDefense = log.kind === 'defense';
  // 相手打者は記号(A〜)で記録されるが、名前を入れてあればそちらを見せる
  const name = isDefense ? (oppName ? oppName(p.letter) : p.letter) : nameOf(p.playerId);
  const number = isDefense ? null : numberOf(p.playerId);
  const category = resultCategory(p.result);
  const label = playLabel(p.result, p.direction, p.outType, p.soType, edition, lang, { hitAngle: p.hitAngle });
  const multiOut = multiOutLabel(p.outsOnPlay || 0);

  return (
    <div className="play-card">
      <div className="pc-head">
        <span className="rank-badge">{p.order ?? ''}</span>
        <span className="pc-name">{name}{number ? ` #${number}` : ''}</span>
        {multiOut && <span className="pill multiout">⚡{multiOut}</span>}
        <span className={`pill pc-pill ${category}`}>{label}</span>
        {p.runs > 0 && (
          <span className="pill amber pc-score">
            {p.scoreAfter ? `${p.scoreAfter.my}-${p.scoreAfter.opp}` : t('gp.runsShort', { n: p.runs })}
          </span>
        )}
        {onEdit && (
          <button className="pc-edit-btn" onClick={() => onEdit(log)} aria-label={t('gp.editAria')}>✎</button>
        )}
      </div>
      <div className="pc-body">
        <MiniDiamond runners={p.beforeRunners} />
        <CountDots balls={p.balls} strikes={p.strikes} outsBefore={p.outsBefore} />
        <div className="pc-text">
          <div>{log.text}</div>
          {(p.moveLines || []).map((t, i) => <div key={i} className="dim">{t}</div>)}
        </div>
      </div>
    </div>
  );
}

// ---- 過去プレイの事後編集シート ----
// 結果種別・方向・打点を後から修正/削除できる(成績は自動で再計算)。
// スコア・走者・投手成績はここでは変えず、必要なら手動修正機能を案内する。
function EditPlaySheet({ game, log, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const p = log.payload || {};
  const [result, setResult] = useState(p.result);
  const [direction, setDirection] = useState(p.direction || null);
  const [outType, setOutType] = useState(p.outType || 'ground');
  const [soType, setSoType] = useState(p.soType || 'swinging');
  // 打点(角度・深さ)と強さ。入力できるものは直せなければならない。
  // とくに方向だけ直して打点が古いままだと、分布図が直した方向と食い違う
  const [point, setPoint] = useState(
    p.hitAngle != null ? { angle: p.hitAngle, depth: p.hitDepth } : null,
  );
  const [contact, setContact] = useState(p.contact || null);
  // 直しに来た時点では方向は入っているので畳んでおく(シートを短くする)
  const [dirOpen, setDirOpen] = useState(!p.direction);
  const [rbi, setRbi] = useState(p.rbi ?? null);
  const isAtBat = log.kind === 'atbat';
  const [playerId, setPlayerId] = useState(p.playerId || null);

  const save = () => {
    // 打者の付け替え(リエントリー対応)は結果編集より先に反映する
    if (isAtBat && playerId && playerId !== p.playerId) {
      dispatch({ type: 'REASSIGN_ATBAT', gameId: game.id, logId: log.id, newPlayerId: playerId });
    }
    dispatch({
      type: 'EDIT_PLAY_LOG',
      gameId: game.id,
      logId: log.id,
      patch: {
        result, direction, outType, soType, contact,
        hitAngle: point ? point.angle : null,
        hitDepth: point ? point.depth : null,
        ...(isAtBat && rbi !== null ? { rbi } : {}),
      },
    });
    onClose();
  };

  const remove = () => {
    if (!window.confirm(t('gp.deleteConfirm'))) return;
    dispatch({ type: 'DELETE_PLAY_LOG', gameId: game.id, logId: log.id });
    onClose();
  };

  return (
    <Sheet title={t('gp.editTitle', { inning: log.inning, half: t(log.isTop ? 'half.top' : 'half.bottom') })} onClose={onClose}>
      {isAtBat && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>{t('gp.reassignBatter')}</div>
          <select className="small" style={{ width: '100%' }} value={playerId || ''} onChange={(e) => setPlayerId(e.target.value)}>
            {state.players.map((pl) => (
              <option key={pl.id} value={pl.id}>{pl.name}{pl.number ? ` #${pl.number}` : ''}</option>
            ))}
          </select>
        </>
      )}
      <div className="section-title" style={isAtBat ? undefined : { marginTop: 0 }}>{t('gp.result')}</div>
      <div className="grid3">
        {Object.entries(RESULTS).map(([k, def]) => (
          <button
            key={k}
            className={`small ${result === k ? 'primary' : ''}`}
            onClick={() => {
              setResult(k);
              // ファウルの安打は無い。ファウルフライを安打に直したら打点は外す
              // (残すと「ファウルゾーンに落ちたヒット」という記録ができてしまう)
              if (!allowsFoul(k) && point && isFoul(point.angle)) setPoint(null);
            }}
          >
            {lang === 'ja' ? def.label : t(`result.${k}`)}
          </button>
        ))}
      </div>

      {/* 入力と同じパッドで直す。方向だけ直して打点が古いまま残ると、
          分布図が直した方向と食い違ってしまう */}
      <div className="section-title">{t('gp.direction')}</div>
      {dirOpen ? (
        <FieldPad
          value={direction}
          point={point}
          gameId={game.id}
          allowFoul={allowsFoul(result)}
          onChange={(key, pt) => { setDirection(key); setPoint(pt); }}
          onDone={() => setDirOpen(false)}
        />
      ) : (
        <button type="button" className="dir-summary" onClick={() => setDirOpen(true)}>
          <span className="dir-label">
            {direction ? (lang === 'ja' ? DIRECTIONS[direction] : t(`dir.${direction}`)) : t('playsheet.notTapped')}
            {point && isFoul(point.angle) && <span className="depth-pill foul">{t('dir.foul')}</span>}
            {point && <span className="depth-pill">{t(`depth.${depthBand(point.depth)}`)}</span>}
          </span>
          <span className="change">{t('playsheet.change')}</span>
        </button>
      )}

      <div className="section-title">{t('playsheet.battedBall')}</div>
      {/* 併殺は、その打席が始まった時点で2アウト未満のときだけ。
          既に2アウトなら1つ目のアウトでその回が終わるので起こりえない。
          古いログには outsBefore が無いので、その場合は従来どおり許す */}
      <BattedBallPad
        trajectory={outType === 'dp' ? null : outType}
        contact={contact}
        depth={point ? point.depth : null}
        onChange={(tr, c) => { setOutType(tr); setContact(c); }}
        dp={outType === 'dp'}
        onDp={() => setOutType(outType === 'dp' ? 'ground' : 'dp')}
        dpDisabled={result !== 'out' || (p.outsBefore ?? 0) >= 2}
      />
      {result === 'so' && (
        <>
          <div className="section-title">{t('playsheet.soType')}</div>
          <div className="grid2">
            {Object.keys(SO_TYPES).map((k) => (
              <button key={k} className={`small ${soType === k ? 'primary' : ''}`} onClick={() => setSoType(k)}>{lang === 'ja' ? SO_TYPES[k] : t(`soType.${k}`)}</button>
            ))}
          </div>
        </>
      )}

      {isAtBat && (
        <div className="flex mt12">
          <span className="small dim grow">{t('playsheet.rbi')}</span>
          <div className="stepper">
            <button onClick={() => setRbi(Math.max(0, (rbi ?? p.rbi ?? 0) - 1))}>−</button>
            <span className="val">{rbi ?? p.rbi ?? 0}</span>
            <button onClick={() => setRbi(Math.min(4, (rbi ?? p.rbi ?? 0) + 1))}>＋</button>
          </div>
        </div>
      )}

      <div className="warn-box mt12">
        {t('gp.editWarn')}
      </div>

      <button className="ghost danger mt8" style={{ width: '100%' }} onClick={remove}>{t('gp.deletePlay')}</button>
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

// その他イベント(交代・投手交代・走者イベント等)の簡易行。
// count>1 のときは「牽制 ×3」のように回数バッジ付きで1行にまとめて表示する
function SimpleLogLine({ log, count = 1 }) {
  return (
    <div className="log-line">
      {log.text}
      {count > 1 && <span className="log-count">×{count}</span>}
    </div>
  );
}

// 表示用の行リストを作る: プレイカード以外で「同じ文言が連続する」ログ(牽制の連投等)は
// 1行+回数に集約する。保存データは1件ずつのまま(Undo・記録の正確さに影響しない)。
function toDisplayRows(logs) {
  const rows = [];
  for (const log of logs) {
    const isCard = log.kind === 'atbat' || log.kind === 'defense';
    const prev = rows[rows.length - 1];
    if (!isCard && prev && !prev.isCard && prev.log.text === log.text) {
      prev.count += 1;
    } else {
      rows.push({ isCard, log, count: 1 });
    }
  }
  return rows;
}

function groupByHalfInning(playLogs) {
  const groups = [];
  for (const l of playLogs) {
    const key = `${l.inning}-${l.isTop}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, inning: l.inning, isTop: l.isTop, logs: [] };
      groups.push(g);
    }
    g.logs.push(l);
  }
  return groups.reverse(); // 新しい回を上に
}

// 文章での打者修正カード。リエントリー等で打者の帰属がズレたとき、
// 「3回の入交の打席は髙島」のように文章で入力すると、その打席の打者を付け替える。
function NLCorrectionCard({ game }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null); // { kind:'ok'|'err', text }
  const [asks, setAsks] = useState([]); // 聞き返し: [{ id, text, options:[{label, sentence}] }]
  const [busy, setBusy] = useState(false);
  // 付け替えの重ねがけで壊れた打席の検出(同じ回に2打順で打席 / 打順の並びのズレ)
  const dupAtBats = findDuplicateAtBats(game);
  const orderBreaks = canRebuildOrders(game) ? findOrderBreaks(game) : 0;
  const posIssues = findPositionIssues(game); // 同じ守備位置に2人 / 守備位置が不在
  // 「3〜6回」「5回」のように、発生している回を範囲で示す
  const inningRange = (r) => (r.from === r.to ? t('gp.nlInningOne', { n: r.from }) : t('gp.nlInningRange', { from: r.from, to: r.to }));

  // 選手の打順スロットを特定する。既に交代で退いた選手(現lineupに居ない)でも、
  // スタメン・交代ログ・打席のどこかから拾えるようにする。
  const orderOf = (pid) => {
    const cur = (game.lineup || []).find((l) => l.playerId === pid);
    if (cur) return cur.order;
    const st = (game.startingLineup || []).find((l) => l.playerId === pid);
    if (st) return st.order;
    for (const l of game.playLogs || []) {
      if (l.kind === 'sub' && (l.payload?.out === pid || l.payload?.in === pid)) return l.payload.order;
    }
    const ab = (game.atBats || []).find((a) => a.playerId === pid);
    return ab ? ab.order : null;
  };

  // AIに渡す試合コンテキスト(登録選手・現打順・自軍の打席記録)
  const buildContext = () => ({
    players: state.players.map((p) => ({ name: p.name, number: p.number })),
    lineup: (game.lineup || []).map((l) => ({ order: l.order, name: nameOf(l.playerId), position: l.position || '' })),
    atbats: (game.playLogs || []).filter((l) => l.kind === 'atbat').map((l) => ({
      inning: l.inning, order: l.payload?.order, batter: nameOf(l.payload?.playerId),
      result: playLabel(l.payload?.result, l.payload?.direction, l.payload?.outType, l.payload?.soType, state.settings.edition, lang, { hitAngle: l.payload?.hitAngle }),
    })),
  });
  // 同名で二重登録された選手がいる場合、この試合に既に出ている方を優先して選ぶ
  // (別レコードを掴むと「同じ人」と繋がらず、打順移動や成績が分断されるため)。
  const inThisGame = inGamePlayerIds(game);
  const idByName = (nm) => {
    const matches = state.players.filter((p) => p.name === nm);
    return (matches.find((p) => inThisGame.has(p.id)) || matches[0])?.id || null;
  };
  const clean = (v) => (v && v !== 'null' ? v : null);
  // 端末内の解析に渡す名簿。同名が二重登録されている場合、この試合に出ている方を選ぶ。
  // (出ていない方のIDを掴むと、その回の打席が見つからず修正が黙って捨てられる)
  const parsePlayers = preferInGamePlayers(state.players, inThisGame);

  // AIの操作配列 → 中間表現(regexパスと同形 { subs, reassigns, resultCorrs })
  const aiOpsToIntermediate = (ops) => {
    const subs = []; const reassigns = []; const resultCorrs = []; const posCorrs = []; const aligns = []; const deletions = [];
    const num = (v) => (v == null || v === 'null' || v === '' ? null : Number(v)); // AIの文字列数値に備える
    for (const op of ops || []) {
      const inning = num(op.inning);
      if (op.type === 'defense' && inning) {
        // 「◯回の守備は◯◯」= 出場中の選手の守備位置変更(交代ではない)
        const pid = idByName(op.player);
        if (pid && clean(op.position)) aligns.push({ inning, toInning: num(op.toInning) || inning, playerId: pid, playerName: op.player, position: clean(op.position) });
      } else if (op.type === 'position') {
        // 先発守備位置の訂正(回を伴わない)
        const pid = idByName(op.player);
        if (pid && clean(op.position)) posCorrs.push({ playerId: pid, playerName: op.player, position: clean(op.position) });
      } else if (op.type === 'reassign' && inning) {
        const newId = idByName(op.to);
        if (newId) reassigns.push({ inning, ordinal: num(op.ordinal), targetId: idByName(op.from), targetName: op.from, newId, newName: op.to });
      } else if (op.type === 'substitution' && inning) {
        const outId = idByName(op.out); const inId = idByName(op.in);
        // 退く選手が特定できなくても、守備位置(投手等)があれば受け付ける(呼び出し側で解決)
        if (inId && (outId || clean(op.position))) subs.push({ inning, outId, outName: op.out || null, inId, inName: op.in, position: clean(op.position), subKind: op.role || 'def', afterOppOrder: num(op.afterBatter) });
      } else if (op.type === 'result' && inning && op.result) {
        // 打球でない結果(三振・四球)に直すなら軌道と強さは消す。
        // 打球のままなら、言われた項目だけを送る(送らない項目は現在値が残る)
        const batted = BATTED_BALL_RESULTS.has(op.result);
        const traj = clean(op.outType);
        const cont = clean(op.contact);
        resultCorrs.push({ inning, batterId: idByName(op.batter), batterName: op.batter || null, nth: num(op.nth), patch: {
          result: op.result, direction: clean(op.direction),
          // 「見逃し」と書かれていれば見逃し三振。指定が無い三振は空振り扱い(従来どおり)
          soType: op.result === 'so' ? (clean(op.soType) || 'swinging') : null,
          ...(batted
            ? {
              ...(op.result === 'out' || traj ? { outType: traj || 'ground' } : {}),
              ...(cont ? { contact: cont } : {}),
            }
            : { outType: null, contact: null, hitAngle: null, hitDepth: null }),
          ...(num(op.rbi) != null ? { rbi: num(op.rbi) } : {}),
        } });
      } else if (op.type === 'delete' && inning) {
        // 記録されている打席そのものの取り消し(端末内解析の parseAtBatDeletions と同じ形)
        const pid = idByName(op.batter);
        if (pid) deletions.push({ inning, playerId: pid, playerName: op.batter, ordinal: num(op.nth), order: null });
      }
    }
    return { subs, reassigns, resultCorrs, posCorrs, aligns, deletions };
  };
  const produceRegex = () => ({
    subs: parseSubstitutions(text, parsePlayers),
    reassigns: parseBatterReassignments(text, parsePlayers),
    resultCorrs: parseResultCorrections(text, parsePlayers),
    posCorrs: parsePositionCorrections(text, parsePlayers),
    // 入れ替え(⇄)は守備位置の変更として扱う。交代にすると打順が動いてしまう
    aligns: [...parseDefensiveAlignment(text, parsePlayers), ...parsePositionSwaps(text, parsePlayers)],
    slotBatters: parseSlotBatters(text, parsePlayers),
    deletions: parseAtBatDeletions(text, parsePlayers),
  });
  const isEmpty = (im) => !(im.subs.length || im.reassigns.length || im.resultCorrs.length || im.posCorrs.length || im.aligns.length || (im.slotBatters || []).length || (im.deletions || []).length);

  // AI解釈と端末内解釈を統合(片方の取りこぼしをもう片方で補完)。重複は除去。
  const mergeIm = (a, b) => {
    const uniq = (arr, keyFn) => {
      const m = new Map();
      for (const x of arr) {
        const k = keyFn(x);
        if (!m.has(k)) m.set(k, x);
        else if (x.outId && !m.get(k).outId) m.set(k, x); // 退く側が特定できている方を優先
      }
      return [...m.values()];
    };
    return {
      subs: uniq([...(a.subs || []), ...(b.subs || [])], (s) => `${s.inning}|${s.inId}|${s.position || ''}`),
      reassigns: uniq([...(a.reassigns || []), ...(b.reassigns || [])], (r) => `${r.inning}|${r.newId}`),
      // 同じ回・同じ打者への結果指示は1つにまとめる。
      // AI(a)と端末内(b)で食い違ったときは端末内を優先する。端末内はスコアシートの
      // 短縮表記(中2・三飛…)をそのまま読むため、この形の文では取り違えが起きにくい。
      // ただし打者一巡した回では同じ打者が同じ回に2打席立つ。回と打者だけで束ねると
      // 1打席目と2打席目が潰し合い、片方の指示が黙って消える。
      // 何打席目かの指定が無い側でも、書かれた順(同じ打者の中での通し番号)で対応付ける。
      resultCorrs: mergeResultCorrections(a.resultCorrs || [], b.resultCorrs || []),
      posCorrs: uniq([...(a.posCorrs || []), ...(b.posCorrs || [])], (pc) => `${pc.playerId}`),
      // 同じ回・同じ選手の位置指定は1つにまとめ、範囲は広い方(AIと端末内で食い違うことがある)を採る
      slotBatters: uniq([...(a.slotBatters || []), ...(b.slotBatters || [])], (x) => `${x.inning}|${x.order}`),
      deletions: uniq([...(a.deletions || []), ...(b.deletions || [])], (x) => `${x.inning}|${x.playerId || ''}|${x.order || ''}|${x.ordinal || ''}`),
      // 同じ回・同じ選手に複数の位置が出たら、あとに書かれた方を採る。
      // 1つの回で2回入れ替えると(遊撃→投手→三塁)、先勝ちだと途中の位置で止まり、
      // 「同じ回に投手が2人」のような矛盾した配置になる。回の終わりの姿を残す。
      aligns: (() => {
        const m = new Map();
        for (const al of [...(a.aligns || []), ...(b.aligns || [])]) {
          // 回の途中で代わった指定は別物として残す。まとめてしまうと、
          // 「5回頭から茂木が投手 → 8番の後に宇田川」の前半が消え、
          // 茂木の登板そのものが無かったことになる
          const k = `${al.inning}|${al.playerId}|${al.afterOppOrder ?? ''}`;
          const cur = m.get(k);
          const to = Math.max(Number(al.toInning) || al.inning, Number(cur?.toInning) || cur?.inning || 0);
          m.set(k, { ...al, toInning: to });
        }
        return [...m.values()];
      })(),
    };
  };

  const apply = async () => {
    setMsg(null);
    const apiKey = state.settings.geminiApiKey;
    let im = produceRegex(); // まず端末内で解釈(常に土台にする)
    // 実際にAI解釈まで届いたのかを毎回はっきり示す(キーの有無だけでは分からないため)
    let mode = !apiKey ? 'nokey' : !navigator.onLine ? 'offline' : 'local';
    let detail = '';
    let questions = []; // AIからの確認(足りない情報・判断がつかない点)
    if (apiKey && navigator.onLine) {
      setBusy(true);
      try {
        const r = await interpretCorrection({ apiKey, text, ...buildContext() });
        if (r && r.error) { mode = 'error'; detail = r.error; } // 原因(キー/上限/通信)を持ち帰る
        else if (r && r.ops) { im = mergeIm(aiOpsToIntermediate(r.ops), im); mode = 'ai'; questions = r.questions || []; } // AIを重ねて統合
        else { mode = 'error'; detail = t('gp.nlAiNoResponse'); }
      } catch (e) { mode = 'error'; detail = e?.message || ''; } // AI失敗→端末内解釈のまま
      setBusy(false);
    }
    resolveAndApply(im, mode, detail, questions);
  };

  // 解釈経路の注記。うまくいかなかったとき、AIまで届いたのかを切り分けられるようにする。
  // 失敗時はGeminiが返した理由(HTTP 429=無料枠の上限、400=キー不正 など)もそのまま見せる。
  const modeNote = (mode, detail = '') => {
    const base = { ai: t('gp.nlModeAi'), error: t('gp.nlModeError'), nokey: t('gp.nlModeNoKey'), offline: t('gp.nlModeOffline') }[mode] || '';
    if (mode !== 'error' || !detail) return base;
    // 429は「使いすぎ」とは限らない(無料枠はモデルごと・分/日ごとの別枠)ので噛み砕いて添える
    const hint = /429|quota|rate limit/i.test(detail) ? t('gp.nlAiQuota') : '';
    return `${base}${t('gp.nlAiReason', { reason: detail })}${hint}`;
  };

  const resolveAndApply = (im, mode = 'local', detail = '', aiQuestions = []) => {
    setAsks([]);
    const { reassigns, resultCorrs, posCorrs = [], aligns = [], slotBatters = [], deletions = [] } = im;
    let subs = im.subs;
    // 守備陣形の申告(◯回の守備は…): 既に出場中の選手なら守備位置の変更、
    // 出場していない選手ならその位置への交代として扱う。
    const lineupRows = buildLineupRows(game);
    // その選手が既にこの試合に出ているか(出場ツリー基準)。出ているなら打順は動かさない。
    const slotOfPlayer = (pid) => {
      const cur = (game.lineup || []).find((l) => l.playerId === pid);
      if (cur) return { order: cur.order, from: cur.position || null };
      for (const s of lineupRows) {
        const p = s.players.find((x) => x.playerId === pid);
        if (p) return { order: s.order, from: p.posCode || null };
      }
      return null;
    };

    // 「3〜6回は山城がキャッチャー」のように範囲で言われたら、その各回に位置を記録する。
    // 回ごとの守備陣形と突き合わせ、まだその位置になっていない回だけを対象にする。
    const alignMap = alignmentByInning(game);
    const inningsToFix = (playerId, position, from, to) => {
      const out = [];
      for (let i = from; i <= to; i++) {
        const cur = (alignMap.get(i) || []).find((x) => x.playerId === playerId);
        if (!cur || cur.position !== position) out.push(i);
      }
      return out;
    };

    const alignAppl = [];
    const alignUnresolved = [];
    const alignReentry = []; // 記録に出ていない選手を「その回から出場」として入れ直したもの
    const alreadyOk = []; // 既にその守備位置(黙って捨てると別のエラーが出て紛らわしいので記録する)
    for (const al of aligns) {
      // 既に出場している選手は「自分の打順のまま守備位置だけ変更」。
      // ここで他人の打順への交代にしてしまうと、その打順の打席まで付け替わり、
      // 同じ回に2打席ある等の壊れた記録になるため、必ず自分のスロットで処理する。
      const own = slotOfPlayer(al.playerId);
      if (own) {
        const to = Math.max(Number(al.toInning) || al.inning, al.inning);
        // その回の記録に出ていない選手を指定された場合、「その回から出場していた」という
        // 訂正とみなし、自分の打順への再出場として記録する。
        // (記録が誤っているから直したいのに、記録を理由に拒否すると行き止まりになる)
        const onField = (inn) => (alignMap.get(inn) || []).some((x) => x.playerId === al.playerId);
        if (alignMap.has(al.inning) && !onField(al.inning) && !onField(to)) {
          const occupant = (alignMap.get(al.inning) || []).find((x) => x.order === own.order)
            || (game.lineup || []).find((l) => l.order === own.order) || null;
          subs = [...subs, {
            inning: al.inning, order: own.order,
            outId: occupant?.playerId || null,
            outName: occupant?.playerId ? nameOf(occupant.playerId) : null,
            inId: al.playerId, inName: al.playerName || nameOf(al.playerId),
            position: al.position, subKind: 'def', afterOppOrder: null,
          }];
          alignReentry.push(t('gp.nlAlignReentryItem', { name: al.playerName || nameOf(al.playerId), inning: al.inning }));
          continue;
        }
        const innings = inningsToFix(al.playerId, al.position, al.inning, to);
        // 回の途中の指定は「もうその位置だから不要」で捨てられない。
        // 回の終わりの姿が同じでも、途中で誰が投げたかは別の情報として要る
        if (!innings.length && al.afterOppOrder == null) {
          alreadyOk.push(`${own.order}${t('gp.nlOrderSuffix')} ${al.playerName || nameOf(al.playerId)}（${posFull(al.position, lang)}）`);
          continue;
        }
        alignAppl.push({ ...al, toInning: to, innings: innings.length ? innings : [al.inning], order: own.order, from: own.from });
      } else {
        // 同じ指示の中で、この選手を入れる交代が既に書かれているなら、その打順に入る。
        // ここで別の交代を作ると、その守備位置に居ただけの選手が不当に退かされる
        // (「6回から助っ人Cは右翼」が「境貴仁→助っ人C」になり、9番が消える事故が起きた)
        const pend = subs.find((s) => s.inId === al.playerId);
        const pendOrder = pend ? (pend.order ?? orderOf(pend.outId)) : null;
        if (pendOrder != null) {
          alignAppl.push({
            ...al, toInning: Math.max(Number(al.toInning) || al.inning, al.inning),
            innings: [al.inning], order: pendOrder, from: null,
          });
          continue;
        }
        // この試合に出ていない選手=交代。その位置の現在の守備者と入れ替える(交代の解決へ回す)
        const cur = (game.lineup || []).find((l) => l.position === al.position && l.playerId);
        if (!cur) { alignUnresolved.push(al.playerName || nameOf(al.playerId)); continue; }
        subs = [...subs, {
          inning: al.inning, outId: cur.playerId, outName: nameOf(cur.playerId),
          inId: al.playerId, inName: al.playerName || nameOf(al.playerId),
          position: al.position, subKind: 'def', afterOppOrder: null,
        }];
      }
    }
    // 守備位置の訂正: 出場選手ツリー(画面の表示と同じ組み立て)から対象の出場を特定する。
    // startingLineupが無い過去試合でも、表示上その選手が先発として出ていれば訂正できる。
    const posAppl = [];
    const posUnresolved = [];
    for (const pc of posCorrs) {
      let hit = null;
      for (const slot of lineupRows) {
        const p = slot.players.find((x) => x.playerId === pc.playerId);
        if (p) { hit = { order: slot.order, from: p.posCode || null, isStarter: p.isStarter }; break; }
      }
      if (!hit) { posUnresolved.push(pc.playerName || nameOf(pc.playerId)); continue; }
      if (hit.from === pc.position) { // 既に正しい(無言で捨てず伝える)
        alreadyOk.push(`${hit.order}${t('gp.nlOrderSuffix')} ${pc.playerName || nameOf(pc.playerId)}（${posFull(pc.position, lang)}）`);
        continue;
      }
      posAppl.push({ ...pc, order: hit.order, from: hit.from });
    }
    // 既にこの試合に出ている選手を、別の打順へ「交代」で入れると打順移動になり、
    // その打順の打席まで奪ってしまう(例:「2回から山城はキャッチャーです」が
    // 「松田→山城」の交代として解釈され、松田の打席が山城に移ってしまう)。
    // 正当な打順移動なら、同じ指示の中で元の打順から抜ける交代も必ず記録されるので、
    // それが無いものは採用しない。守備位置の変更としては別途 alignAppl で反映される。
    // ただし「AがBと交代しました」と文章にはっきり書かれている場合は、記録側の打順が
    // ズレているだけなので、そのまま交代として受け付ける(この訂正が本来の目的)。
    // 同じ回に同じ選手が2度入る交代は作れない(1人が同時に2つの枠に入ることになる)。
    // 「3番の宇田川に代わって助っ人Aが代打」と「助っ人Aが投手です」のように、
    // 交代と守備位置が別の文で書かれたときに起きる。退く側が分かっている方を交代として残し、
    // もう一方は守備位置の指定として拾い直す
    for (const [, group] of subs.reduce((m, s) => {
      const k = `${s.inning}|${s.inId}`;
      m.set(k, [...(m.get(k) || []), s]);
      return m;
    }, new Map())) {
      if (group.length < 2) continue;
      const keep = group.find((s) => s.outId) || group[0];
      for (const s of group) {
        if (s === keep) continue;
        if (s.position) {
          const ord = keep.order ?? orderOf(keep.outId);
          if (ord != null) {
            alignAppl.push({
              inning: s.inning, toInning: s.inning, innings: [s.inning],
              playerId: s.inId, playerName: s.inName || nameOf(s.inId),
              position: s.position, order: ord, from: null,
              afterOppOrder: s.afterOppOrder ?? null,
            });
          }
        }
        subs = subs.filter((x) => x !== s);
      }
    }
    const orderMoved = []; // 打順が動くため採用しなかったもの(黙って捨てると原因が分からない)
    subs = subs.filter((s) => {
      const own = slotOfPlayer(s.inId);
      if (!own) return true; // まだ出ていない選手=本当の交代
      const target = orderOf(s.outId);
      if (target == null || target === own.order) return true; // 自分の打順の中の話
      const pair = [s.outName || nameOf(s.outId), s.inName || nameOf(s.inId)];
      // 野球では、出場中の選手の打順は動かない。交代とは「入る側が退く側の打順に入る」
      // ことであって、既に打順を持っている選手が別の枠へ移ることではない。
      // ここを許すと、守備位置の入れ替えや言い回しの揺れが打順の乗っ取りになる
      // (3番の選手が以後ずっと4番として扱われる事故が起きた)。
      // 記録側の打順が本当に間違っている場合だけ、明示された指示で動かす。
      if (explicitOrderChange(text, pair)) return true;
      // 同じ回に「その選手が元の打順から抜ける交代」も書かれているなら、
      // 打順そのものの入れ替えとして筋が通るので受け付ける。
      // 回を問わずに探すと、あとの回の無関係な交代(6回に別の選手と代わる等)を
      // 根拠にしてしまい、打順の乗っ取りが素通りする
      const paired = subs.some((o) => o !== s && o.outId === s.inId
        && o.inning === s.inning && orderOf(o.outId) === own.order);
      if (paired) return true;
      // 出場中の選手が別の位置に就く話なので、交代ではなく「自分の打順のままの
      // 守備位置の変更」として拾い直す。捨ててしまうと、投手交代のつもりで
      // 書いた指示が何も起きずに消える
      if (s.position) {
        const inns = inningsToFix(s.inId, s.position, s.inning, s.inning);
        if (inns.length) {
          alignAppl.push({
            inning: s.inning, toInning: s.inning, innings: inns,
            playerId: s.inId, playerName: pair[1], position: s.position,
            order: own.order, from: own.from,
            // 回の途中の継投(「8番の後に」)は、投手成績を分けるために時刻を持ち越す
            afterOppOrder: s.afterOppOrder ?? null,
          });
        }
      }
      orderMoved.push(`${pair[1]}（${own.order}${t('gp.nlOrderSuffix')}）`);
      return false;
    });

    // 明示的な交代(守備/投手/代打…)。連鎖(A→B→C)は入った選手が打順を引き継ぐ。
    const orderCache = new Map();
    const resolveOrder = (pid) => (orderCache.has(pid) ? orderCache.get(pid) : orderOf(pid));
    const subAppl = [];
    const subUnresolved = [];
    // バッチ内の「直前の投手」を追う(退く側が未指定の投手交代の解決に使う)
    let curPitcher = (game.startingLineup || []).find((l) => l.position === '投')?.playerId
      || (game.lineup || []).find((l) => l.position === '投')?.playerId || null;
    const orderedSubs = [...subs].sort((a, b) => a.inning - b.inning); // 回順(同回は挿入順維持=安定ソート)
    for (let s of orderedSubs) {
      // 呼び出し側が打順を決めている場合(守備位置の訂正から作った再出場)はそれを優先
      let order = s.order != null ? s.order : resolveOrder(s.outId);
      // 投手交代で退く側が未特定なら、直前の投手を退く側にする
      if (order == null && s.position === '投' && curPitcher && curPitcher !== s.inId) {
        const o = resolveOrder(curPitcher);
        if (o != null) { s = { ...s, outId: curPitcher, outName: nameOf(curPitcher) }; order = o; }
      }
      if (order == null && s.position) {
        // 守備位置が明示なら、その位置の現在の選手が居る打順で解決(実データの守備者→新選手)
        const slot = (game.lineup || []).find((l) => l.position === s.position && l.playerId);
        if (slot) { s = { ...s, outId: slot.playerId, outName: nameOf(slot.playerId) }; order = slot.order; }
      }
      if (order == null) { subUnresolved.push(s.outName || `?→${s.inName}`); continue; }
      orderCache.set(s.outId, order); orderCache.set(s.inId, order);
      if (s.position === '投') curPitcher = s.inId; // 次の投手交代の退く側候補
      subAppl.push({ ...s, order });
    }

    // 同じ指示の中で交代も書かれている場合、その選手は交代先の打順に移る。
    // 守備位置の申告は移った先の打順に付け替える(元の打順に位置ログを残すと、
    // 「2回に河合→山城、3〜6回は山城が捕手」で別の打順が捕手になってしまう)。
    for (const al of alignAppl) {
      const s = subAppl.find((x) => x.inId === al.playerId);
      if (s && s.order !== al.order) { al.order = s.order; al.from = s.position || al.from; }
    }

    // 打順を指定した打者の訂正(「7回の8番は奥田」)。打順が繰り上がった場合など、
    // 名前では指せない打席をピンポイントで直す。
    const slotAppl = [];
    const slotUnresolved = [];
    for (const sb of slotBatters) {
      const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat'
        && Number(l.inning) === Number(sb.inning) && l.payload?.order === sb.order);
      if (!logs.length) { slotUnresolved.push(t('gp.nlSlotBatterMiss', { inning: sb.inning, order: sb.order })); continue; }
      if (logs[0].payload?.playerId === sb.playerId) {
        alreadyOk.push(`${sb.order}${t('gp.nlOrderSuffix')} ${sb.playerName || nameOf(sb.playerId)}`);
        continue;
      }
      slotAppl.push({ ...sb, logId: logs[0].id });
    }

    // 打席の取り消し(スコアシートのマスを空欄にする)。打順が繰り上がって、
    // 実際には回ってこなかった打席が記録されている場合に使う。
    const delAppl = [];
    const delUnresolved = [];
    // 「◯◯の打席は空席で、その左飛を△△につけて」のように、同じ回・同じ選手の打席が
    // 付け替え対象にもなっている場合は削除しない。付け替えれば元のマスは空くので、
    // 先に消すと付け替える打席そのものが無くなってしまう。
    const movedAway = new Set(reassigns.filter((r) => r.targetId).map((r) => `${Number(r.inning)}|${r.targetId}`));
    for (const d of deletions.filter((d) => !(d.playerId && movedAway.has(`${Number(d.inning)}|${d.playerId}`)))) {
      const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat' && Number(l.inning) === Number(d.inning));
      let cand = logs;
      if (d.playerId) cand = logs.filter((l) => l.payload?.playerId === d.playerId);
      else if (d.order != null) cand = logs.filter((l) => l.payload?.order === d.order);
      if (d.ordinal) cand = cand[d.ordinal - 1] ? [cand[d.ordinal - 1]] : [];
      const who = d.playerName || (d.order != null ? `${d.order}${t('gp.nlOrderSuffix')}` : '');
      if (cand.length !== 1) {
        delUnresolved.push(t('gp.nlDelMiss', { inning: d.inning, who, n: cand.length }));
        continue;
      }
      delAppl.push({ ...d, logId: cand[0].id, who, label: cand[0].text });
    }

    // 複数回の打者付け替えを、対象の打席ログへ解決
    const reAppl = [];
    const inningToLog = new Map();
    const reUnresolved = [];
    for (const r of reassigns) {
      const targetOrder = r.targetId ? orderOf(r.targetId) : null;
      const found = findTargetAtBat(game, { inning: r.inning, ordinal: r.ordinal, targetPlayerId: r.targetId, targetOrder });
      // 既にその選手に付け替え済み(=対象がnewId)ならスキップ(成功扱い・重複防止)
      if (found.ok && found.log.payload?.playerId === r.newId) { inningToLog.set(r.inning, found.log.id); continue; }
      if (found.ok) { reAppl.push({ ...r, logId: found.log.id }); inningToLog.set(r.inning, found.log.id); }
      else reUnresolved.push(`${r.inning}回${r.targetName ? `(${r.targetName})` : ''}`);
    }
    // まだ出場していない選手へ付け替えるときだけ、表示する場所として代打を合成する。
    // 打席の付け替えは「誰が打ったか」の訂正であって、守備の入れ替えではない。
    // 既に出ている選手にまで代打を作ると、
    //  - その回以降その打順の守備が入ってきた選手のものになり、別途直したはずの
    //    守備位置(「6-7回のライトは清水」など)を上書きする
    //  - その選手が別の打順に入っている記録が「1人が2つの打順」の解消として
    //    取り消され、他の回の打席まで元の選手に巻き戻る
    // という広い範囲の壊れ方をする。
    const synthSubs = [];
    const seenPair = new Set();
    for (const r of reAppl) {
      if (!r.targetId || inThisGame.has(r.newId)) continue;
      const key = `${r.targetId}>${r.newId}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      const order = resolveOrder(r.targetId);
      if (order == null) continue;
      const innings = reAppl.filter((x) => x.targetId === r.targetId && x.newId === r.newId).map((x) => x.inning);
      synthSubs.push({ outId: r.targetId, outName: r.targetName, inId: r.newId, inName: r.newName, inning: Math.min(...innings), subKind: /代走/.test(text) ? 'pr' : 'ph', position: null, order });
    }

    // 結果修正を対象の打席ログへ解決(その回の付け替え対象、無ければ回内で1件のみのとき)
    const resAppl = [];
    // 打者一巡した回では同じ打者が同じ回に2打席立つ。1件目だけを見ると2打席目に
    // 手が届かず、2文書いても両方1打席目に当たって上書きになるため、候補を全部集めて
    // 「何打席目か」で選ぶ。指定が無ければ書かれた順に空いている打席へ割り当てる。
    const byName = (name) => new Set(state.players.filter((p) => p.name === name).map((p) => p.id));
    const targets = assignResultTargets(game.playLogs || [], resultCorrs, byName);
    resultCorrs.forEach((rc, i) => {
      const hit = targets[i];
      let logId = hit?.logId || null;
      // 打者で特定できなかった分は、その回の付け替え先・回内で1件だけ、の順に頼る
      if (!logId) logId = inningToLog.get(rc.inning);
      if (!logId) { const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat' && l.inning === rc.inning); if (logs.length === 1) logId = logs[0].id; }
      if (logId) resAppl.push({ ...rc, logId, nth: hit?.nth ?? null });
    });
    // 同じ回で2つの打席の結果が入れ替わる指示のときは、打点とその打席で入った得点も
    // 一緒に入れ替える。打点は「その打撃が生んだもの」なので、結果だけ移すと
    // 凡打に打点が残るような食い違いが出る。
    const logById = new Map((game.playLogs || []).map((l) => [l.id, l]));
    for (const a of resAppl) {
      for (const b of resAppl) {
        if (a === b || Number(a.inning) !== Number(b.inning) || a.logId === b.logId) continue;
        const la = logById.get(a.logId);
        const lb = logById.get(b.logId);
        if (!la || !lb) continue;
        const swapped = a.patch.result === lb.payload?.result && b.patch.result === la.payload?.result;
        if (!swapped) continue;
        if (a.patch.rbi === undefined) a.patch.rbi = lb.payload?.rbi || 0;
        if (a.patch.runs === undefined) a.patch.runs = lb.payload?.runs || 0;
      }
    }

    const totalOps = subAppl.length + synthSubs.length + reAppl.length + resAppl.length + posAppl.length + alignAppl.length + slotAppl.length + delAppl.length;
    if (!totalOps) {
      const note = modeNote(mode, detail); // どの経路で解釈したかを添える(AI未接続かの切り分け用)
      setAsks(buildAsks({ alignMap, aiQuestions })); // 決められなかった点はその場で聞き返す
      // 指定どおりに既になっている場合は「エラー」ではないので、そう伝える
      if (alreadyOk.length) { setMsg({ kind: 'ok', text: t('gp.nlAlreadyOk', { list: alreadyOk.join('、') }) + note }); return; }
      if (delUnresolved.length) { setMsg({ kind: 'err', text: t('gp.nlDelNone', { list: delUnresolved.join('、') }) + note }); return; }
      if (slotUnresolved.length) { setMsg({ kind: 'err', text: t('gp.nlSlotBatterNone', { list: slotUnresolved.join('、') }) + note }); return; }
      if (alignUnresolved.length) { setMsg({ kind: 'err', text: t('gp.nlPosNotStarter', { name: alignUnresolved.join('、') }) + note }); return; }
      if (posUnresolved.length) { setMsg({ kind: 'err', text: t('gp.nlPosNotStarter', { name: posUnresolved.join('、') }) + note }); return; }
      if (subUnresolved.length) { setMsg({ kind: 'err', text: t('gp.nlSubNoOrder', { name: subUnresolved.join('、') }) + note }); return; }
      if (reUnresolved.length) { setMsg({ kind: 'err', text: t('gp.nlReAllNotFound', { innings: reUnresolved.join('、') }) + note }); return; }
      const single = parseBatterCorrection(text, state.players);
      const key = !single.ok
        ? ({ noInning: 'gp.nlErrInning', empty: 'gp.nlErrInning', noTarget: 'gp.nlErrTarget', noNewName: 'gp.nlErrNewName' }[single.reason] || 'gp.nlErrInning')
        : 'gp.nlErrNotFound';
      setMsg({ kind: 'err', text: t(key) + note });
      return;
    }

    const subLabel = (s) => t('gp.nlSubItem', { inning: s.inning, out: s.outName, in: s.inName, pos: s.position ? posFull(s.position, lang) : t('gp.nlSubNoPos') });
    const lines = [
      ...alignAppl.map((al) => t(al.toInning > al.inning ? 'gp.nlAlignItemRange' : 'gp.nlAlignItem', {
        inning: al.inning, toInning: al.toInning, order: al.order, name: al.playerName || nameOf(al.playerId),
        from: al.from ? posFull(al.from, lang) : '—', to: posFull(al.position, lang),
      })),
      ...posAppl.map((pc) => t('gp.nlPosItem', {
        order: pc.order, name: pc.playerName || nameOf(pc.playerId),
        from: pc.from ? posFull(pc.from, lang) : '—', to: posFull(pc.position, lang),
      })),
      ...subAppl.map(subLabel),
      ...synthSubs.map(subLabel),
      ...delAppl.map((d) => t('gp.nlDelItem', { inning: d.inning, who: d.who })),
      ...slotAppl.map((sb) => t('gp.nlSlotBatterItem', { inning: sb.inning, order: sb.order, name: sb.playerName || nameOf(sb.playerId) })),
      ...reAppl.map((r) => t('gp.nlReItem', { inning: r.inning, name: r.newName })),
      ...resAppl.map((rc) => {
        // 同じ回に2打席ある打者は、どちらの打席を直すのかを添えて取り違えを防ぐ
        const who = (rc.batterId ? ` ${rc.batterName || nameOf(rc.batterId)}` : '')
          + (rc.nth ? t('gp.nlResNth', { n: rc.nth }) : '');
        // 打点だけの修正は、打席結果を書かずに打点だけを示す
        if (rc.patch.result === undefined) return t('gp.nlResRbiItem', { inning: rc.inning, who, n: rc.patch.rbi });
        return t('gp.nlResItem', {
          inning: rc.inning,
          who,
          label: playLabel(rc.patch.result, rc.patch.direction, rc.patch.outType, rc.patch.soType, state.settings.edition, lang)
            + (rc.patch.rbi !== undefined ? t('gp.nlResRbi', { n: rc.patch.rbi }) : ''),
        });
      }),
    ];
    // 打順が動く交代は、間違えると以後ずっと別人の打順として扱われる。
    // 確認の先頭に「どの打順が誰のものになるか」を出し、取り違えに気づけるようにする。
    const moves = [...subAppl, ...synthSubs].filter((s) => {
      const own = slotOfPlayer(s.inId);
      return own && own.order !== s.order;
    }).map((s) => t('gp.nlOrderMoveItem', {
      name: s.inName || nameOf(s.inId), from: slotOfPlayer(s.inId).order, to: s.order,
    }));
    const warn = moves.length ? t('gp.nlOrderMoveWarn', { list: moves.join('\n') }) : '';
    if (!window.confirm(warn + t('gp.nlConfirmOps', { list: lines.join('\n') }))) return;

    const doSub = (s) => {
      const kindLabel = { ph: t('box.rolePh'), pr: t('box.rolePr'), def: t('gp.subDef') }[s.subKind] || t('gp.subDef');
      dispatch({ type: 'RETRO_SUBSTITUTE', gameId: game.id, order: s.order, outId: s.outId, inId: s.inId, position: s.position, subKind: s.subKind, inning: s.inning, afterOppOrder: s.afterOppOrder ?? null, label: `${kindLabel}: ${nameOf(s.inId)} (${s.order}番 ${nameOf(s.outId)}に代わり)` });
    };
    posAppl.forEach((pc) => dispatch({ type: 'FIX_STARTING_POSITION', gameId: game.id, playerId: pc.playerId, position: pc.position }));
    // 交代を先に反映してから守備位置を記録する(交代で打順が移る場合に位置が正しい枠に載る)
    synthSubs.forEach(doSub);
    subAppl.forEach(doSub);
    alignAppl.forEach((al) => (al.innings || [al.inning]).forEach((inn) => dispatch({
      type: 'RETRO_POSITION', gameId: game.id, order: al.order, playerId: al.playerId, position: al.position, inning: inn,
      afterOppOrder: inn === al.inning ? (al.afterOppOrder ?? null) : null,
    })));
    delAppl.forEach((d) => dispatch({ type: 'DELETE_PLAY_LOG', gameId: game.id, logId: d.logId }));
    slotAppl.forEach((sb) => dispatch({ type: 'REASSIGN_ATBAT', gameId: game.id, logId: sb.logId, newPlayerId: sb.playerId }));
    reAppl.forEach((r) => dispatch({ type: 'REASSIGN_ATBAT', gameId: game.id, logId: r.logId, newPlayerId: r.newId }));
    resAppl.forEach((rc) => dispatch({ type: 'EDIT_PLAY_LOG', gameId: game.id, logId: rc.logId, patch: rc.patch }));
    // 守備位置の変更でマウンドに立った場合も投手成績を作り直す
    // (入れ替えで投手が代わっても、交代ログが無いままだと成績が分かれない)
    const hasPitcherChange = subAppl.some((s) => s.position === '投')
      || alignAppl.some((al) => al.position === '投');
    if (hasPitcherChange) dispatch({ type: 'RECOMPUTE_PITCHING', gameId: game.id });

    const notes = [];
    if (orderMoved.length) notes.push(t('gp.nlOrderKept', { list: [...new Set(orderMoved)].join('、') }));
    if (alignReentry.length) notes.push(t('gp.nlAlignReentry', { list: alignReentry.join('、') }));
    if (posUnresolved.length) notes.push(t('gp.nlPosNotStarterShort', { names: posUnresolved.join('、') }));
    if (subUnresolved.length) notes.push(t('gp.nlSubNoOrderShort', { names: subUnresolved.join('、') }));
    if (reUnresolved.length) notes.push(t('gp.nlReNotFoundShort', { innings: reUnresolved.join('、') }));
    setMsg({ kind: 'ok', text: t('gp.nlDoneOps', { n: totalOps }) + (hasPitcherChange ? t('gp.nlPitchRecalc') : '') + notes.join('') + modeNote(mode, detail) });
    setAsks(buildAsks({ subAppl, alignAppl, alignMap, aiQuestions }));
    setText('');
  };

  // ---- 聞き返し(足りない情報・こちらの気づきを、その場で確認する) ----
  // 反映はしたが決めきれていない点を、タップで答えられる形にして返す。
  // 選んだ答えは修正文として入力欄に入るので、押して確定するだけで詰められる。
  const FIELD_POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const buildAsks = ({ subAppl = [], alignAppl = [], alignMap, aiQuestions = [] }) => {
    const out = [];
    const add = (a) => { if (out.length < 4) out.push({ id: `${out.length}-${a.text}`, ...a }); };
    // AIが「これだけでは決められない」と返してきた確認
    for (const q of aiQuestions) {
      if (!q?.text) continue;
      add({ text: q.text, options: (q.options || []).filter(Boolean).slice(0, 6).map((o) => ({ label: o, sentence: o })) });
    }
    // 交代を記録したが守備位置が分からない → どこに入ったか
    for (const s of subAppl) {
      if (s.position) continue;
      const name = s.inName || nameOf(s.inId);
      add({
        text: t('gp.askSubPos', { name, inning: s.inning }),
        options: [
          ...FIELD_POS.map((p) => ({ label: posFull(p, lang), sentence: t('gp.askSubPosSentence', { inning: s.inning, name, pos: posFull(p, lang) }) })),
        ],
      });
    }
    // 守備位置を入れ替えた → 空いた位置に入ったのが誰か、念のため確認する
    for (const al of alignAppl) {
      if (!al.from || al.from === al.position) continue;
      const held = (alignMap.get(al.inning) || []).filter((x) => x.position === al.position && x.playerId !== al.playerId);
      if (!held.length) continue;
      const moved = nameOf(held[0].playerId);
      const others = (game.lineup || [])
        .filter((l) => l.playerId && l.playerId !== al.playerId && l.playerId !== held[0].playerId)
        .slice(0, 5)
        .map((l) => ({
          label: nameOf(l.playerId),
          sentence: t('gp.askSwapSentence', { inning: al.inning, name: nameOf(l.playerId), pos: posFull(al.from, lang) }),
        }));
      add({ text: t('gp.askSwap', { inning: al.inning, moved, pos: posFull(al.from, lang) }), options: others });
    }
    return out;
  };

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('gp.nlTitle')}</div>
      <p className="small dim" style={{ marginTop: 0 }}>{t('gp.nlDesc')}</p>
      <textarea
        rows={2} value={text} placeholder={t('gp.nlPlaceholder')}
        onChange={(e) => setText(e.target.value)} style={{ width: '100%' }}
      />
      <button className="primary mt8" style={{ width: '100%' }} disabled={!text.trim() || busy} onClick={apply}>
        {busy ? t('gp.nlInterpreting') : t('gp.nlApply')}
      </button>
      <p className="small dim mt8" style={{ marginBottom: 0 }}>
        {state.settings.geminiApiKey ? t('gp.nlAiOn') : t('gp.nlAiOff')}
      </p>
      {/* 1人が同じ回に2打席ある等、付け替えの重ねがけで壊れた状態を検出したときだけ出す修復 */}
      {(dupAtBats.length > 0 || orderBreaks > 0) && (
        <div className="warn-box mt8">
          ⚠️ {dupAtBats.length > 0
            ? t('gp.nlDupFound', {
              list: dupAtBats.map((d) => t('gp.nlDupItem', { name: nameOf(d.playerId), inning: d.inning, n: d.count })).join('、'),
            })
            : t('gp.nlOrderBroken', { n: orderBreaks })}
          <button
            className="mt8" style={{ width: '100%' }}
            onClick={() => {
              if (!window.confirm(t('gp.nlRebuildConfirm'))) return;
              dispatch({ type: 'REBUILD_BATTERS', gameId: game.id });
            }}
          >
            {t('gp.nlRebuild')}
          </button>
        </div>
      )}
      {/* 同じ選手が2つの打順に入っている: 位置の重複・不在をまとめて生む元なので先に直す */}
      {posIssues.sameSlots.length > 0 && (
        <div className="warn-box mt8">
          ⚠️ {posIssues.sameSlots.map((s) => t('gp.nlSlotDup', {
            range: inningRange(s), name: nameOf(s.playerId), orders: s.orders.join('・'),
          })).join(' ')}
          <button
            className="mt8" style={{ width: '100%' }}
            onClick={() => {
              if (!window.confirm(t('gp.nlSlotFixConfirm'))) return;
              dispatch({ type: 'FIX_DUPLICATE_SLOTS', gameId: game.id });
            }}
          >
            {t('gp.nlSlotFix')}
          </button>
        </div>
      )}
      {(posIssues.duplicates.length > 0 || posIssues.missing.length > 0) && (
        <div className="warn-box mt8">
          ⚠️ {[
            ...posIssues.duplicates.map((d) => t('gp.nlPosDup', {
              range: inningRange(d), pos: posFull(d.position, lang),
              names: d.playerIds.map((id) => nameOf(id)).join('・'),
            })),
            ...posIssues.missing.map((m) => t('gp.nlPosMissing', {
              range: inningRange(m), pos: posFull(m.position, lang),
            })),
          ].join(' ')}
          {/* 不在の位置は「誰が入ったか」をその場で選べるようにする */}
          {posIssues.missing.slice(0, 2).map((m) => (
            <div className="ask-item" key={`${m.position}${m.from}`}>
              <div className="ask-q">💬 {t('gp.askWhoPlays', { range: inningRange(m), pos: posFull(m.position, lang) })}</div>
              <div className="ask-chips">
                {(game.lineup || []).filter((l) => l.playerId).slice(0, 9).map((l) => (
                  <button
                    key={l.order} className="ask-chip"
                    onClick={() => setText(t('gp.askWhoPlaysSentence', {
                      range: m.from === m.to ? `${m.from}回` : `${m.from}〜${m.to}回`,
                      name: nameOf(l.playerId), pos: posFull(m.position, lang),
                    }))}
                  >
                    {nameOf(l.playerId)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="small dim mt8">{t('gp.nlPosFixHint')}</div>
        </div>
      )}
      {msg && (msg.kind === 'ok'
        ? <div className="small mt8" style={{ color: 'var(--green)', fontWeight: 700 }}>✅ {msg.text}</div>
        : <div className="warn-box mt8">⚠️ {msg.text}</div>
      )}
      {/* 聞き返し: 足りない情報・こちらの気づきを、その場で選んで詰められるようにする */}
      {asks.length > 0 && (
        <div className="ask-box mt8">
          <div className="small dim">{t('gp.askTitle')}</div>
          {asks.map((a) => (
            <div className="ask-item" key={a.id}>
              <div className="ask-q">💬 {a.text}</div>
              <div className="ask-chips">
                {a.options.map((o) => (
                  <button key={o.label} className="ask-chip" onClick={() => { setText(o.sentence); setAsks(asks.filter((x) => x.id !== a.id)); }}>
                    {o.label}
                  </button>
                ))}
                <button className="ask-chip skip" onClick={() => setAsks(asks.filter((x) => x.id !== a.id))}>{t('gp.askSkip')}</button>
              </div>
            </div>
          ))}
          <div className="small dim">{t('gp.askHint')}</div>
        </div>
      )}
    </div>
  );
}

// 線分スコア表(イニング別得点+計/安/失)。compact=true は試合レポート内に収める小型版で、
// チーム名を1行に省略表示して横スクロールなしで収まるようにする。
export function LinescoreTable({ game, compact = false }) {
  const { state } = useStore();
  const t = useT();
  const box = computeBoxScore(game);
  const myTeamName = state.settings.teamName || t('restab.teamFallback');
  const oppTeamName = game.opponent || t('restab.opponentFallback');
  const away = game.isHome ? oppTeamName : myTeamName; // 先攻(表)のチーム
  const home = game.isHome ? myTeamName : oppTeamName;
  const cell = (i) => (i.played ? (game.isHome ? i.opp : i.my) : '');
  const cellHome = (i) => (i.played ? (game.isHome ? i.my : i.opp) : '');

  return (
    <table className={`linescore-table${compact ? ' compact' : ''}`}>
      <thead>
        <tr>
          <th></th>
          {box.innings.map((i) => <th key={i.inning}>{i.inning}</th>)}
          <th>{t('gp.total')}</th><th>{t('gp.h')}</th><th>{t('gp.e')}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="team" title={away}>{away}</td>
          {box.innings.map((i) => <td key={i.inning}>{cell(i)}</td>)}
          <td className="num">{game.isHome ? box.opp.r : box.my.r}</td>
          <td className="num">{game.isHome ? box.opp.h : box.my.h}</td>
          <td className="num">{game.isHome ? box.opp.e : box.my.e}</td>
        </tr>
        <tr>
          <td className="team" title={home}>{home}</td>
          {box.innings.map((i) => <td key={i.inning}>{cellHome(i)}</td>)}
          <td className="num">{game.isHome ? box.my.r : box.opp.r}</td>
          <td className="num">{game.isHome ? box.my.h : box.opp.h}</td>
          <td className="num">{game.isHome ? box.my.e : box.opp.e}</td>
        </tr>
      </tbody>
    </table>
  );
}

// 試合結果タブにも埋め込めるよう、線分スコア+回別プレイを描画する中身部分。
// showLinescore=false は、呼び出し側(試合レポート)が既に線分スコアを出している場合に使う。
export function GameProgressContent({ game, editable = false, showLinescore = true }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const [editLog, setEditLog] = useState(null);
  // 'run'ログは各プレイカード内のmoveLinesに既に含まれるため二重表示を避ける
  const groups = groupByHalfInning(game.playLogs.filter((l) => l.kind !== 'run' && l.kind !== 'position'));
  const myTeamName = state.settings.teamName || t('restab.teamFallback');
  const oppTeamName = game.opponent || t('restab.opponentFallback');

  return (
    <div>
      {showLinescore && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <LinescoreTable game={game} compact />
        </div>
      )}

      {editable && groups.length > 0 && <NLCorrectionCard game={game} />}

      {groups.length === 0 && <div className="dim small" style={{ padding: '0 4px' }}>{t('score.noPlays')}</div>}

      {groups.map((grp) => {
        const battingTeam = (grp.isTop !== game.isHome) ? myTeamName : oppTeamName;
        return (
          <div key={grp.key} className="inning-group">
            <div className="inning-header">
              <b>{t('score.logInning', { inning: grp.inning, half: t(grp.isTop ? 'half.top' : 'half.bottom') })}</b>
              <span className="dim">{battingTeam}</span>
            </div>
            {toDisplayRows([...grp.logs].reverse()).map((row) =>
              row.isCard
                ? (
                  <PlayCard
                    key={row.log.id}
                    log={row.log}
                    nameOf={nameOf}
                    numberOf={numberOf}
                    oppName={(letter) => oppNameOf(game, letter)}
                    edition={state.settings.edition}
                    lang={lang}
                    t={t}
                    onEdit={editable ? setEditLog : null}
                  />
                )
                : <SimpleLogLine key={row.log.id} log={row.log} count={row.count} />
            )}
          </div>
        );
      })}

      {editLog && <EditPlaySheet game={game} log={editLog} onClose={() => setEditLog(null)} />}
    </div>
  );
}

// 独立した全画面ビュー(「試合経過」への遷移用)
export default function GameProgressView({ game, onClose }) {
  const t = useT();
  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('action.back')}</button>
        <h2>{t('restab.progress')}</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <GameProgressContent game={game} editable />
      </div>
    </FullscreenView>
  );
}

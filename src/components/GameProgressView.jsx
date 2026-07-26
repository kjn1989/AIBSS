import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES, resultCategory, multiOutLabel, outTypeLabel } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { computeBoxScore } from '../lib/boxscore.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitutions, parseBatterReassignments, parseResultCorrections, parsePositionCorrections, parseDefensiveAlignment } from '../lib/correctionParser.js';
import { posFull, buildLineupRows, findPositionIssues } from '../lib/lineupBox.js';
import { findDuplicateAtBats, canRebuildOrders, findOrderBreaks } from '../lib/battersRebuild.js';
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
function PlayCard({ log, nameOf, numberOf, onEdit, edition, lang, t }) {
  const p = log.payload || {};
  const isDefense = log.kind === 'defense';
  const name = isDefense ? p.letter : nameOf(p.playerId);
  const number = isDefense ? null : numberOf(p.playerId);
  const category = resultCategory(p.result);
  const label = playLabel(p.result, p.direction, p.outType, p.soType, edition, lang);
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
      patch: { result, direction, outType, soType, ...(isAtBat && rbi !== null ? { rbi } : {}) },
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
          <button key={k} className={`small ${result === k ? 'primary' : ''}`} onClick={() => setResult(k)}>
            {lang === 'ja' ? def.label : t(`result.${k}`)}
          </button>
        ))}
      </div>

      <div className="section-title">{t('gp.direction')}</div>
      <div className="grid3">
        {Object.keys(DIRECTIONS).map((k) => (
          <button key={k} className={`small ${direction === k ? 'primary' : ''}`} onClick={() => setDirection(direction === k ? null : k)}>
            {lang === 'ja' ? DIRECTIONS[k] : t(`dir.${k}`)}
          </button>
        ))}
      </div>

      {result === 'out' && (
        <>
          <div className="section-title">{t('playsheet.outType')}</div>
          <div className="grid2">
            {Object.keys(OUT_TYPES).map((k) => (
              <button key={k} className={`small ${outType === k ? 'primary' : ''}`} onClick={() => setOutType(k)}>{lang === 'ja' ? outTypeLabel(k, state.settings.edition) : t(`outType.${k}`)}</button>
            ))}
          </div>
        </>
      )}
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
  const [busy, setBusy] = useState(false);
  // 付け替えの重ねがけで壊れた打席の検出(同じ回に2打順で打席 / 打順の並びのズレ)
  const dupAtBats = findDuplicateAtBats(game);
  const orderBreaks = canRebuildOrders(game) ? findOrderBreaks(game) : 0;
  const posIssues = findPositionIssues(game); // 同じ守備位置に2人 / 守備位置が不在

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
      result: playLabel(l.payload?.result, l.payload?.direction, l.payload?.outType, l.payload?.soType, state.settings.edition, lang),
    })),
  });
  // 同名で二重登録された選手がいる場合、この試合に既に出ている方を優先して選ぶ
  // (別レコードを掴むと「同じ人」と繋がらず、打順移動や成績が分断されるため)。
  const inThisGame = new Set([
    ...(game.lineup || []).map((l) => l.playerId),
    ...(game.startingLineup || []).map((l) => l.playerId),
    ...(game.atBats || []).map((a) => a.playerId),
    ...(game.playLogs || []).flatMap((l) => [l.payload?.playerId, l.payload?.in, l.payload?.out]),
  ].filter(Boolean));
  const idByName = (nm) => {
    const matches = state.players.filter((p) => p.name === nm);
    return (matches.find((p) => inThisGame.has(p.id)) || matches[0])?.id || null;
  };
  const clean = (v) => (v && v !== 'null' ? v : null);

  // AIの操作配列 → 中間表現(regexパスと同形 { subs, reassigns, resultCorrs })
  const aiOpsToIntermediate = (ops) => {
    const subs = []; const reassigns = []; const resultCorrs = []; const posCorrs = []; const aligns = [];
    const num = (v) => (v == null || v === 'null' || v === '' ? null : Number(v)); // AIの文字列数値に備える
    for (const op of ops || []) {
      const inning = num(op.inning);
      if (op.type === 'defense' && inning) {
        // 「◯回の守備は◯◯」= 出場中の選手の守備位置変更(交代ではない)
        const pid = idByName(op.player);
        if (pid && clean(op.position)) aligns.push({ inning, playerId: pid, playerName: op.player, position: clean(op.position) });
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
        resultCorrs.push({ inning, batterId: idByName(op.batter), patch: {
          result: op.result, direction: clean(op.direction),
          outType: op.result === 'out' ? (clean(op.outType) || 'ground') : null,
          soType: op.result === 'so' ? 'swinging' : null,
          ...(num(op.rbi) != null ? { rbi: num(op.rbi) } : {}),
        } });
      }
    }
    return { subs, reassigns, resultCorrs, posCorrs, aligns };
  };
  const produceRegex = () => ({
    subs: parseSubstitutions(text, state.players),
    reassigns: parseBatterReassignments(text, state.players),
    resultCorrs: parseResultCorrections(text, state.players),
    posCorrs: parsePositionCorrections(text, state.players),
    aligns: parseDefensiveAlignment(text, state.players),
  });
  const isEmpty = (im) => !(im.subs.length || im.reassigns.length || im.resultCorrs.length || im.posCorrs.length || im.aligns.length);

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
      resultCorrs: uniq([...(a.resultCorrs || []), ...(b.resultCorrs || [])], (rc) => `${rc.inning}|${rc.patch.result}`),
      posCorrs: uniq([...(a.posCorrs || []), ...(b.posCorrs || [])], (pc) => `${pc.playerId}`),
      aligns: uniq([...(a.aligns || []), ...(b.aligns || [])], (al) => `${al.inning}|${al.playerId}`),
    };
  };

  const apply = async () => {
    setMsg(null);
    const apiKey = state.settings.geminiApiKey;
    let im = produceRegex(); // まず端末内で解釈(常に土台にする)
    // 実際にAI解釈まで届いたのかを毎回はっきり示す(キーの有無だけでは分からないため)
    let mode = !apiKey ? 'nokey' : !navigator.onLine ? 'offline' : 'local';
    let detail = '';
    if (apiKey && navigator.onLine) {
      setBusy(true);
      try {
        const r = await interpretCorrection({ apiKey, text, ...buildContext() });
        if (r && r.error) { mode = 'error'; detail = r.error; } // 原因(キー/上限/通信)を持ち帰る
        else if (r && r.ops) { im = mergeIm(aiOpsToIntermediate(r.ops), im); mode = 'ai'; } // AIを重ねて統合
        else { mode = 'error'; detail = t('gp.nlAiNoResponse'); }
      } catch (e) { mode = 'error'; detail = e?.message || ''; } // AI失敗→端末内解釈のまま
      setBusy(false);
    }
    resolveAndApply(im, mode, detail);
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

  const resolveAndApply = (im, mode = 'local', detail = '') => {
    const { reassigns, resultCorrs, posCorrs = [], aligns = [] } = im;
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

    const alignAppl = [];
    const alignUnresolved = [];
    const alreadyOk = []; // 既にその守備位置(黙って捨てると別のエラーが出て紛らわしいので記録する)
    for (const al of aligns) {
      // 既に出場している選手は「自分の打順のまま守備位置だけ変更」。
      // ここで他人の打順への交代にしてしまうと、その打順の打席まで付け替わり、
      // 同じ回に2打席ある等の壊れた記録になるため、必ず自分のスロットで処理する。
      const own = slotOfPlayer(al.playerId);
      if (own) {
        if (own.from === al.position) {
          alreadyOk.push(`${own.order}${t('gp.nlOrderSuffix')} ${al.playerName || nameOf(al.playerId)}（${posFull(al.position, lang)}）`);
          continue;
        }
        alignAppl.push({ ...al, order: own.order, from: own.from });
      } else {
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
      let order = resolveOrder(s.outId);
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
    // 付け替えから「代打/代走」の交代も合成し、出場選手ツリーに反映(以降の回も自動付け替え)
    const synthSubs = [];
    const seenPair = new Set();
    for (const r of reAppl) {
      if (!r.targetId) continue;
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
    for (const rc of resultCorrs) {
      // 打者名が書かれていればそれを最優先(同じ回に複数の打席があっても特定できる)
      let logId = null;
      if (rc.batterId) {
        const l = (game.playLogs || []).find((x) => x.kind === 'atbat'
          && Number(x.inning) === Number(rc.inning) && x.payload?.playerId === rc.batterId);
        if (l) logId = l.id;
      }
      if (!logId) logId = inningToLog.get(rc.inning);
      if (!logId) { const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat' && l.inning === rc.inning); if (logs.length === 1) logId = logs[0].id; }
      if (logId) resAppl.push({ ...rc, logId });
    }

    const totalOps = subAppl.length + synthSubs.length + reAppl.length + resAppl.length + posAppl.length + alignAppl.length;
    if (!totalOps) {
      const note = modeNote(mode, detail); // どの経路で解釈したかを添える(AI未接続かの切り分け用)
      // 指定どおりに既になっている場合は「エラー」ではないので、そう伝える
      if (alreadyOk.length) { setMsg({ kind: 'ok', text: t('gp.nlAlreadyOk', { list: alreadyOk.join('、') }) + note }); return; }
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
      ...alignAppl.map((al) => t('gp.nlAlignItem', {
        inning: al.inning, order: al.order, name: al.playerName || nameOf(al.playerId),
        from: al.from ? posFull(al.from, lang) : '—', to: posFull(al.position, lang),
      })),
      ...posAppl.map((pc) => t('gp.nlPosItem', {
        order: pc.order, name: pc.playerName || nameOf(pc.playerId),
        from: pc.from ? posFull(pc.from, lang) : '—', to: posFull(pc.position, lang),
      })),
      ...subAppl.map(subLabel),
      ...synthSubs.map(subLabel),
      ...reAppl.map((r) => t('gp.nlReItem', { inning: r.inning, name: r.newName })),
      ...resAppl.map((rc) => t('gp.nlResItem', {
        inning: rc.inning,
        who: rc.batterId ? ` ${rc.batterName || nameOf(rc.batterId)}` : '',
        label: playLabel(rc.patch.result, rc.patch.direction, rc.patch.outType, rc.patch.soType, state.settings.edition, lang),
      })),
    ];
    if (!window.confirm(t('gp.nlConfirmOps', { list: lines.join('\n') }))) return;

    const doSub = (s) => {
      const kindLabel = { ph: t('box.rolePh'), pr: t('box.rolePr'), def: t('gp.subDef') }[s.subKind] || t('gp.subDef');
      dispatch({ type: 'RETRO_SUBSTITUTE', gameId: game.id, order: s.order, outId: s.outId, inId: s.inId, position: s.position, subKind: s.subKind, inning: s.inning, afterOppOrder: s.afterOppOrder ?? null, label: `${kindLabel}: ${nameOf(s.inId)} (${s.order}番 ${nameOf(s.outId)}に代わり)` });
    };
    posAppl.forEach((pc) => dispatch({ type: 'FIX_STARTING_POSITION', gameId: game.id, playerId: pc.playerId, position: pc.position }));
    alignAppl.forEach((al) => dispatch({ type: 'RETRO_POSITION', gameId: game.id, order: al.order, playerId: al.playerId, position: al.position, inning: al.inning }));
    synthSubs.forEach(doSub);
    subAppl.forEach(doSub);
    reAppl.forEach((r) => dispatch({ type: 'REASSIGN_ATBAT', gameId: game.id, logId: r.logId, newPlayerId: r.newId }));
    resAppl.forEach((rc) => dispatch({ type: 'EDIT_PLAY_LOG', gameId: game.id, logId: rc.logId, patch: rc.patch }));
    const hasPitcherChange = subAppl.some((s) => s.position === '投');
    if (hasPitcherChange) dispatch({ type: 'RECOMPUTE_PITCHING', gameId: game.id });

    const notes = [];
    if (posUnresolved.length) notes.push(t('gp.nlPosNotStarterShort', { names: posUnresolved.join('、') }));
    if (subUnresolved.length) notes.push(t('gp.nlSubNoOrderShort', { names: subUnresolved.join('、') }));
    if (reUnresolved.length) notes.push(t('gp.nlReNotFoundShort', { innings: reUnresolved.join('、') }));
    setMsg({ kind: 'ok', text: t('gp.nlDoneOps', { n: totalOps }) + (hasPitcherChange ? t('gp.nlPitchRecalc') : '') + notes.join('') + modeNote(mode, detail) });
    setText('');
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
      {(posIssues.duplicates.length > 0 || posIssues.missing.length > 0) && (
        <div className="warn-box mt8">
          ⚠️ {[
            ...posIssues.duplicates.map((d) => t('gp.nlPosDup', {
              pos: posFull(d.position, lang), names: d.playerIds.map((id) => nameOf(id)).join('・'),
            })),
            ...(posIssues.missing.length ? [t('gp.nlPosMissing', { list: posIssues.missing.map((p) => posFull(p, lang)).join('・') })] : []),
          ].join(' ')}
          <div className="small dim mt8">{t('gp.nlPosFixHint')}</div>
        </div>
      )}
      {msg && (msg.kind === 'ok'
        ? <div className="small mt8" style={{ color: 'var(--green)', fontWeight: 700 }}>✅ {msg.text}</div>
        : <div className="warn-box mt8">⚠️ {msg.text}</div>
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

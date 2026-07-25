import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES, resultCategory, multiOutLabel, outTypeLabel } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { computeBoxScore } from '../lib/boxscore.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitutions, parseBatterReassignments, parseResultCorrections } from '../lib/correctionParser.js';
import { posFull } from '../lib/lineupBox.js';
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
  const idByName = (nm) => state.players.find((p) => p.name === nm)?.id || null;
  const clean = (v) => (v && v !== 'null' ? v : null);

  // AIの操作配列 → 中間表現(regexパスと同形 { subs, reassigns, resultCorrs })
  const aiOpsToIntermediate = (ops) => {
    const subs = []; const reassigns = []; const resultCorrs = [];
    for (const op of ops || []) {
      if (op.type === 'reassign' && op.inning) {
        const newId = idByName(op.to);
        if (newId) reassigns.push({ inning: op.inning, ordinal: op.ordinal || null, targetId: idByName(op.from), targetName: op.from, newId, newName: op.to });
      } else if (op.type === 'substitution' && op.inning) {
        const outId = idByName(op.out); const inId = idByName(op.in);
        if (outId && inId) subs.push({ inning: op.inning, outId, outName: op.out, inId, inName: op.in, position: clean(op.position), subKind: op.role || 'def' });
      } else if (op.type === 'result' && op.inning && op.result) {
        resultCorrs.push({ inning: op.inning, batterId: idByName(op.batter), patch: {
          result: op.result, direction: clean(op.direction),
          outType: op.result === 'out' ? (clean(op.outType) || 'ground') : null,
          soType: op.result === 'so' ? 'swinging' : null,
          ...(op.rbi != null ? { rbi: op.rbi } : {}),
        } });
      }
    }
    return { subs, reassigns, resultCorrs };
  };
  const produceRegex = () => ({
    subs: parseSubstitutions(text, state.players),
    reassigns: parseBatterReassignments(text, state.players),
    resultCorrs: parseResultCorrections(text),
  });
  const isEmpty = (im) => !(im.subs.length || im.reassigns.length || im.resultCorrs.length);

  const apply = async () => {
    setMsg(null);
    const apiKey = state.settings.geminiApiKey;
    let im = null;
    if (apiKey && navigator.onLine) {
      setBusy(true);
      try {
        const r = await interpretCorrection({ apiKey, text, ...buildContext() });
        if (r && r.ops) im = aiOpsToIntermediate(r.ops);
      } catch { /* AI失敗→オフライン解釈へフォールバック */ }
      setBusy(false);
    }
    if (!im || isEmpty(im)) im = produceRegex(); // AI未使用/未解釈は端末内パーサで
    resolveAndApply(im);
  };

  const resolveAndApply = (im) => {
    const { subs, reassigns, resultCorrs } = im;
    // 明示的な交代(守備/投手/代打…)。連鎖(A→B→C)は入った選手が打順を引き継ぐ。
    const orderCache = new Map();
    const resolveOrder = (pid) => (orderCache.has(pid) ? orderCache.get(pid) : orderOf(pid));
    const subAppl = [];
    const subUnresolved = [];
    for (const s of subs) {
      const order = resolveOrder(s.outId);
      if (order == null) { subUnresolved.push(s.outName); continue; }
      orderCache.set(s.outId, order); orderCache.set(s.inId, order);
      subAppl.push({ ...s, order });
    }

    // 複数回の打者付け替えを、対象の打席ログへ解決
    const reAppl = [];
    const inningToLog = new Map();
    const reUnresolved = [];
    for (const r of reassigns) {
      const found = findTargetAtBat(game, { inning: r.inning, ordinal: r.ordinal, targetPlayerId: r.targetId });
      if (found.ok) { reAppl.push({ ...r, logId: found.log.id }); inningToLog.set(r.inning, found.log.id); }
      else reUnresolved.push(`${r.inning}回`);
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
      let logId = inningToLog.get(rc.inning);
      if (!logId && rc.batterId) {
        const l = (game.playLogs || []).find((x) => x.kind === 'atbat' && x.inning === rc.inning && x.payload?.playerId === rc.batterId);
        if (l) logId = l.id;
      }
      if (!logId) { const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat' && l.inning === rc.inning); if (logs.length === 1) logId = logs[0].id; }
      if (logId) resAppl.push({ ...rc, logId });
    }

    const totalOps = subAppl.length + synthSubs.length + reAppl.length + resAppl.length;
    if (!totalOps) {
      const single = parseBatterCorrection(text, state.players);
      const key = !single.ok
        ? ({ noInning: 'gp.nlErrInning', empty: 'gp.nlErrInning', noTarget: 'gp.nlErrTarget', noNewName: 'gp.nlErrNewName' }[single.reason] || 'gp.nlErrInning')
        : 'gp.nlErrNotFound';
      setMsg({ kind: 'err', text: t(key) });
      return;
    }

    const subLabel = (s) => t('gp.nlSubItem', { inning: s.inning, out: s.outName, in: s.inName, pos: s.position ? posFull(s.position, lang) : t('gp.nlSubNoPos') });
    const lines = [
      ...subAppl.map(subLabel),
      ...synthSubs.map(subLabel),
      ...reAppl.map((r) => t('gp.nlReItem', { inning: r.inning, name: r.newName })),
      ...resAppl.map((rc) => t('gp.nlResItem', { inning: rc.inning, label: playLabel(rc.patch.result, rc.patch.direction, rc.patch.outType, rc.patch.soType, state.settings.edition, lang) })),
    ];
    if (!window.confirm(t('gp.nlConfirmOps', { list: lines.join('\n') }))) return;

    const doSub = (s) => {
      const kindLabel = { ph: t('box.rolePh'), pr: t('box.rolePr'), def: t('gp.subDef') }[s.subKind] || t('gp.subDef');
      dispatch({ type: 'RETRO_SUBSTITUTE', gameId: game.id, order: s.order, outId: s.outId, inId: s.inId, position: s.position, subKind: s.subKind, inning: s.inning, label: `${kindLabel}: ${nameOf(s.inId)} (${s.order}番 ${nameOf(s.outId)}に代わり)` });
    };
    synthSubs.forEach(doSub);
    subAppl.forEach(doSub);
    reAppl.forEach((r) => dispatch({ type: 'REASSIGN_ATBAT', gameId: game.id, logId: r.logId, newPlayerId: r.newId }));
    resAppl.forEach((rc) => dispatch({ type: 'EDIT_PLAY_LOG', gameId: game.id, logId: rc.logId, patch: rc.patch }));
    const hasPitcherChange = subAppl.some((s) => s.position === '投');
    if (hasPitcherChange) dispatch({ type: 'RECOMPUTE_PITCHING', gameId: game.id });

    const notes = [];
    if (subUnresolved.length) notes.push(t('gp.nlSubNoOrderShort', { names: subUnresolved.join('、') }));
    if (reUnresolved.length) notes.push(t('gp.nlReNotFoundShort', { innings: reUnresolved.join('、') }));
    setMsg({ kind: 'ok', text: t('gp.nlDoneOps', { n: totalOps }) + (hasPitcherChange ? t('gp.nlPitchRecalc') : '') + notes.join('') });
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
      {msg && (msg.kind === 'ok'
        ? <div className="small mt8" style={{ color: 'var(--green)', fontWeight: 700 }}>✅ {msg.text}</div>
        : <div className="warn-box mt8">⚠️ {msg.text}</div>
      )}
    </div>
  );
}

// 試合結果タブにも埋め込めるよう、線分スコア+回別プレイを描画する中身部分
export function GameProgressContent({ game, editable = false }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const [editLog, setEditLog] = useState(null);
  const box = computeBoxScore(game);
  // 'run'ログは各プレイカード内のmoveLinesに既に含まれるため二重表示を避ける
  const groups = groupByHalfInning(game.playLogs.filter((l) => l.kind !== 'run' && l.kind !== 'position'));
  const myTeamName = state.settings.teamName || t('restab.teamFallback');
  const oppTeamName = game.opponent || t('restab.opponentFallback');

  return (
    <div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="linescore-table">
          <thead>
            <tr>
              <th></th>
              {box.innings.map((i) => <th key={i.inning}>{i.inning}</th>)}
              <th>{t('gp.total')}</th><th>{t('gp.h')}</th><th>{t('gp.e')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="team">{game.isHome ? oppTeamName : myTeamName}</td>
              {box.innings.map((i) => (
                <td key={i.inning}>{i.played ? (game.isHome ? i.opp : i.my) : ''}</td>
              ))}
              <td className="num">{game.isHome ? box.opp.r : box.my.r}</td>
              <td className="num">{game.isHome ? box.opp.h : box.my.h}</td>
              <td className="num">{game.isHome ? box.opp.e : box.my.e}</td>
            </tr>
            <tr>
              <td className="team">{game.isHome ? myTeamName : oppTeamName}</td>
              {box.innings.map((i) => (
                <td key={i.inning}>{i.played ? (game.isHome ? i.my : i.opp) : ''}</td>
              ))}
              <td className="num">{game.isHome ? box.my.r : box.opp.r}</td>
              <td className="num">{game.isHome ? box.my.h : box.opp.h}</td>
              <td className="num">{game.isHome ? box.my.e : box.opp.e}</td>
            </tr>
          </tbody>
        </table>
      </div>

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

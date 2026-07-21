import React, { useState, useEffect } from 'react';
import { useStore, useT, useCurrentGame, usePlayerName, isMyTeamBatting, currentBatter, currentOppBatter } from '../state/store.jsx';
import Scoreboard from './Scoreboard.jsx';
import Diamond from './Diamond.jsx';
import PitchCounter from './PitchCounter.jsx';
import ResultPad from './ResultPad.jsx';
import PlaySheet from './PlaySheet.jsx';
import RunnerEventSheet from './RunnerEventSheet.jsx';
import Sheet from './Sheet.jsx';
import VoiceControl from './VoiceControl.jsx';
import { SubstituteSheet } from './OrderTab.jsx';
import HighlightSheet from './HighlightSheet.jsx';
import GameProgressView from './GameProgressView.jsx';
import { POSITIONS, OPP_LETTERS, resultCategory, multiOutLabel, positionLabel } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { convertMemoToPlay, guessPlayFromMemo, maskNames } from '../lib/gemini.js';
import { RULE_PRESETS, presetById, presetLabel, describeRules, initialPresetIdFor, gameEndCheck, pitchLimitCheck, timeLimitCheck } from '../lib/rules.js';

// ---- 直近の打席結果を「1. 左翼単打 2. 見逃し三振」のように並べる小さな履歴表示 ----
function AtBatHistory({ items, edition, lang }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="atbat-history">
      {items.map((it, i) => (
        <span className={`hist-chip ${resultCategory(it.result)}`} key={it.id}>
          {i + 1}. {playLabel(it.result, it.direction, it.outType, it.soType, edition, lang)}
          {multiOutLabel(it.outsOnPlay || 0) && <span className="mini-badge"> ⚡</span>}
        </span>
      ))}
    </div>
  );
}

// ---- 相手投手/相手打者の左右を任意入力する小さなトグル(左右別スタッツ用) ----
// 記号(letter)ごとに R/L(打者は両=S)を game に保存。空=未設定は集計対象外。
function OppHandToggle({ game, which, letter, allowSwitch = false }) {
  const { dispatch } = useStore();
  const t = useT();
  if (!letter) return null;
  const cur = (which === 'pitcher' ? game.oppPitcherHands : game.oppBatterHands)?.[letter] || '';
  const opts = allowSwitch ? ['R', 'L', 'S'] : ['R', 'L'];
  const set = (h) => dispatch({ type: 'SET_OPP_HAND', gameId: game.id, which, letter, hand: cur === h ? '' : h });
  return (
    <div className="hand-inline">
      <span className="small dim">{which === 'pitcher' ? t('score.handP') : t('score.handB')}</span>
      {opts.map((h) => (
        <button key={h} className={`hl-btn ${cur === h ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); set(h); }}>{t(`hand.${h}`)}</button>
      ))}
    </div>
  );
}

// ---- ルール選択の共有ロジック(試合作成/進行中の変更で共用) ----
const EMPTY_CUSTOM = { innings: '7', mercyAfter: '', mercyDiff: '', pitchPerGame: '', timeLimitMin: '' };

// presetId + customフォーム → rulesオブジェクト(またはnull)
function resolveRulesFrom(presetId, custom) {
  if (presetId === 'none') return null;
  if (presetId === 'custom') {
    const innings = Math.max(1, parseInt(custom.innings, 10) || 7);
    const after = parseInt(custom.mercyAfter, 10);
    const diff = parseInt(custom.mercyDiff, 10);
    const mercy = Number.isFinite(after) && Number.isFinite(diff) && after > 0 && diff > 0 ? [{ after, diff }] : [];
    const perGame = parseInt(custom.pitchPerGame, 10);
    const pitchLimit = Number.isFinite(perGame) && perGame > 0 ? { perGame, warnAt: Math.max(1, perGame - 10) } : null;
    const tl = parseInt(custom.timeLimitMin, 10);
    const timeLimitMin = Number.isFinite(tl) && tl > 0 ? tl : null;
    return { innings, mercy, pitchLimit, timeLimitMin };
  }
  return presetById(presetId)?.rules || null;
}

// rulesオブジェクト → カスタムフォームの初期値
function customFromRules(rules) {
  const base = rules || { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: null };
  return {
    innings: String(base.innings || 7),
    mercyAfter: base.mercy?.[0] ? String(base.mercy[0].after) : '',
    mercyDiff: base.mercy?.[0] ? String(base.mercy[0].diff) : '',
    pitchPerGame: base.pitchLimit?.perGame ? String(base.pitchLimit.perGame) : '',
    timeLimitMin: base.timeLimitMin ? String(base.timeLimitMin) : '',
  };
}

// ルール選択UI(プリセット選択+カスタム入力+説明)。作成時・変更時で共用。
function RulePicker({ presetId, custom, edition, onPresetChange, setCustom }) {
  const t = useT();
  const { state } = useStore();
  const lang = state.settings.lang || 'ja';
  return (
    <>
      <label className="small dim" style={{ display: 'block' }}>{t('score.rules')}</label>
      <select value={presetId} onChange={(e) => onPresetChange(e.target.value)}>
        {RULE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{presetLabel(p, lang)}{p.edition === edition ? '' : ` (${lang === 'en' ? t(`edition.${p.edition}`) : p.edition})`}</option>
        ))}
        <option value="custom">{t('score.rulesCustom')}</option>
        <option value="none">{t('score.rulesNone')}</option>
      </select>
      {presetId === 'custom' && (
        <div className="mt8">
          <div className="grid3">
            <div>
              <label className="small dim">{t('score.innings')}</label>
              <input type="number" inputMode="numeric" value={custom.innings} onChange={(e) => setCustom({ ...custom, innings: e.target.value })} />
            </div>
            <div>
              <label className="small dim">{t('score.mercyAfter')}</label>
              <input type="number" inputMode="numeric" placeholder={t('score.none')} value={custom.mercyAfter} onChange={(e) => setCustom({ ...custom, mercyAfter: e.target.value })} />
            </div>
            <div>
              <label className="small dim">{t('score.mercyDiff')}</label>
              <input type="number" inputMode="numeric" placeholder={t('score.none')} value={custom.mercyDiff} onChange={(e) => setCustom({ ...custom, mercyDiff: e.target.value })} />
            </div>
          </div>
          <div className="grid2 mt8">
            <div>
              <label className="small dim">{t('score.pitchLimitField')}</label>
              <input type="number" inputMode="numeric" placeholder={t('score.egPitch')} value={custom.pitchPerGame} onChange={(e) => setCustom({ ...custom, pitchPerGame: e.target.value })} />
            </div>
            <div>
              <label className="small dim">{t('score.timeLimitField')}</label>
              <input type="number" inputMode="numeric" placeholder={t('score.egTime')} value={custom.timeLimitMin} onChange={(e) => setCustom({ ...custom, timeLimitMin: e.target.value })} />
            </div>
          </div>
        </div>
      )}
      <p className="small dim mt8">
        {describeRules(resolveRulesFrom(presetId, custom), lang)}
        {presetId !== 'none' && <><br />{t('score.rulesNote')}</>}
      </p>
    </>
  );
}

// ---- 試合セットアップ(試合がない/選択されていないとき) ----
function GameSetup() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [opponent, setOpponent] = useState('');
  const [isHome, setIsHome] = useState(false);
  const [season, setSeason] = useState('');
  const edition = state.settings.edition || '草野球';
  // ルール選択: 前回の選択を記憶(ただしエディションが一致する場合のみ)。初回はエディションの既定プリセット
  const [presetId, setPresetId] = useState(initialPresetIdFor(state.settings.lastRulePresetId, edition));
  const [custom, setCustom] = useState(EMPTY_CUSTOM);
  const ongoing = Object.values(state.games).filter((g) => g.status === 'ongoing' && !g.id.startsWith('demo-'));
  // 既存試合で使われたシーズン名(サジェスト用)
  const knownSeasons = [...new Set(Object.values(state.games).map((g) => g.season).filter(Boolean))];

  const onPresetChange = (id) => {
    setPresetId(id);
    // カスタム選択時は、直前のプリセット内容を初期値として引き継ぐ
    if (id === 'custom') setCustom(customFromRules(presetById(presetId)?.rules));
  };

  const startGame = () => {
    dispatch({ type: 'CREATE_GAME', payload: { opponent, isHome, season: season.trim(), rules: resolveRulesFrom(presetId, custom) } });
    dispatch({ type: 'UPDATE_SETTINGS', patch: { lastRulePresetId: presetId } });
  };

  return (
    <div>
      <div className="card">
        <h2>{t('gamesetup.title')}</h2>
        <label className="small dim">{t('gamesetup.opponent')}</label>
        <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder={t('gamesetup.opponent.placeholder')} />
        <label className="small dim mt8" style={{ display: 'block' }}>{t('gamesetup.season')}</label>
        <input
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          placeholder={t('gamesetup.season.placeholder')}
          list="season-suggest"
        />
        {knownSeasons.length > 0 && (
          <datalist id="season-suggest">
            {knownSeasons.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
        <div className="toggle-row mt12">
          <button className={!isHome ? 'active' : ''} onClick={() => setIsHome(false)}>{t('gamesetup.first')}</button>
          <button className={isHome ? 'active' : ''} onClick={() => setIsHome(true)}>{t('gamesetup.second')}</button>
        </div>

        <RulePicker presetId={presetId} custom={custom} edition={edition} onPresetChange={onPresetChange} setCustom={setCustom} />

        <button className="primary" style={{ width: '100%' }} onClick={startGame}>
          {t('gamesetup.start')}
        </button>
      </div>

      {ongoing.length > 0 && (
        <div className="card">
          <h2>{t('gamesetup.resume.title')}</h2>
          {ongoing.map((g) => (
            <div className="row" key={g.id}>
              <div className="grow">
                <div>{g.date} {t('gamesetup.resume.vs')} {g.opponent || t('gamesetup.opponent.fallback')}</div>
                <div className="dim">{g.myScore}-{g.oppScore} {t(g.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: g.inning })}</div>
              </div>
              <button className="small primary" onClick={() => dispatch({ type: 'SELECT_GAME', id: g.id })}>{t('gamesetup.resume.button')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 打者変更シート ----
function BatterSheet({ game, onClose, onPinchHitter }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  return (
    <Sheet title={t('sheet.nextBatter')} onClose={onClose}>
      <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={onPinchHitter}>
        {t('sheet.pinchHitter', { name: nameOf(currentBatter(game)?.playerId) })}
      </button>
      {game.lineup.map((slot, i) => (
        <div className="row" key={slot.order}>
          <span className="rank-badge">{slot.order}</span>
          <span className="grow">{nameOf(slot.playerId)} <span className="dim small">{positionLabel(slot.position, lang)}</span></span>
          <button
            className={`small ${i === game.batterIndex ? 'primary' : ''}`}
            onClick={() => {
              dispatch({ type: 'SET_BATTER_INDEX', gameId: game.id, index: i });
              onClose();
            }}
          >
            {i === game.batterIndex ? t('score.atBatNow') : t('score.thisBatter')}
          </button>
        </div>
      ))}
    </Sheet>
  );
}

// ---- 相手打者変更シート(記号A〜Tで管理) ----
function OppBatterSheet({ game, onClose, onPinchHitter }) {
  const { dispatch } = useStore();
  const t = useT();
  const current = currentOppBatter(game);
  return (
    <Sheet title={t('score.selectOppBatter')} onClose={onClose}>
      <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={onPinchHitter}>
        {t('score.oppPinchHit', { letter: current?.letter })}
      </button>
      {game.oppLineup.map((slot, i) => (
        <div className="row" key={slot.order}>
          <span className="rank-badge">{slot.order}</span>
          <span className="grow">{slot.letter}</span>
          <button
            className={`small ${i === game.oppBatterIndex ? 'primary' : ''}`}
            onClick={() => {
              dispatch({ type: 'OPP_SET_BATTER_INDEX', gameId: game.id, index: i });
              onClose();
            }}
          >
            {i === game.oppBatterIndex ? t('score.atBatNow') : t('score.thisBatter')}
          </button>
        </div>
      ))}
    </Sheet>
  );
}

// ---- 相手選手交代シート(代打・代走・守備交代。実名の代わりにA〜Tの記号を使う) ----
function OppSubstituteSheet({ game, slot, onClose, initialKind = 'ph' }) {
  const { dispatch } = useStore();
  const t = useT();
  const [kind, setKind] = useState(initialKind); // ph=代打 pr=代走 def=守備交代
  const [letter, setLetter] = useState('');

  const inLineup = new Set(game.oppLineup.map((l) => l.letter));
  const candidates = OPP_LETTERS.filter((l) => !inLineup.has(l));
  const isRetired = letter && game.oppRetiredLetters.includes(letter);
  const kindLabel = t(`order.sub.${kind}`);

  const runnerBase = [1, 2, 3].find((b) => game.runners[b]?.letter === slot.letter);

  return (
    <Sheet title={t('score.oppSubTitle', { order: slot.order, letter: slot.letter })} onClose={onClose}>
      <div className="grid3">
        {['ph', 'pr', 'def'].map((k) => (
          <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
            {t(`order.sub.${k}`)}
          </button>
        ))}
      </div>

      {kind === 'pr' && !runnerBase && (
        <div className="warn-box mt8">{t('order.sub.prNoRunner')}</div>
      )}

      <div className="section-title">{t('order.sub.playerIn')}</div>
      <select value={letter} onChange={(e) => setLetter(e.target.value)}>
        <option value="">{t('score.selectLetter')}</option>
        {candidates.map((l) => (
          <option key={l} value={l}>
            {l}{game.oppRetiredLetters.includes(l) ? t('order.sub.usedMark') : ''}
          </option>
        ))}
      </select>

      {isRetired && (
        <div className="warn-box">
          {t('order.sub.retiredWarn', { name: letter })}
        </div>
      )}

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button
          className="primary"
          disabled={!letter}
          onClick={() => {
            dispatch({
              type: 'OPP_SUBSTITUTE',
              gameId: game.id,
              order: slot.order,
              letter,
              asRunner: kind === 'pr',
              label: t('score.oppSubLog', { kind: kindLabel, letter, order: slot.order, outLetter: slot.letter }),
            });
            onClose();
          }}
        >
          {t('order.sub.enter', { kind: kindLabel })}
        </button>
      </div>
    </Sheet>
  );
}

// ---- スコア手動修正シート(回を指定して±。事後編集で点差が狂ったときの帳尻合わせ用) ----
function ScoreAdjustSheet({ game, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [inning, setInning] = useState(game.inning);
  const myName = state.settings.teamName || t('restab.teamFallback');
  const oppName = game.opponent || t('restab.opponentFallback');
  const ls = game.linescore?.[String(inning)] || { my: 0, opp: 0 };

  const adjust = (team, delta) => dispatch({ type: 'ADJUST_SCORE', gameId: game.id, team, inning, delta });

  return (
    <Sheet title={t('score.adjustTitle')} onClose={onClose}>
      <p className="small dim">{t('score.adjustHint')}</p>
      <div className="section-title">{t('score.targetInning')}</div>
      <div className="grid3">
        {Array.from({ length: Math.max(9, game.inning) }, (_, i) => i + 1).map((i) => (
          <button key={i} className={`small ${inning === i ? 'primary' : ''}`} onClick={() => setInning(i)}>
            {t('score.inningN', { n: i })}
          </button>
        ))}
      </div>
      {[['my', myName, ls.my, game.myScore], ['opp', oppName, ls.opp, game.oppScore]].map(([team, name, innScore, total]) => (
        <div className="flex mt12" key={team}>
          <span className="grow">{name} <span className="dim small">{t('score.adjustDetail', { inning, runs: innScore, total })}</span></span>
          <div className="stepper">
            <button onClick={() => adjust(team, -1)}>−</button>
            <span className="val">{innScore}</span>
            <button onClick={() => adjust(team, +1)}>＋</button>
          </div>
        </div>
      ))}
      <div className="sheet-actions">
        <button className="primary" onClick={onClose} style={{ width: '100%' }}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

// ---- その他(記述式メモ)シート: 判断に迷うプレイを文章で残す / AIで正式記録へ変換 ----
// #5: Geminiがメモを解釈して CONFIRM_PLAY の候補(result/direction/outType/batterTo)を返し、
// onConvert経由でPlaySheetに下書きとして流し込む。最終確定は必ず人間が行う。
// APIキー未設定/オフライン時はキーワード規則(guessPlayFromMemo)でフォールバック。
function NoteSheet({ game, onClose, onConvert }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState(null);
  const [err, setErr] = useState('');
  const apiKey = state.settings.geminiApiKey;

  // 状況は塁の在/不在のみ(名前を送らない)。走者の動きは塁番号で返るため十分。
  const situation = () => {
    const r = (b) => (game.runners[b] ? 'あり' : 'なし');
    return `${game.inning}回${game.isTop ? '表' : '裏'} / アウト${game.outs} / 走者: 一塁=${r(1)}, 二塁=${r(2)}, 三塁=${r(3)}`;
  };

  const convert = async () => {
    setErr(''); setBusy(true);
    try {
      // プライバシー: 送信前にメモ内の選手名を伏せる(設定でON/OFF、既定ON)
      const memoToSend = state.settings.maskAiNames
        ? maskNames(text.trim(), state.players.map((p) => p.name))
        : text.trim();
      if (apiKey && navigator.onLine) {
        const res = await convertMemoToPlay({ apiKey, memo: memoToSend, situation: situation() });
        if (res?.error) { setErr(res.error + t('score.noteErrFallback')); const g = guessPlayFromMemo(text); setCands(g ? [g] : []); }
        else setCands(res?.candidates || []);
      } else {
        const g = guessPlayFromMemo(text);
        setCands(g ? [g] : []);
        if (!g) setErr(t('score.noteErrNoGuess'));
      }
    } catch (e) {
      setErr(t('score.noteErrFail') + (e?.message || ''));
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={t('score.noteTitle')} onClose={onClose}>
      <p className="small dim">
        {t('score.noteDesc')}
      </p>
      <textarea
        className="note-input" rows={3} value={text}
        onChange={(e) => { setText(e.target.value); setCands(null); }}
        placeholder={t('score.notePlaceholder')} autoFocus
      />
      {err && <div className="warn-box mt8">{err}</div>}
      {cands && cands.length > 0 && (
        <div className="mt8">
          <div className="section-title">{t('score.noteCandidates')}</div>
          {cands.map((c, i) => (
            <button key={i} className="cand-row" onClick={() => onConvert(c)}>
              <b>{playLabel(c.result, c.direction, c.outType, c.soType, state.settings.edition, state.settings.lang || 'ja')}</b>
              {typeof c.confidence === 'number' && <span className="pill small">{Math.round(c.confidence * 100)}%</span>}
              {c.why && <span className="small dim">{c.why}</span>}
            </button>
          ))}
        </div>
      )}
      {cands && cands.length === 0 && !err && <div className="small dim mt8">{t('score.noteNoCandidates')}</div>}
      <div className="sheet-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="ghost" onClick={onClose}>{t('action.close')}</button>
        <button disabled={!text.trim()} onClick={() => { dispatch({ type: 'ADD_NOTE', gameId: game.id, text: text.trim() }); onClose(); }}>
          {t('score.noteSaveOnly')}
        </button>
        <button className="primary" disabled={!text.trim() || busy} onClick={convert}>
          {busy ? t('score.noteConverting') : t('score.noteConvert', { simple: apiKey ? '' : t('score.noteSimpleSuffix') })}
        </button>
      </div>
    </Sheet>
  );
}

// ---- 三振確認カード(2ストライク後のストライクで自動表示) ----
function StrikeoutSheet({ game, batterName, initialSoType, onClose, onFurinige }) {
  const { dispatch } = useStore();
  const t = useT();
  const [soType, setSoType] = useState(initialSoType || 'swinging');

  const confirmOut = () => {
    dispatch({
      type: 'CONFIRM_PLAY',
      gameId: game.id,
      batterName: batterName || '',
      payload: { result: 'so', soType, moves: [], batterTo: 'out' },
    });
    onClose();
  };

  const undoPitch = () => {
    dispatch({ type: 'REMOVE_LAST_PITCH', gameId: game.id });
    onClose();
  };

  return (
    <Sheet title={t('score.soTitle')} onClose={onClose}>
      <div className="confirm-card" style={{ marginBottom: 0, border: 'none', padding: 6 }}>
        <div className="q">{batterName ? t('score.soConfirmYou', { name: batterName }) : t('score.soConfirmOpp')}</div>
        <div className="grid2">
          <button className={soType === 'swinging' ? 'primary' : ''} onClick={() => setSoType('swinging')}>
            {t('soType.swinging')}
          </button>
          <button className={soType === 'looking' ? 'primary' : ''} onClick={() => setSoType('looking')}>
            {t('soType.looking')}
          </button>
        </div>
        <button className="mt12" style={{ width: '100%' }} onClick={() => onFurinige(soType)}>
          {t('score.dropThirdBtn')}
        </button>
      </div>
      <div className="sheet-actions">
        <button className="ghost" onClick={undoPitch}>{t('score.undoMistap')}</button>
        <button className="primary" onClick={confirmOut}>{t('score.soConfirmBtn')}</button>
      </div>
    </Sheet>
  );
}

// ---- Undo(履歴スタック方式: 直前のプレイ入力を1タップ取り消し) ----
// 旧・左下フローティングバーは廃止し、「試合操作」カード内のボタンへ集約(投球カードの
// 「1球取り消し」との二重表示・パッドとの重なりを解消)。ラベルは score.undo.<action> で翻訳。
const UNDO_ACTIONS = new Set([
  'CONFIRM_PLAY', 'ADD_PITCH', 'RUNNER_EVENT', 'SUBSTITUTE', 'SET_PITCHER',
  'FORCE_CHANGE_HALF', 'SET_RUNNER', 'OPP_SUBSTITUTE', 'OPP_SET_PITCHER',
]);

// ---- ルールエンジンの提案バナー(試合終了条件・時間制限・球数警告) ----
// 判定はlib/rules.jsの純関数。成立しても強制終了はせず、提案として表示するだけ。
function RuleBanners({ game, onFinish }) {
  const { state } = useStore();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const t = useT();
  const [dismissed, setDismissed] = useState(''); // 「続行」を押した提案文(同じ状況の再表示を防ぐ)
  const [timeDismissed, setTimeDismissed] = useState(false);
  const [, setTick] = useState(0); // 時間制限は操作がなくても表示されるよう1分ごとに再描画
  useEffect(() => {
    if (!game.rules?.timeLimitMin) return;
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, [game.rules?.timeLimitMin]);

  const end = gameEndCheck(game, lang);
  const time = timeLimitCheck(game);
  // 球数警告は自チーム守備時(=自チーム投手が投げている間)のみ
  const pitch = !isMyTeamBatting(game) ? pitchLimitCheck(game) : null;

  return (
    <>
      {end && dismissed !== end.text && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>🏁 {end.text}</p>
          <div className="grid2">
            <button className="ghost" onClick={() => setDismissed(end.text)}>{t('score.continue')}</button>
            <button className="primary" onClick={onFinish}>{t('score.finishGame')}</button>
          </div>
        </div>
      )}
      {!end && time && !timeDismissed && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>
            {t('score.timeUp', { min: time.elapsedMin, limit: time.limit })}
          </p>
          <div className="grid2">
            <button className="ghost" onClick={() => setTimeDismissed(true)}>{t('score.continue')}</button>
            <button className="primary" onClick={onFinish}>{t('score.finishGame')}</button>
          </div>
        </div>
      )}
      {pitch && (
        <div className="warn-box" style={pitch.level === 'over' ? { borderColor: 'var(--red)', color: 'var(--red)' } : {}}>
          {pitch.level === 'over'
            ? t('score.pitchOver', { name: nameOf(game.currentPitcherId), n: pitch.pitches, limit: pitch.limit })
            : t('score.pitchWarn', { name: nameOf(game.currentPitcherId), n: pitch.pitches, limit: pitch.limit })}
        </div>
      )}
    </>
  );
}

// ---- メイン ----
export default function ScoreTab() {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const game = useCurrentGame();
  const nameOf = usePlayerName();
  const [sheet, setSheet] = useState(null); // {kind:'play',result} | {kind:'runner',base} | {kind:'batter'}
  const [showProgress, setShowProgress] = useState(false);
  const logInning = (l) => t('score.logInning', { inning: l.inning, half: t(l.isTop ? 'half.top' : 'half.bottom') });

  // 公式クラウドの観戦(viewer)ロール: 入力UIを出さず閲覧専用にする(書き込みはRLSでも拒否される)
  if (state.settings.officialTeamId && state.settings.officialRole === 'viewer') {
    return (
      <div>
        {game && <Scoreboard game={game} />}
        <div className="big-note">
          {t('score.viewerNote')}
        </div>
        {game && (
          <div className="card">
            <h2>{t('restab.progress')}</h2>
            {[...game.playLogs].filter((l) => l.kind !== 'run').slice(-10).reverse().map((l) => (
              <div className="log-line" key={l.id}>
                <b>{logInning(l)}</b> {l.text}
              </div>
            ))}
            {game.playLogs.length === 0 && <div className="dim small">{t('score.noPlays')}</div>}
          </div>
        )}
      </div>
    );
  }

  // 試合終了直後もハイライト/試合経過だけは表示し続ける(閉じたらGameSetupに戻る)
  if (!game || (game.status === 'finished' && sheet?.kind !== 'highlight' && !showProgress)) return <GameSetup />;

  const myBatting = isMyTeamBatting(game);
  const batter = currentBatter(game);
  const oppBatter = currentOppBatter(game);
  const noLineup = game.lineup.length === 0;

  // 直前操作の取り消し(旧・左下フローティングバーは廃止し「試合操作」カードへ集約)
  const lastAction = state.history[state.history.length - 1];
  const canUndo = !!lastAction && lastAction.gameId === game.id;
  const undoLabel = canUndo ? (UNDO_ACTIONS.has(lastAction.label) ? t(`score.undo.${lastAction.label}`) : lastAction.label) : '';

  const quickLineup = () => {
    const nine = state.players.filter((p) => !p.id.startsWith('demo-')).slice(0, 9);
    const source = nine.length >= 1 ? nine : state.players.slice(0, 9);
    dispatch({
      type: 'SET_LINEUP',
      gameId: game.id,
      lineup: source.map((p, i) => ({ order: i + 1, playerId: p.id, position: POSITIONS[i] || '控' })),
    });
  };

  return (
    <div className="scoretab">
      <Scoreboard game={game} />
      <RuleBanners
        game={game}
        onFinish={() => {
          dispatch({ type: 'FINISH_GAME', id: game.id });
          setSheet({ kind: 'highlight' });
        }}
      />
      {/* 走者は小型3塁ダイヤを打者行に横並び(本塁は操作しないため省略・拡大表示は廃止)。 */}
      {myBatting ? (
        noLineup ? (
          <div className="card">
            <div className="warn-box">{t('score.noLineup')}</div>
            <button className="primary" style={{ width: '100%' }} onClick={quickLineup} disabled={state.players.length === 0}>
              {t('score.autoLineup')}
            </button>
            {state.players.length === 0 && <p className="small dim mt8">{t('score.registerFirst')}</p>}
          </div>
        ) : (
          <div className="card sit-card">
            <div className="sit-row">
              <Diamond game={game} mini onBaseTap={(b) => setSheet({ kind: 'runner', base: b })} />
              <span className="rank-badge">{batter.order}</span>
              <div className="sit-batter">
                <div className="sit-main">
                  <span className="nm">{nameOf(batter.playerId)}</span>
                  <span className="pos">{positionLabel(batter.position, lang)}</span>
                </div>
              </div>
              <button className="pill blue sit-changebtn" onClick={() => setSheet({ kind: 'batter' })}>{t('score.changeBatter')}</button>
            </div>
            <AtBatHistory items={game.atBats.filter((ab) => ab.playerId === batter.playerId)} edition={state.settings.edition} lang={lang} />
            <div className="sit-pitcher">
              <span className="small dim">{t('score.oppPitcher')}</span>
              <select
                className="grow"
                value={game.oppPitcherLetter || ''}
                onChange={(e) => e.target.value && dispatch({
                  type: 'OPP_SET_PITCHER', gameId: game.id, letter: e.target.value,
                  label: `相手投手交代: ${e.target.value}`,
                })}
              >
                <option value="">{t('score.selectPitcher')}</option>
                {OPP_LETTERS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              {game.oppPitcherLetter && <OppHandToggle game={game} which="pitcher" letter={game.oppPitcherLetter} />}
            </div>
          </div>
        )
      ) : (
        <div className="card sit-card">
          <div className="sit-row">
            <Diamond game={game} mini onBaseTap={(b) => setSheet({ kind: 'runner', base: b })} />
            {oppBatter ? <span className="rank-badge">{oppBatter.order}</span> : null}
            <div className="sit-batter">
              {oppBatter
                ? <div className="sit-main"><span className="nm">{oppBatter.letter}</span></div>
                : <div className="sit-eye">{t('score.oppBatterMeta', { order: '-' })}</div>}
            </div>
            {oppBatter && <button className="pill blue sit-changebtn" onClick={() => setSheet({ kind: 'oppBatter' })}>{t('score.oppChange')}</button>}
          </div>
          {oppBatter && (
            <>
              <div className="flex" style={{ justifyContent: 'flex-end' }}>
                <OppHandToggle game={game} which="batter" letter={oppBatter.letter} allowSwitch />
              </div>
              <AtBatHistory
                items={game.playLogs
                  .filter((l) => l.kind === 'defense' && l.payload.letter === oppBatter.letter)
                  .map((l) => ({ id: l.id, ...l.payload }))}
                edition={state.settings.edition}
                lang={lang}
              />
            </>
          )}
          <div className="sit-pitcher">
            <span className="small dim">{t('score.pitcher')}</span>
            <select
              className="grow"
              value={game.currentPitcherId || ''}
              onChange={(e) => e.target.value && dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: e.target.value })}
            >
              <option value="">{t('score.selectPitcher')}</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <PitchCounter
        game={game}
        onAutoEvent={(kind, soType) =>
          setSheet(kind === 'so' ? { kind: 'strikeout', soType } : { kind: 'play', result: 'bb' })
        }
      />

      {(!myBatting || !noLineup) && (
        <div className="card">
          <h2>{myBatting ? t('score.battingResult') : t('score.oppResult')}</h2>
          <ResultPad onSelect={(result) => setSheet({ kind: 'play', result })} />
        </div>
      )}

      <div className="card">
        <h2>{t('score.gameOps')}</h2>
        <div className="grid2">
          {/* 投球は投球カードの「1球取り消し」が担うため、ここでは投球以外(打撃結果・走者・交代等)のみ表示 */}
          {canUndo && lastAction.label !== 'ADD_PITCH' && (
            <button className="undo-op" style={{ gridColumn: '1 / -1' }} onClick={() => dispatch({ type: 'UNDO' })}>
              {t('score.undoPrefix', { label: undoLabel })}
            </button>
          )}
          <button onClick={() => window.confirm(t('score.changeConfirm')) && dispatch({ type: 'FORCE_CHANGE_HALF', gameId: game.id })}>
            {t('score.manualChange')}
          </button>
          <button onClick={() => setSheet({ kind: 'scoreAdjust' })}>{t('score.adjustScore')}</button>
          <button style={{ gridColumn: '1 / -1' }} onClick={() => setSheet({ kind: 'note' })}>
            {t('score.noteBtn')}
          </button>
          <button
            className="danger"
            style={{ gridColumn: '1 / -1' }}
            onClick={() => {
              if (!window.confirm(t('score.finishConfirm'))) return;
              dispatch({ type: 'FINISH_GAME', id: game.id });
              setSheet({ kind: 'highlight' });
            }}
          >
            {t('score.finish')}
          </button>
        </div>
      </div>

      <div className="card" onClick={() => setShowProgress(true)} role="button">
        <div className="flex">
          <h2 className="grow" style={{ marginBottom: 0 }}>{t('restab.progress')}</h2>
          <span className="pill blue">{t('score.seeAll')}</span>
        </div>
        {[...game.playLogs].filter((l) => l.kind !== 'run').slice(-3).reverse().map((l) => (
          <div className="log-line" key={l.id}>
            <b>{logInning(l)}</b> {l.text}
          </div>
        ))}
        {game.playLogs.length === 0 && <div className="dim small">{t('score.noPlays')}</div>}
      </div>

      <VoiceControl game={game} />
      {showProgress && <GameProgressView game={game} onClose={() => setShowProgress(false)} />}

      {sheet?.kind === 'play' && (
        <PlaySheet
          game={game}
          initial={{ result: sheet.result, soType: sheet.soType, batterTo: sheet.batterTo, direction: sheet.direction, outType: sheet.outType }}
          batterName={myBatting && batter ? nameOf(batter.playerId) : null}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'strikeout' && (
        <StrikeoutSheet
          game={game}
          batterName={myBatting && batter ? nameOf(batter.playerId) : null}
          initialSoType={sheet.soType}
          onClose={() => setSheet(null)}
          onFurinige={(soType) => setSheet({ kind: 'play', result: 'so', soType, batterTo: 1 })}
        />
      )}
      {sheet?.kind === 'runner' && (
        <RunnerEventSheet
          game={game}
          base={sheet.base}
          onClose={() => setSheet(null)}
          onPinchRunner={(slot) => setSheet({ kind: 'sub', slot, subKind: 'pr' })}
          onPinchRunnerOpp={(slot) => setSheet({ kind: 'oppSub', slot, subKind: 'pr' })}
        />
      )}
      {sheet?.kind === 'batter' && (
        <BatterSheet
          game={game}
          onClose={() => setSheet(null)}
          onPinchHitter={() => {
            const slot = currentBatter(game);
            if (slot) setSheet({ kind: 'sub', slot, subKind: 'ph' });
          }}
        />
      )}
      {sheet?.kind === 'sub' && (
        <SubstituteSheet game={game} slot={sheet.slot} initialKind={sheet.subKind} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'oppBatter' && (
        <OppBatterSheet
          game={game}
          onClose={() => setSheet(null)}
          onPinchHitter={() => {
            const slot = currentOppBatter(game);
            if (slot) setSheet({ kind: 'oppSub', slot, subKind: 'ph' });
          }}
        />
      )}
      {sheet?.kind === 'oppSub' && (
        <OppSubstituteSheet game={game} slot={sheet.slot} initialKind={sheet.subKind} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'highlight' && (
        <HighlightSheet game={game} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'scoreAdjust' && (
        <ScoreAdjustSheet game={game} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'note' && (
        <NoteSheet
          game={game}
          onClose={() => setSheet(null)}
          onConvert={(c) => setSheet({
            kind: 'play', result: c.result, direction: c.direction || undefined,
            outType: c.outType || undefined, soType: c.soType || undefined,
            batterTo: c.batterTo === 'out' ? 'out' : (c.batterTo != null ? Number(c.batterTo) : undefined),
          })}
        />
      )}
    </div>
  );
}

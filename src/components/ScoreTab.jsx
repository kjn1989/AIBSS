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
import { POSITIONS, OPP_LETTERS, resultCategory, multiOutLabel } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { convertMemoToPlay, guessPlayFromMemo, maskNames } from '../lib/gemini.js';
import { RULE_PRESETS, presetById, describeRules, initialPresetIdFor, gameEndCheck, pitchLimitCheck, timeLimitCheck } from '../lib/rules.js';

// ---- 直近の打席結果を「1. 左翼単打 2. 見逃し三振」のように並べる小さな履歴表示 ----
function AtBatHistory({ items, edition }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="atbat-history">
      {items.map((it, i) => (
        <span className={`hist-chip ${resultCategory(it.result)}`} key={it.id}>
          {i + 1}. {playLabel(it.result, it.direction, it.outType, it.soType, edition)}
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
  if (!letter) return null;
  const cur = (which === 'pitcher' ? game.oppPitcherHands : game.oppBatterHands)?.[letter] || '';
  const opts = allowSwitch ? [['R', '右'], ['L', '左'], ['S', '両']] : [['R', '右'], ['L', '左']];
  const set = (h) => dispatch({ type: 'SET_OPP_HAND', gameId: game.id, which, letter, hand: cur === h ? '' : h });
  return (
    <div className="hand-inline">
      <span className="small dim">{which === 'pitcher' ? '投' : '打'}</span>
      {opts.map(([h, lbl]) => (
        <button key={h} className={`hl-btn ${cur === h ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); set(h); }}>{lbl}</button>
      ))}
    </div>
  );
}

// ---- 投手の累積球数メーター(スコア入力中に常時表示) ----
// 打席ごとのB/Sカウンター(PitchCounter)とは別に、この試合の投手の総球数を大きく見せる。
// 球数制限がある場合は「XX / 上限」+バー+色(緑→琥珀→赤)で疲労・交代の目安を示す。
// 自軍投手・相手投手のどちらも同じ見た目で表示できるよう、データを受け取る純表示コンポーネント。
function PitchLoadMeter({ label, pitches, byInningMap, limit, warnAt, currentInning }) {
  const wa = limit ? (warnAt ?? Math.max(1, limit - 10)) : null;
  const level = !limit ? '' : pitches >= limit ? 'over' : pitches >= wa ? 'warn' : '';
  const pct = limit ? Math.min(100, Math.round((pitches / limit) * 100)) : 0;
  // イニング別投球数(ペース把握用)。回順にチップ表示、現在の回を強調。
  const byInning = Object.entries(byInningMap || {})
    .map(([inn, n]) => [Number(inn), n])
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0] - b[0]);

  return (
    <>
      <div className={`pitch-meter ${level}`}>
        <div className="pm-body">
          <div className="pm-label">{label}{limit ? `(上限${limit}球)` : ''}</div>
          {limit && (
            <div className="pm-bar"><div className="pm-fill" style={{ width: `${pct}%` }} /></div>
          )}
        </div>
        <div className="pm-count">
          <b>{pitches}</b>
          <span className="pm-unit">{limit ? `/ ${limit}球` : '球'}</span>
        </div>
      </div>
      {byInning.length > 0 && (
        <div className="pitch-innings">
          <span className="pi-title">回別</span>
          {byInning.map(([inn, n]) => (
            <span className={`pi-chip ${inn === currentInning ? 'now' : ''}`} key={inn}>
              {inn}回<b>{n}</b>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// 控え投手の1行サマリー(帯)。タップで大メーターに入れ替える。
function PitchMiniStrip({ data, limit, onClick }) {
  const inn = Object.entries(data.byInning || {})
    .map(([k, n]) => [Number(k), n]).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  return (
    <button className="pitch-mini" onClick={onClick}>
      <span className="pm-mini-name">{data.shortLabel}</span>
      <span className="pm-mini-count"><b>{data.pitches}</b>{limit ? `/${limit}` : ''}球</span>
      {inn.length > 0 && <span className="pm-mini-inn">回別 {inn.map(([, n]) => n).join('/')}</span>}
      <span className="pm-mini-swap">大きく ▸</span>
    </button>
  );
}

// 両投手の球数を表示する。アクティブ投手(守備=自軍/攻撃=相手)を大メーター、
// もう一方(控え)を下に1行の帯で常時表示。帯タップで主役を入れ替える。
// ハーフが変わると別カードとして再マウントされるため、入れ替え状態は自動リセットされる。
function PitchLoadPair({ game }) {
  const nameOf = usePlayerName();
  const [swapped, setSwapped] = useState(false);
  const limit = game.rules?.pitchLimit?.perGame || null;
  const warnAt = game.rules?.pitchLimit?.warnAt;

  const myPid = game.currentPitcherId;
  const myPr = myPid ? (game.pitchingRecords || []).find((r) => r.playerId === myPid) : null;
  const mine = myPid ? {
    key: 'mine',
    label: `⚾ ${nameOf(myPid)} のこの試合の球数`,
    shortLabel: `🧤 自軍 ${nameOf(myPid)}`,
    pitches: myPr?.pitches || 0,
    byInning: myPr?.pitchesByInning,
  } : null;

  const oppLetter = game.oppPitcherLetter;
  const oppRec = oppLetter ? game.oppPitchers?.[oppLetter] : null;
  const opp = oppLetter ? {
    key: 'opp',
    label: `⚾ 相手投手 ${oppLetter} のこの試合の球数`,
    shortLabel: `🧢 相手 ${oppLetter}`,
    pitches: oppRec?.pitches || 0,
    byInning: oppRec?.pitchesByInning,
  } : null;

  if (!mine && !opp) return null;

  // 既定の主役はアクティブ投手(守備=自軍, 攻撃=相手)。swappedで入れ替え。
  const activeIsMine = !isMyTeamBatting(game);
  let primary = activeIsMine ? mine : opp;
  let secondary = activeIsMine ? opp : mine;
  if (swapped) { const t = primary; primary = secondary; secondary = t; }
  if (!primary) { primary = secondary; secondary = null; } // 片方未設定なら在る方を主役に

  return (
    <>
      <PitchLoadMeter
        label={primary.label} pitches={primary.pitches} byInningMap={primary.byInning}
        limit={limit} warnAt={warnAt} currentInning={game.inning}
      />
      {secondary && <PitchMiniStrip data={secondary} limit={limit} onClick={() => setSwapped((s) => !s)} />}
    </>
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
  return (
    <>
      <label className="small dim" style={{ display: 'block' }}>試合ルール</label>
      <select value={presetId} onChange={(e) => onPresetChange(e.target.value)}>
        {RULE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}{p.edition === edition ? '' : ` (${p.edition})`}</option>
        ))}
        <option value="custom">カスタム(自分で設定)</option>
        <option value="none">ルール管理なし</option>
      </select>
      {presetId === 'custom' && (
        <div className="mt8">
          <div className="grid3">
            <div>
              <label className="small dim">回数</label>
              <input type="number" inputMode="numeric" value={custom.innings} onChange={(e) => setCustom({ ...custom, innings: e.target.value })} />
            </div>
            <div>
              <label className="small dim">コールド回</label>
              <input type="number" inputMode="numeric" placeholder="なし" value={custom.mercyAfter} onChange={(e) => setCustom({ ...custom, mercyAfter: e.target.value })} />
            </div>
            <div>
              <label className="small dim">点差</label>
              <input type="number" inputMode="numeric" placeholder="なし" value={custom.mercyDiff} onChange={(e) => setCustom({ ...custom, mercyDiff: e.target.value })} />
            </div>
          </div>
          <div className="grid2 mt8">
            <div>
              <label className="small dim">球数制限(空欄=なし)</label>
              <input type="number" inputMode="numeric" placeholder="例: 70" value={custom.pitchPerGame} onChange={(e) => setCustom({ ...custom, pitchPerGame: e.target.value })} />
            </div>
            <div>
              <label className="small dim">時間制限・分(空欄=なし)</label>
              <input type="number" inputMode="numeric" placeholder="例: 90" value={custom.timeLimitMin} onChange={(e) => setCustom({ ...custom, timeLimitMin: e.target.value })} />
            </div>
          </div>
        </div>
      )}
      <p className="small dim mt8">
        {describeRules(resolveRulesFrom(presetId, custom))}
        {presetId !== 'none' && <><br />※ プリセットは代表例です。連盟・大会の要項に合わせて調整してください。成立時も自動終了はせず、確認してから終了できます。</>}
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
  const { dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  return (
    <Sheet title={t('sheet.nextBatter')} onClose={onClose}>
      <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={onPinchHitter}>
        {t('sheet.pinchHitter', { name: nameOf(currentBatter(game)?.playerId) })}
      </button>
      {game.lineup.map((slot, i) => (
        <div className="row" key={slot.order}>
          <span className="rank-badge">{slot.order}</span>
          <span className="grow">{nameOf(slot.playerId)} <span className="dim small">{slot.position}</span></span>
          <button
            className={`small ${i === game.batterIndex ? 'primary' : ''}`}
            onClick={() => {
              dispatch({ type: 'SET_BATTER_INDEX', gameId: game.id, index: i });
              onClose();
            }}
          >
            {i === game.batterIndex ? '打席中' : 'この打者'}
          </button>
        </div>
      ))}
    </Sheet>
  );
}

// ---- 相手打者変更シート(記号A〜Tで管理) ----
function OppBatterSheet({ game, onClose, onPinchHitter }) {
  const { dispatch } = useStore();
  const current = currentOppBatter(game);
  return (
    <Sheet title="次の相手打者を選択" onClose={onClose}>
      <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={onPinchHitter}>
        🔄 相手に代打を送る({current?.letter}に代えて)
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
            {i === game.oppBatterIndex ? '打席中' : 'この打者'}
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
  const kindLabel = { ph: '代打', pr: '代走', def: '守備交代' }[kind];

  const runnerBase = [1, 2, 3].find((b) => game.runners[b]?.letter === slot.letter);

  return (
    <Sheet title={`${slot.order}番 ${slot.letter} の交代`} onClose={onClose}>
      <div className="grid3">
        {[['ph', '代打'], ['pr', '代走'], ['def', '守備交代']].map(([k, label]) => (
          <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>

      {kind === 'pr' && !runnerBase && (
        <div className="warn-box mt8">この選手は現在塁上にいません。代走は塁上の走者に対して行います。</div>
      )}

      <div className="section-title">出場する選手</div>
      <select value={letter} onChange={(e) => setLetter(e.target.value)}>
        <option value="">記号を選択...</option>
        {candidates.map((l) => (
          <option key={l} value={l}>
            {l}{game.oppRetiredLetters.includes(l) ? ' (⚠️出場済み)' : ''}
          </option>
        ))}
      </select>

      {isRetired && (
        <div className="warn-box">
          ⚠️ {letter} は一度退いた選手です。公式ルールでは再出場できません(記録は継続可能)。
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
              label: `相手${kindLabel}: ${letter} (${slot.order}番 ${slot.letter}に代わり)`,
            });
            onClose();
          }}
        >
          {kindLabel}で出場
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
  const myName = state.settings.teamName || 'マイチーム';
  const oppName = game.opponent || '対戦相手';
  const ls = game.linescore?.[String(inning)] || { my: 0, opp: 0 };

  const adjust = (team, delta) => dispatch({ type: 'ADJUST_SCORE', gameId: game.id, team, inning, delta });

  return (
    <Sheet title="スコア修正" onClose={onClose}>
      <p className="small dim">回を選んで得点を直接増減できます(合計スコアも連動)。</p>
      <div className="section-title">対象の回</div>
      <div className="grid3">
        {Array.from({ length: Math.max(9, game.inning) }, (_, i) => i + 1).map((i) => (
          <button key={i} className={`small ${inning === i ? 'primary' : ''}`} onClick={() => setInning(i)}>
            {i}回
          </button>
        ))}
      </div>
      {[['my', myName, ls.my, game.myScore], ['opp', oppName, ls.opp, game.oppScore]].map(([team, name, innScore, total]) => (
        <div className="flex mt12" key={team}>
          <span className="grow">{name} <span className="dim small">({inning}回: {innScore}点 / 計{total}点)</span></span>
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
        if (res?.error) { setErr(res.error + '(簡易推定に切替)'); const g = guessPlayFromMemo(text); setCands(g ? [g] : []); }
        else setCands(res?.candidates || []);
      } else {
        const g = guessPlayFromMemo(text);
        setCands(g ? [g] : []);
        if (!g) setErr('キーワードから推定できませんでした。手入力で結果を選んでください。');
      }
    } catch (e) {
      setErr('変換に失敗しました。' + (e?.message || ''));
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="その他 — 不明なプレイ" onClose={onClose}>
      <p className="small dim">
        判断に迷うプレイは、起きたことをそのまま書けます(例:「ピッチャーが弾いてショートが拾って一塁へ投げたがセーフ」)。
        AIが正式な記録の候補に変換します(最終確定は確認画面で行います)。
      </p>
      <textarea
        className="note-input" rows={3} value={text}
        onChange={(e) => { setText(e.target.value); setCands(null); }}
        placeholder="起きたことを自由に入力…" autoFocus
      />
      {err && <div className="warn-box mt8">{err}</div>}
      {cands && cands.length > 0 && (
        <div className="mt8">
          <div className="section-title">変換候補(タップで確認画面へ)</div>
          {cands.map((c, i) => (
            <button key={i} className="cand-row" onClick={() => onConvert(c)}>
              <b>{playLabel(c.result, c.direction, c.outType, c.soType, state.settings.edition)}</b>
              {typeof c.confidence === 'number' && <span className="pill small">{Math.round(c.confidence * 100)}%</span>}
              {c.why && <span className="small dim">{c.why}</span>}
            </button>
          ))}
        </div>
      )}
      {cands && cands.length === 0 && !err && <div className="small dim mt8">変換候補がありませんでした。</div>}
      <div className="sheet-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="ghost" onClick={onClose}>{t('action.close')}</button>
        <button disabled={!text.trim()} onClick={() => { dispatch({ type: 'ADD_NOTE', gameId: game.id, text: text.trim() }); onClose(); }}>
          メモだけ記録
        </button>
        <button className="primary" disabled={!text.trim() || busy} onClick={convert}>
          {busy ? '変換中…' : `🤖 AIで変換${apiKey ? '' : '(簡易)'}`}
        </button>
      </div>
    </Sheet>
  );
}

// ---- 三振確認カード(2ストライク後のストライクで自動表示) ----
function StrikeoutSheet({ game, batterName, initialSoType, onClose, onFurinige }) {
  const { dispatch } = useStore();
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
    <Sheet title="⚡ 三振！" onClose={onClose}>
      <div className="confirm-card" style={{ marginBottom: 0, border: 'none', padding: 6 }}>
        <div className="q">{batterName ? `${batterName}、` : '相手打者、'}三振でよろしいですか？</div>
        <div className="grid2">
          <button className={soType === 'swinging' ? 'primary' : ''} onClick={() => setSoType('swinging')}>
            空振り三振
          </button>
          <button className={soType === 'looking' ? 'primary' : ''} onClick={() => setSoType('looking')}>
            見逃し三振
          </button>
        </div>
        <button className="mt12" style={{ width: '100%' }} onClick={() => onFurinige(soType)}>
          振り逃げ(出塁・走者の動きを入力)
        </button>
      </div>
      <div className="sheet-actions">
        <button className="ghost" onClick={undoPitch}>↩ 誤タップ(1球取消)</button>
        <button className="primary" onClick={confirmOut}>三振アウトで確定</button>
      </div>
    </Sheet>
  );
}

// ---- Undoバー(履歴スタック方式: 直前のプレイ入力を1タップ取り消し) ----
const UNDO_LABELS = {
  CONFIRM_PLAY: '打席確定',
  ADD_PITCH: '投球',
  RUNNER_EVENT: '走者イベント',
  SUBSTITUTE: '選手交代',
  SET_PITCHER: '投手交代',
  FORCE_CHANGE_HALF: 'チェンジ',
  SET_RUNNER: '走者修正',
  OPP_SUBSTITUTE: '相手選手交代',
  OPP_SET_PITCHER: '相手投手交代',
};

function UndoBar({ game }) {
  const { state, dispatch } = useStore();
  const last = state.history[state.history.length - 1];
  if (!last || last.gameId !== game.id) return null;
  return (
    <div className="undo-bar">
      <button onClick={() => dispatch({ type: 'UNDO' })} style={{ flex: 1 }}>
        ↩ 取り消し: {UNDO_LABELS[last.label] || last.label}
      </button>
    </div>
  );
}

// ---- ルールエンジンの提案バナー(試合終了条件・時間制限・球数警告) ----
// 判定はlib/rules.jsの純関数。成立しても強制終了はせず、提案として表示するだけ。
function RuleBanners({ game, onFinish }) {
  const nameOf = usePlayerName();
  const [dismissed, setDismissed] = useState(''); // 「続行」を押した提案文(同じ状況の再表示を防ぐ)
  const [timeDismissed, setTimeDismissed] = useState(false);
  const [, setTick] = useState(0); // 時間制限は操作がなくても表示されるよう1分ごとに再描画
  useEffect(() => {
    if (!game.rules?.timeLimitMin) return;
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, [game.rules?.timeLimitMin]);

  const end = gameEndCheck(game);
  const time = timeLimitCheck(game);
  // 球数警告は自チーム守備時(=自チーム投手が投げている間)のみ
  const pitch = !isMyTeamBatting(game) ? pitchLimitCheck(game) : null;

  return (
    <>
      {end && dismissed !== end.text && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>🏁 {end.text}</p>
          <div className="grid2">
            <button className="ghost" onClick={() => setDismissed(end.text)}>このまま続行</button>
            <button className="primary" onClick={onFinish}>試合を終了する</button>
          </div>
        </div>
      )}
      {!end && time && !timeDismissed && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>
            ⏱ 開始から{time.elapsedMin}分が経過し、時間制限({time.limit}分)に達しました。慣例では新しい回には入らず、この回までで終了します。
          </p>
          <div className="grid2">
            <button className="ghost" onClick={() => setTimeDismissed(true)}>このまま続行</button>
            <button className="primary" onClick={onFinish}>試合を終了する</button>
          </div>
        </div>
      )}
      {pitch && (
        <div className="warn-box" style={pitch.level === 'over' ? { borderColor: 'var(--red)', color: 'var(--red)' } : {}}>
          {pitch.level === 'over'
            ? `🚨 投手 ${nameOf(game.currentPitcherId)}: ${pitch.pitches}球 — 球数制限(${pitch.limit}球)に到達しています。交代を検討してください。`
            : `⚠️ 投手 ${nameOf(game.currentPitcherId)}: ${pitch.pitches}球 — 球数制限(${pitch.limit}球)が近づいています。`}
        </div>
      )}
    </>
  );
}

// ---- メイン ----
export default function ScoreTab() {
  const { state, dispatch } = useStore();
  const game = useCurrentGame();
  const nameOf = usePlayerName();
  const [sheet, setSheet] = useState(null); // {kind:'play',result} | {kind:'runner',base} | {kind:'batter'}
  const [showProgress, setShowProgress] = useState(false);

  // 公式クラウドの観戦(viewer)ロール: 入力UIを出さず閲覧専用にする(書き込みはRLSでも拒否される)
  if (state.settings.officialTeamId && state.settings.officialRole === 'viewer') {
    return (
      <div>
        {game && <Scoreboard game={game} />}
        <div className="big-note">
          👀 観戦モード(閲覧専用)です。チームの記録係が入力したスコアが自動で反映されます。
          成績・試合結果タブから記録を閲覧できます。
        </div>
        {game && (
          <div className="card">
            <h2>試合経過</h2>
            {[...game.playLogs].filter((l) => l.kind !== 'run').slice(-10).reverse().map((l) => (
              <div className="log-line" key={l.id}>
                <b>{l.inning}回{l.isTop ? '表' : '裏'}</b> {l.text}
              </div>
            ))}
            {game.playLogs.length === 0 && <div className="dim small">まだプレイがありません。</div>}
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
    <div>
      <Scoreboard game={game} />
      <RuleBanners
        game={game}
        onFinish={() => {
          dispatch({ type: 'FINISH_GAME', id: game.id });
          setSheet({ kind: 'highlight' });
        }}
      />
      <Diamond game={game} onBaseTap={(b) => setSheet({ kind: 'runner', base: b })} />

      {myBatting ? (
        noLineup ? (
          <div className="card">
            <div className="warn-box">オーダーが未設定です。オーダータブで設定するか、登録選手から自動セットできます。</div>
            <button className="primary" style={{ width: '100%' }} onClick={quickLineup} disabled={state.players.length === 0}>
              登録選手から打順を自動セット
            </button>
            {state.players.length === 0 && <p className="small dim mt8">⚙️ 設定タブで選手を登録してください。</p>}
          </div>
        ) : (
          <>
            <div className="card" onClick={() => setSheet({ kind: 'batter' })} role="button">
              <div className="flex">
                <span className="rank-badge">{batter.order}</span>
                <div className="grow">
                  <b style={{ fontSize: 18 }}>{nameOf(batter.playerId)}</b>
                  <span className="dim small"> 打順{batter.order}番 {batter.position}</span>
                </div>
                <span className="pill blue">打者変更 ▾</span>
              </div>
              <AtBatHistory items={game.atBats.filter((ab) => ab.playerId === batter.playerId)} edition={state.settings.edition} />
            </div>
            <div className="card">
              <div className="flex">
                <span className="small dim">相手投手</span>
                <select
                  className="grow"
                  value={game.oppPitcherLetter || ''}
                  onChange={(e) => e.target.value && dispatch({
                    type: 'OPP_SET_PITCHER', gameId: game.id, letter: e.target.value,
                    label: `相手投手交代: ${e.target.value}`,
                  })}
                >
                  <option value="">投手を選択...</option>
                  {OPP_LETTERS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                {game.oppPitcherLetter && <OppHandToggle game={game} which="pitcher" letter={game.oppPitcherLetter} />}
              </div>
              <PitchLoadPair game={game} />
            </div>
          </>
        )
      ) : (
        <div className="card" onClick={() => setSheet({ kind: 'oppBatter' })} role="button">
          <div className="flex">
            <span className="small dim">投手</span>
            <select
              className="grow"
              value={game.currentPitcherId || ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => e.target.value && dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: e.target.value })}
            >
              <option value="">投手を選択...</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <PitchLoadPair game={game} />
          {oppBatter && (
            <>
              <div className="flex mt12">
                <span className="rank-badge">{oppBatter.order}</span>
                <div className="grow">
                  <b style={{ fontSize: 18 }}>{oppBatter.letter}</b>
                  <span className="dim small"> 打順{oppBatter.order}番</span>
                </div>
                <span className="pill blue">相手 交代 ▾</span>
              </div>
              <div className="flex" onClick={(e) => e.stopPropagation()} style={{ justifyContent: 'flex-end' }}>
                <OppHandToggle game={game} which="batter" letter={oppBatter.letter} allowSwitch />
              </div>
              <AtBatHistory
                items={game.playLogs
                  .filter((l) => l.kind === 'defense' && l.payload.letter === oppBatter.letter)
                  .map((l) => ({ id: l.id, ...l.payload }))}
                edition={state.settings.edition}
              />
            </>
          )}
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
          <h2>{myBatting ? '打撃結果' : '相手打者の結果'}</h2>
          <ResultPad onSelect={(result) => setSheet({ kind: 'play', result })} />
        </div>
      )}

      <div className="card">
        <h2>試合操作</h2>
        <div className="grid2">
          <button onClick={() => window.confirm('攻守交代(チェンジ)しますか？') && dispatch({ type: 'FORCE_CHANGE_HALF', gameId: game.id })}>
            手動チェンジ
          </button>
          <button onClick={() => setSheet({ kind: 'scoreAdjust' })}>スコア修正</button>
          <button style={{ gridColumn: '1 / -1' }} onClick={() => setSheet({ kind: 'note' })}>
            📝 その他(不明なプレイをメモ)
          </button>
          <button
            className="danger"
            style={{ gridColumn: '1 / -1' }}
            onClick={() => {
              if (!window.confirm('試合を終了しますか？')) return;
              dispatch({ type: 'FINISH_GAME', id: game.id });
              setSheet({ kind: 'highlight' });
            }}
          >
            試合終了
          </button>
        </div>
      </div>

      <div className="card" onClick={() => setShowProgress(true)} role="button">
        <div className="flex">
          <h2 className="grow" style={{ marginBottom: 0 }}>試合経過</h2>
          <span className="pill blue">すべて見る ▾</span>
        </div>
        {[...game.playLogs].filter((l) => l.kind !== 'run').slice(-3).reverse().map((l) => (
          <div className="log-line" key={l.id}>
            <b>{l.inning}回{l.isTop ? '表' : '裏'}</b> {l.text}
          </div>
        ))}
        {game.playLogs.length === 0 && <div className="dim small">まだプレイがありません。</div>}
      </div>

      <UndoBar game={game} />
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

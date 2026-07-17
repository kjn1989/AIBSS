import React, { useState, useMemo } from 'react';
import Sheet from './Sheet.jsx';
import { useStore, useT, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES, outTypeLabel } from '../lib/model.js';
import { proposeMoves, batterDestOptions, runnerDestOptions, DEST_LABEL, judgeAdvance } from '../lib/plays.js';
import FieldPad from './FieldPad.jsx';

const NEEDS_DIRECTION = ['single', 'double', 'triple', 'hr', 'out', 'error', 'sacBunt', 'sacFly'];

// プレイ確定シート: 方向・走者進塁・打点をまとめて確認して1タップ確定
export default function PlaySheet({ game, initial, batterName, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const edition = state.settings.edition;
  // 凡打の種類ボタンの表示: 日本語モードはエディション別呼称(少年野球のゲッツー等)を維持し、
  // 英語モードは辞書(outType.*)を使う。※確認文(summary)は打球方向(DIRECTIONS)が未翻訳のため
  // 現時点では日本語のまま(方向・妨害系の英語化は次フェーズで対応)。
  const outLabel = (k) => (lang === 'ja' ? outTypeLabel(k, edition) : t(`outType.${k}`));
  const result = initial.result;
  const def = RESULTS[result];
  const resultLabel = lang === 'ja' ? def.label : t(`result.${result}`);
  const myBatting = isMyTeamBatting(game);

  const runnersOn = { 1: !!game.runners[1], 2: !!game.runners[2], 3: !!game.runners[3] };
  const proposal = useMemo(() => proposeMoves(result, runnersOn), [result]);

  const [direction, setDirection] = useState(initial.direction || null);
  // 方向未選択時のみ広いフィールド図を開いておく。選択後は折りたたんでスクロールを減らす
  const [dirOpen, setDirOpen] = useState(!initial.direction);
  const [outType, setOutType] = useState(initial.outType || (result === 'out' ? 'ground' : null));
  const [soType, setSoType] = useState(initial.soType || 'swinging');
  const [dests, setDests] = useState(() => {
    const d = {};
    for (const b of [1, 2, 3]) {
      if (runnersOn[b]) {
        const mv = proposal.moves.find((m) => m.from === b);
        d[b] = mv ? mv.to : b; // 提案がなければ「そのまま」
      }
    }
    // 併殺打が最初から選ばれている場合(音声認識等)も、フォース走者を既定でアウトにする
    if (initial.outType === 'dp') {
      const forced = [1, 2, 3].find((b) => runnersOn[b]);
      if (forced) d[forced] = 'out';
    }
    return d;
  });
  const [batterTo, setBatterTo] = useState(initial.batterTo ?? proposal.batterTo);
  const [rbiOverride, setRbiOverride] = useState(null);
  const [advOverride, setAdvOverride] = useState(null);
  // 守備時: 自責点の帰属(継投跨ぎ走者) と 非自責フラグ
  const [erChoices, setErChoices] = useState({}); // { base: pitcherId }
  const [unearned, setUnearned] = useState(() => {
    const u = {};
    for (const b of [1, 2, 3]) if (game.runners[b]?.viaError) u[b] = true;
    return u;
  });

  const needsDir = NEEDS_DIRECTION.includes(result);

  // 移動配列(store形式)
  const moves = useMemo(
    () => [1, 2, 3].filter((b) => runnersOn[b] && dests[b] !== b).map((b) => ({ from: b, to: dests[b] })),
    [dests]
  );

  const runs = moves.filter((m) => m.to === 4).length + (batterTo === 4 ? 1 : 0);
  const autoRbi = result === 'error' || outType === 'dp' ? 0 : runs;
  const rbi = rbiOverride ?? autoRbi;

  const hadRunners = runnersOn[1] || runnersOn[2] || runnersOn[3];
  const isAdvTarget = result === 'out' && hadRunners;
  const autoAdv = judgeAdvance(moves);
  const advSuccess = advOverride ?? autoAdv;

  // 併殺打: 打者アウトに加え走者も1人以上アウトが成立条件。走者が誰もアウトになっていなければ確定不可
  const dpNoRunnerOut = outType === 'dp' && ![1, 2, 3].some((b) => runnersOn[b] && dests[b] === 'out');

  // 凡打の種類を選ぶ(併殺打選択時は、強制されるフォース走者(一塁→二塁→三塁の順で先頭)を
  // 自動でアウトに。既に誰かアウトになっていれば上書きしない)
  const selectOutType = (k) => {
    setOutType(k);
    if (k === 'dp') {
      const alreadyOut = [1, 2, 3].some((b) => runnersOn[b] && dests[b] === 'out');
      if (!alreadyOut) {
        const forced = [1, 2, 3].find((b) => runnersOn[b]);
        if (forced) setDests((d) => ({ ...d, [forced]: 'out' }));
      }
    }
  };

  // 衝突チェック: 複数の走者(+打者)が同じ塁に到達していないか
  const collision = useMemo(() => {
    const occupied = [];
    for (const b of [1, 2, 3]) {
      if (runnersOn[b]) {
        const to = dests[b];
        if (to !== 'out' && to !== 4) occupied.push(to);
      }
    }
    if (typeof batterTo === 'number' && batterTo >= 1 && batterTo <= 3) occupied.push(batterTo);
    return new Set(occupied).size !== occupied.length;
  }, [dests, batterTo]);

  const summary = () => {
    const dir = direction ? DIRECTIONS[direction] : '';
    const ot = result === 'out' && outType ? outTypeLabel(outType, edition) : '';
    const label = result === 'so' ? SO_TYPES[soType] + (batterTo === 1 ? '(振り逃げ)' : '') : result === 'out' ? '' : def.label;
    return `${dir}${ot}${label}${runs ? `・${runs}点` : ''}`;
  };

  // 守備時: 生還する走者のうち継投を跨いだ走者(前投手の責任走者)
  const scoringBases = moves.filter((m) => m.to === 4).map((m) => m.from);
  const inheritedScoring = !myBatting
    ? scoringBases.filter((b) => {
        const r = game.runners[b];
        return r?.pitcherId && r.pitcherId !== game.currentPitcherId;
      })
    : [];

  const confirm = () => {
    dispatch({
      type: 'CONFIRM_PLAY',
      gameId: game.id,
      batterName: batterName || '',
      payload: {
        result,
        outType: result === 'out' ? outType : null,
        soType: result === 'so' ? soType : undefined,
        direction: needsDir ? direction : null,
        moves,
        batterTo,
        rbi: rbiOverride !== null ? rbiOverride : undefined,
        advSuccess: isAdvTarget ? advSuccess : undefined,
        erChoices,
        unearnedRuns: unearned,
      },
    });
    onClose();
  };

  const runnerName = (b) => {
    const r = game.runners[b];
    return r?.playerId ? nameOf(r.playerId) : `${['', '一', '二', '三'][b]}塁走者`;
  };

  return (
    <Sheet title={`${batterName ? batterName + ': ' : t('playsheet.oppBatter')}${resultLabel}`} onClose={onClose}>
      {needsDir && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>{t('playsheet.direction')}</div>
          {dirOpen ? (
            <FieldPad
              value={direction}
              onChange={(key) => { setDirection(key); setDirOpen(false); }}
            />
          ) : (
            <button type="button" className="dir-summary" onClick={() => setDirOpen(true)}>
              <span className="dir-label">{DIRECTIONS[direction]}</span>
              <span className="change">{t('playsheet.change')}</span>
            </button>
          )}
        </>
      )}

      {result === 'so' && (
        <>
          <div className="section-title">{t('playsheet.soType')}</div>
          <div className="grid2">
            {Object.keys(SO_TYPES).map((k) => (
              <button key={k} className={soType === k ? 'primary' : ''} onClick={() => setSoType(k)}>
                {lang === 'ja' ? SO_TYPES[k] : t(`soType.${k}`)}
              </button>
            ))}
          </div>
        </>
      )}

      {result === 'out' && (
        <>
          <div className="section-title">{t('playsheet.outType')}</div>
          <div className="grid2">
            {Object.keys(OUT_TYPES).map((k) => (
              <button
                key={k}
                className={outType === k ? 'primary' : ''}
                onClick={() => selectOutType(k)}
                disabled={k === 'dp' && !hadRunners}
              >
                {outLabel(k)}
              </button>
            ))}
          </div>
        </>
      )}

      {(hadRunners || def.onBase || batterDestOptions(result).length > 1) && (
        <div className="section-title">走者の動き</div>
      )}

      {[3, 2, 1].map(
        (b) =>
          runnersOn[b] && (
            <div className="runner-move" key={b}>
              <span className="who">{['', '一', '二', '三'][b]}塁: {runnerName(b)}</span>
              <div className="dests">
                {runnerDestOptions(b).map((to) => (
                  <button
                    key={String(to)}
                    className={dests[b] === to ? `sel${to === 'out' ? ' out' : ''}` : ''}
                    onClick={() => setDests({ ...dests, [b]: to })}
                  >
                    {DEST_LABEL(b)(to)}
                  </button>
                ))}
              </div>
            </div>
          )
      )}

      {batterDestOptions(result).length > 0 && (
        <div className="runner-move">
          <span className="who">打者{batterName ? `: ${batterName}` : ''}</span>
          <div className="dests">
            {batterDestOptions(result).map((to) => (
              <button
                key={String(to)}
                className={batterTo === to ? `sel${to === 'out' ? ' out' : ''}` : ''}
                onClick={() => setBatterTo(to)}
              >
                {to === 'out' ? 'アウト' : to === 4 ? '生還'
                  : result === 'so' && to === 1 ? '振り逃げで一塁'
                    : `${['', '一', '二', '三'][to]}塁へ`}
              </button>
            ))}
          </div>
        </div>
      )}

      {myBatting && (
        <div className="flex mt12">
          <span className="small dim">打点</span>
          <div className="stepper">
            <button onClick={() => setRbiOverride(Math.max(0, rbi - 1))}>−</button>
            <span className="val">{rbi}</span>
            <button onClick={() => setRbiOverride(Math.min(4, rbi + 1))}>＋</button>
          </div>
          {rbiOverride !== null && rbiOverride !== autoRbi && <span className="pill amber">手動</span>}
        </div>
      )}

      {isAdvTarget && myBatting && (
        <div className="flex mt12">
          <span className="small dim">進塁打</span>
          <button className={`small ${advSuccess ? 'primary' : ''}`} onClick={() => setAdvOverride(!advSuccess)}>
            {advSuccess ? '✓ 進塁打成功' : '進塁打ではない'}
          </button>
          {advOverride === null && <span className="pill">自動判定</span>}
        </div>
      )}

      {!myBatting && scoringBases.length > 0 && (
        <>
          <div className="section-title">失点の記録 (自責点の帰属)</div>
          {scoringBases.map((b) => {
            const r = game.runners[b];
            const prevPid = r?.pitcherId;
            const isInherited = inheritedScoring.includes(b);
            const chosen = erChoices[b] || prevPid || game.currentPitcherId;
            return (
              <div key={b} className="card" style={{ padding: 10, marginBottom: 8 }}>
                <div className="small" style={{ marginBottom: 6 }}>
                  {['', '一', '二', '三'][b]}塁走者の生還
                  {isInherited && <span className="pill amber" style={{ marginLeft: 6 }}>継投跨ぎ</span>}
                </div>
                {isInherited && (
                  <div className="grid2" style={{ marginBottom: 6 }}>
                    <button
                      className={`small ${chosen === prevPid ? 'primary' : ''}`}
                      onClick={() => setErChoices({ ...erChoices, [b]: prevPid })}
                    >
                      前投手: {nameOf(prevPid)}
                    </button>
                    <button
                      className={`small ${chosen === game.currentPitcherId ? 'primary' : ''}`}
                      onClick={() => setErChoices({ ...erChoices, [b]: game.currentPitcherId })}
                    >
                      現投手: {nameOf(game.currentPitcherId)}
                    </button>
                  </div>
                )}
                <button
                  className={`small ${unearned[b] ? 'danger' : 'ghost'}`}
                  onClick={() => setUnearned({ ...unearned, [b]: !unearned[b] })}
                >
                  {unearned[b] ? '✓ 非自責(失策絡み)' : '自責点として記録'}
                </button>
              </div>
            );
          })}
        </>
      )}

      {collision && <div className="warn-box mt12">⚠️ 複数の走者が同じ塁に到達しています。行き先を修正してください。</div>}
      {dpNoRunnerOut && <div className="warn-box mt12">⚠️ ダブルプレーには走者のアウトが必要です。走者の行き先を「アウト」にしてください。</div>}

      <div className="confirm-card mt16" style={{ marginBottom: 0, padding: 12 }}>
        <div className="q" style={{ fontSize: 16, marginBottom: 0 }}>
          {summary()} でよろしいですか？
        </div>
      </div>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={confirm} disabled={(needsDir && !direction) || collision || dpNoRunnerOut}>
          {t('action.confirm')}
        </button>
      </div>
    </Sheet>
  );
}

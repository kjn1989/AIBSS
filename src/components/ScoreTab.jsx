import React, { useState } from 'react';
import { useStore, useCurrentGame, usePlayerName, isMyTeamBatting, currentBatter, currentOppBatter } from '../state/store.jsx';
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
import { POSITIONS, OPP_LETTERS } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';

// ---- 直近の打席結果を「1. 左翼単打 2. 見逃し三振」のように並べる小さな履歴表示 ----
function AtBatHistory({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="atbat-history">
      {items.map((it, i) => (
        <span className="hist-chip" key={it.id}>
          {i + 1}. {playLabel(it.result, it.direction, it.outType, it.soType)}
        </span>
      ))}
    </div>
  );
}

// ---- 試合セットアップ(試合がない/選択されていないとき) ----
function GameSetup() {
  const { state, dispatch } = useStore();
  const [opponent, setOpponent] = useState('');
  const [isHome, setIsHome] = useState(false);
  const ongoing = Object.values(state.games).filter((g) => g.status === 'ongoing' && !g.id.startsWith('demo-'));

  return (
    <div>
      <div className="card">
        <h2>新しい試合を開始</h2>
        <label className="small dim">対戦相手</label>
        <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="対戦相手名" />
        <div className="toggle-row mt12">
          <button className={!isHome ? 'active' : ''} onClick={() => setIsHome(false)}>先攻</button>
          <button className={isHome ? 'active' : ''} onClick={() => setIsHome(true)}>後攻</button>
        </div>
        <button className="primary" style={{ width: '100%' }} onClick={() => dispatch({ type: 'CREATE_GAME', payload: { opponent, isHome } })}>
          試合開始
        </button>
      </div>

      {ongoing.length > 0 && (
        <div className="card">
          <h2>進行中の試合を再開</h2>
          {ongoing.map((g) => (
            <div className="row" key={g.id}>
              <div className="grow">
                <div>{g.date} vs {g.opponent || '対戦相手'}</div>
                <div className="dim">{g.myScore}-{g.oppScore} {g.inning}回{g.isTop ? '表' : '裏'}</div>
              </div>
              <button className="small primary" onClick={() => dispatch({ type: 'SELECT_GAME', id: g.id })}>再開</button>
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
  const nameOf = usePlayerName();
  return (
    <Sheet title="次の打者を選択" onClose={onClose}>
      <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={onPinchHitter}>
        🔄 代打を送る({nameOf(currentBatter(game)?.playerId)}に代えて)
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
        <button className="ghost" onClick={onClose}>キャンセル</button>
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

// ---- 三振確認カード(2ストライク後のストライクで自動表示) ----
function StrikeoutSheet({ game, batterName, onClose, onFurinige }) {
  const { dispatch } = useStore();
  const [soType, setSoType] = useState('swinging');

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

// ---- メイン ----
export default function ScoreTab() {
  const { state, dispatch } = useStore();
  const game = useCurrentGame();
  const nameOf = usePlayerName();
  const [sheet, setSheet] = useState(null); // {kind:'play',result} | {kind:'runner',base} | {kind:'batter'}

  // 試合終了直後もハイライトシートだけは表示し続ける(閉じたらGameSetupに戻る)
  if (!game || (game.status === 'finished' && sheet?.kind !== 'highlight')) return <GameSetup />;

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
              <AtBatHistory items={game.atBats.filter((ab) => ab.playerId === batter.playerId)} />
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
              </div>
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
              <AtBatHistory
                items={game.playLogs
                  .filter((l) => l.kind === 'defense' && l.payload.letter === oppBatter.letter)
                  .map((l) => ({ id: l.id, ...l.payload }))}
              />
            </>
          )}
        </div>
      )}

      <PitchCounter
        game={game}
        onAutoEvent={(kind) =>
          setSheet(kind === 'so' ? { kind: 'strikeout' } : { kind: 'play', result: 'bb' })
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
        <button className="mb8" style={{ width: '100%' }} onClick={() => setSheet({ kind: 'highlight' })}>
          🏆 ハイライトを見る・共有
        </button>
        <div className="grid2">
          <button onClick={() => window.confirm('攻守交代(チェンジ)しますか？') && dispatch({ type: 'FORCE_CHANGE_HALF', gameId: game.id })}>
            手動チェンジ
          </button>
          <button
            className="danger"
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

      <div className="card">
        <h2>プレイログ</h2>
        {[...game.playLogs].slice(-12).reverse().map((l) => (
          <div className="log-line" key={l.id}>
            <b>{l.inning}回{l.isTop ? '表' : '裏'}</b> {l.text}
          </div>
        ))}
        {game.playLogs.length === 0 && <div className="dim small">まだプレイがありません。</div>}
      </div>

      <UndoBar game={game} />
      <VoiceControl game={game} />

      {sheet?.kind === 'play' && (
        <PlaySheet
          game={game}
          initial={{ result: sheet.result, soType: sheet.soType, batterTo: sheet.batterTo }}
          batterName={myBatting && batter ? nameOf(batter.playerId) : null}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'strikeout' && (
        <StrikeoutSheet
          game={game}
          batterName={myBatting && batter ? nameOf(batter.playerId) : null}
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
    </div>
  );
}

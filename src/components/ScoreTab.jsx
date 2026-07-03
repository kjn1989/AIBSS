import React, { useState } from 'react';
import { useStore, useCurrentGame, usePlayerName, isMyTeamBatting, currentBatter } from '../state/store.jsx';
import Scoreboard from './Scoreboard.jsx';
import Diamond from './Diamond.jsx';
import PitchCounter from './PitchCounter.jsx';
import ResultPad from './ResultPad.jsx';
import PlaySheet from './PlaySheet.jsx';
import RunnerEventSheet from './RunnerEventSheet.jsx';
import Sheet from './Sheet.jsx';
import VoiceControl from './VoiceControl.jsx';
import { SubstituteSheet } from './OrderTab.jsx';
import { POSITIONS } from '../lib/model.js';
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

  if (!game || game.status === 'finished') return <GameSetup />;

  const myBatting = isMyTeamBatting(game);
  const batter = currentBatter(game);
  const noLineup = game.lineup.length === 0;
  const oppOrder = ((game.oppBatterIndex || 0) % 9) + 1; // 相手打者の打順(名前は管理せず9人サイクル)

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
        )
      ) : (
        <div className="card">
          <div className="flex">
            <span className="small dim">投手</span>
            <select
              className="grow"
              value={game.currentPitcherId || ''}
              onChange={(e) => e.target.value && dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: e.target.value })}
            >
              <option value="">投手を選択...</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex mt8">
            <span className="rank-badge">{oppOrder}</span>
            <span className="small dim grow">相手 打順{oppOrder}番(名前は管理しません)</span>
          </div>
          <AtBatHistory
            items={game.playLogs
              .filter((l) => l.kind === 'defense' && l.payload.oppOrder === oppOrder)
              .map((l) => ({ id: l.id, ...l.payload }))}
          />
          <p className="small dim mt8">守備中: 相手打者の結果を下のパッドで記録すると投手成績に反映されます。</p>
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
        <div className="grid2">
          <button onClick={() => window.confirm('攻守交代(チェンジ)しますか？') && dispatch({ type: 'FORCE_CHANGE_HALF', gameId: game.id })}>
            手動チェンジ
          </button>
          <button
            className="danger"
            onClick={() => window.confirm('試合を終了しますか？') && dispatch({ type: 'FINISH_GAME', id: game.id })}
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
    </div>
  );
}

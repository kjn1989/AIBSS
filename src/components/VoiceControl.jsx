import React, { useState, useRef, useEffect } from 'react';
import Sheet from './Sheet.jsx';
import PlaySheet from './PlaySheet.jsx';
import { useStore, usePlayerName, isMyTeamBatting, currentBatter } from '../state/store.jsx';
import { parseUtterance, playLabel } from '../lib/voiceParser.js';
import { interpretWithLLM } from '../lib/llm.js';
import { speechAvailable, createRecognizer } from '../lib/speech.js';
import { proposeMoves } from '../lib/plays.js';

const LLM_THRESHOLD = 0.5; // これ未満の信頼度ならLLMに問い合わせ(設定時のみ)

// 音声実況入力: FAB → 認識 → 解釈 → 大きな確認カード(1タップ確定/修正)
export default function VoiceControl({ game }) {
  const { state, dispatch } = useStore();
  const nameOf = usePlayerName();
  const [mode, setMode] = useState('idle'); // idle | listening | confirming | editing
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [llmUsed, setLlmUsed] = useState(false);
  const [manualText, setManualText] = useState('');
  const recRef = useRef(null);

  const myBatting = isMyTeamBatting(game);
  const batter = currentBatter(game);
  const batterName = myBatting && batter ? nameOf(batter.playerId) : null;

  useEffect(() => () => recRef.current?.abort?.(), []);

  const interpret = async (text) => {
    let cands = parseUtterance(text);
    setLlmUsed(false);
    // 信頼度が低ければ LLM 拡張(APIキー設定時のみ)
    const top = cands[0];
    if ((!top || top.confidence < LLM_THRESHOLD) && state.settings.useLLM && state.settings.anthropicApiKey) {
      const llm = await interpretWithLLM(text, state.settings.anthropicApiKey);
      if (llm && llm.kind !== 'unknown') {
        const cand = {
          kind: llm.kind,
          result: llm.result || null,
          direction: llm.direction || null,
          outType: llm.outType || null,
          pitchType: llm.pitchType || null,
          confidence: llm.confidence ?? 0.8,
          label:
            llm.kind === 'play'
              ? playLabel(llm.result, llm.direction, llm.outType)
              : llm.kind === 'pitch'
                ? { ball: 'ボール', strike: 'ストライク', foul: 'ファウル' }[llm.pitchType]
                : llm.kind === 'sb'
                  ? '盗塁成功'
                  : '盗塁死',
          fromLLM: true,
        };
        cands = [cand, ...cands.filter((c) => c.label !== cand.label)].slice(0, 3);
        setLlmUsed(true);
      }
    }
    setCandidates(cands);
    setMode('confirming');
  };

  const [micError, setMicError] = useState(false);

  const startListening = () => {
    setInterim('');
    setTranscript('');
    setManualText('');
    setMicError(false);
    setMode('listening'); // 認識不可でもテキスト実況入力ができるようシートは開く
    const rec = createRecognizer({
      onInterim: setInterim,
      onResult: (text) => {
        setTranscript(text);
        interpret(text);
      },
      // エラー/終了してもシートは開いたまま(テキスト入力にフォールバック)
      onError: () => setMicError(true),
      onEnd: () => {},
    });
    if (!rec) {
      setMicError(true);
      return;
    }
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setMicError(true);
    }
  };

  const stopListening = () => {
    recRef.current?.stop?.();
    setMode('idle');
  };

  // ---- 候補の適用 ----
  const apply = (cand) => {
    if (cand.kind === 'pitch') {
      dispatch({ type: 'ADD_PITCH', gameId: game.id, pitchType: cand.pitchType });
      setMode('idle');
      return;
    }
    if (cand.kind === 'sb' || cand.kind === 'cs') {
      // 次塁が空いている最も先の走者を対象にする
      const from = [3, 2, 1].find((b) => game.runners[b] && (b === 3 || !game.runners[b + 1]));
      if (!from) {
        setMode('idle');
        return;
      }
      const to = cand.kind === 'cs' ? 'out' : from + 1 >= 4 ? 4 : from + 1;
      dispatch({ type: 'RUNNER_EVENT', gameId: game.id, event: cand.kind === 'cs' ? 'cs' : 'sb', moves: [{ from, to }] });
      setMode('idle');
      return;
    }
    // play: デフォルトの進塁提案で即確定
    const runnersOn = { 1: !!game.runners[1], 2: !!game.runners[2], 3: !!game.runners[3] };
    const proposal = proposeMoves(cand.result, runnersOn);
    dispatch({
      type: 'CONFIRM_PLAY',
      gameId: game.id,
      batterName: batterName || '',
      payload: {
        result: cand.result,
        outType: cand.outType,
        direction: cand.direction,
        moves: proposal.moves,
        batterTo: proposal.batterTo,
      },
    });
    setMode('idle');
  };

  const [editCand, setEditCand] = useState(null);

  if (!speechAvailable() && mode === 'idle') {
    // 音声非対応ブラウザでもテキスト実況入力は使えるようにFABは出す
  }

  return (
    <>
      <button
        className={`voice-fab${mode === 'listening' ? ' listening' : ''}`}
        onClick={() => (mode === 'listening' ? stopListening() : startListening())}
        aria-label="音声実況"
      >
        {mode === 'listening' ? '⏹' : '🎙'}
      </button>

      {mode === 'listening' && (
        <Sheet title="🎙 実況をどうぞ…" onClose={stopListening}>
          <div className="big-note" style={{ padding: '18px 8px' }}>
            {interim || '「センター前ヒット」「サードがエラー」のように話してください'}
          </div>
          <div className="flex">
            <input
              className="grow"
              placeholder="またはテキストで実況を入力"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualText.trim()) {
                  recRef.current?.abort?.();
                  setTranscript(manualText.trim());
                  interpret(manualText.trim());
                }
              }}
            />
            <button
              className="primary"
              disabled={!manualText.trim()}
              onClick={() => {
                recRef.current?.abort?.();
                setTranscript(manualText.trim());
                interpret(manualText.trim());
              }}
            >
              解釈
            </button>
          </div>
          {(micError || !speechAvailable()) && (
            <div className="warn-box mt8">
              音声認識が利用できません(非対応ブラウザ/マイク拒否)。テキスト入力をご利用ください。
            </div>
          )}
        </Sheet>
      )}

      {mode === 'confirming' && (
        <Sheet onClose={() => setMode('idle')}>
          <div className="confirm-card" style={{ marginBottom: 0 }}>
            <div className="small dim">「{transcript}」{llmUsed && <span className="pill blue" style={{ marginLeft: 6 }}>AI解釈</span>}</div>
            {candidates.length === 0 ? (
              <>
                <div className="q mt8">解釈できませんでした 🙏</div>
                <div className="sheet-actions">
                  <button onClick={startListening}>🎙 やり直す</button>
                  <button className="ghost" onClick={() => setMode('idle')}>閉じる</button>
                </div>
              </>
            ) : (
              <>
                <div className="q mt8">{candidates[0].label} でよろしいですか？</div>
                <div className="cand">
                  <button className="top" onClick={() => apply(candidates[0])}>
                    ✔ はい、{candidates[0].label}
                    <span className="dim small"> (信頼度{Math.round(candidates[0].confidence * 100)}%)</span>
                  </button>
                  {candidates[0].kind === 'play' && (
                    <button onClick={() => { setEditCand(candidates[0]); setMode('editing'); }}>
                      ✎ 走者・方向を修正して確定
                    </button>
                  )}
                  {candidates.slice(1).map((c, i) => (
                    <button key={i} onClick={() => (c.kind === 'play' ? (setEditCand(c), setMode('editing')) : apply(c))}>
                      {c.label} <span className="dim small">({Math.round(c.confidence * 100)}%)</span>
                    </button>
                  ))}
                </div>
                <div className="sheet-actions">
                  <button onClick={startListening}>🎙 やり直す</button>
                  <button className="ghost" onClick={() => setMode('idle')}>キャンセル</button>
                </div>
              </>
            )}
          </div>
        </Sheet>
      )}

      {mode === 'editing' && editCand && (
        <PlaySheet
          game={game}
          initial={{ result: editCand.result, direction: editCand.direction, outType: editCand.outType }}
          batterName={batterName}
          onClose={() => {
            setEditCand(null);
            setMode('idle');
          }}
        />
      )}
    </>
  );
}

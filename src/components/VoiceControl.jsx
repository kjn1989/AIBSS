import React, { useState, useRef, useEffect } from 'react';
import Sheet from './Sheet.jsx';
import PlaySheet from './PlaySheet.jsx';
import { useStore, usePlayerName, isMyTeamBatting, currentBatter } from '../state/store.jsx';
import { parseUtterance, playLabel, normalize, stripWakeWord, parseCommand, needsComplexConfirm, parseOperation, matchPlayer } from '../lib/voiceParser.js';
import { interpretWithLLM } from '../lib/llm.js';
import { speechAvailable, createRecognizer } from '../lib/speech.js';
import { createContinuousRecognizer } from '../lib/continuousSpeech.js';
import { speak, beep, beepForPitch } from '../lib/tts.js';
import { proposeMoves } from '../lib/plays.js';

const LLM_THRESHOLD = 0.5; // これ未満の信頼度ならLLMに問い合わせ(設定時のみ)
const PENDING_MS = 2500; // 常時リスニングモード: オプトアウト自動確定までの待機時間

// 音声実況入力: FAB → 認識 → 解釈 → 大きな確認カード(1タップ確定/修正)
// + 常時リスニングモード(ウェイクワード「ログ」+ 3階層の確定方式)
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
  const interimRef = useRef('');
  const interpretedRef = useRef(false);

  const startListening = () => {
    setInterim('');
    setTranscript('');
    setManualText('');
    setMicError(false);
    interimRef.current = '';
    interpretedRef.current = false;
    setMode('listening'); // 認識不可でもテキスト実況入力ができるようシートは開く
    const rec = createRecognizer({
      onInterim: (text) => {
        interimRef.current = text;
        setInterim(text);
      },
      onResult: (text) => {
        interpretedRef.current = true;
        setTranscript(text);
        interpret(text);
      },
      // エラー/終了してもシートは開いたまま(テキスト入力にフォールバック)
      onError: () => setMicError(true),
      // iOS Safariでは確定結果が来ないまま認識が終わることがある
      // → 暫定(interim)テキストが残っていればそれで解釈する
      onEnd: () => {
        if (!interpretedRef.current && interimRef.current.trim()) {
          interpretedRef.current = true;
          setTranscript(interimRef.current.trim());
          interpret(interimRef.current.trim());
        }
      },
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
    // 長打(二塁打/三塁打/本塁打)で方向が聞き取れていない場合は、
    // 方向確認のためプレイシート(修正フロー)を開く
    if (cand.kind === 'play' && ['double', 'triple', 'hr'].includes(cand.result) && !cand.direction) {
      setEditCand(cand);
      setMode('editing');
      return;
    }
    // 犠打・犠飛はタップ入力と同様に走者の動きを必ず確認してから確定
    if (cand.kind === 'play' && ['sacBunt', 'sacFly'].includes(cand.result)) {
      setEditCand(cand);
      setMode('editing');
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
        soType: cand.soType,
        direction: cand.direction,
        moves: proposal.moves,
        batterTo: proposal.batterTo,
      },
    });
    setMode('idle');
  };

  const [editCand, setEditCand] = useState(null);

  // ---- 確認カードへの音声回答 ----
  // 「空振り」「見逃し」「はい」「やり直し」等を音声で受け付ける。
  // それ以外の発話は新しい実況として再解釈する。
  const [answerListening, setAnswerListening] = useState(false);
  const answerRecRef = useRef(null);

  const handleAnswer = (raw) => {
    setAnswerListening(false);
    const t = normalize(raw);
    const top = candidates[0];
    if (!top) return;
    const soPending = top.kind === 'play' && top.result === 'so' && !top.soExplicit;
    if (soPending && (t.includes('からぶ') || t.includes('空振'))) return apply({ ...top, soType: 'swinging' });
    if (soPending && (t.includes('みのが') || t.includes('見逃'))) return apply({ ...top, soType: 'looking' });
    if (/いいえ|ちがう|違う|やりなお|きゃんせる|だめ/.test(t)) {
      // 常時リスニングモードでは専用の継続認識が既に走っているため、
      // 単発セッションは起動せず確認状態を解いて待機に戻すだけでよい
      if (contMode) {
        setMode('idle');
        return;
      }
      return startListening();
    }
    if (/^(はい|うん|おっけ|ok|かくてい|確定|よし|それ)/.test(t)) {
      if (soPending) return; // 三振は種別(空振り/見逃し)の発話が必要
      return apply(top);
    }
    // 他候補のラベルとの一致を確認
    for (const c of candidates) {
      const cl = normalize(c.label);
      if (cl && (t.includes(cl) || cl.includes(t))) return apply(c);
    }
    // 新しい実況として解釈し直す
    setTranscript(raw);
    interpret(raw);
  };

  const startAnswerListening = () => {
    answerRecRef.current?.abort?.();
    const rec = createRecognizer({
      onInterim: () => {},
      onResult: handleAnswer,
      onError: () => setAnswerListening(false),
      onEnd: () => setAnswerListening(false),
    });
    if (!rec) return;
    answerRecRef.current = rec;
    setAnswerListening(true);
    try {
      rec.start();
    } catch {
      setAnswerListening(false);
    }
  };

  // ============================================================
  // 常時リスニングモード
  // ウェイクワード「ログ、〜」を必須にし、投球コールは即時自動確定、
  // 単純なプレイはオプトアウト自動確定、複雑なプレイのみ画面確認必須。
  // ============================================================
  const [contMode, setContMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [contStatus, setContStatus] = useState('idle'); // idle|listening|error|stopped|unsupported
  const [pendingCommit, setPendingCommit] = useState(null); // { cand, commitNow, startedAt }
  const contRecRef = useRef(null);
  const pendingTimerRef = useRef(null);
  const handlerRef = useRef(() => {});

  const cancelPendingCommit = () => {
    clearTimeout(pendingTimerRef.current);
    setPendingCommit(null);
  };

  const startPendingCommit = (cand) => {
    clearTimeout(pendingTimerRef.current);
    const commitNow = () => {
      clearTimeout(pendingTimerRef.current);
      setPendingCommit(null);
      apply(cand);
    };
    pendingTimerRef.current = setTimeout(commitNow, PENDING_MS);
    setPendingCommit({ cand, commitNow, startedAt: Date.now() });
  };

  // interpret()の常時リスニング版: 結果に応じて呼び出し側で階層分岐する
  const continuousInterpret = async (text) => {
    let cands = parseUtterance(text);
    let usedLLM = false;
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
        usedLLM = true;
      }
    }
    setLlmUsed(usedLLM);
    return cands;
  };

  // 操作コマンド(代打・代走・投手交代・チェンジ)を実行。処理したら true を返す。
  const handleOperation = (operation) => {
    const { op, name } = operation;

    if (op === 'change') {
      dispatch({ type: 'FORCE_CHANGE_HALF', gameId: game.id });
      speak('チェンジ');
      return true;
    }

    // 交代系: 登録選手(未出場)から発話名にファジー照合
    const inLineup = new Set(game.lineup.map((l) => l.playerId));
    const bench = state.players.filter((p) => !inLineup.has(p.id));
    const matched = matchPlayer(name, bench) || matchPlayer(name, state.players);
    if (!matched) {
      speak('選手が聞き取れませんでした');
      beep(320, 90);
      return true;
    }

    if (op === 'pitcher') {
      dispatch({
        type: 'SET_PITCHER', gameId: game.id, playerId: matched.id,
        label: game.currentPitcherId
          ? `継投: ${matched.name} (← ${nameOf(game.currentPitcherId)})`
          : `先発: ${matched.name}`,
      });
      speak(`投手 ${matched.name}`);
      return true;
    }

    if (op === 'ph') {
      const slot = currentBatter(game);
      if (!slot) { speak('打者がいません'); return true; }
      dispatch({
        type: 'SUBSTITUTE', gameId: game.id, order: slot.order, playerId: matched.id,
        position: slot.position, label: `代打: ${matched.name} (${slot.order}番 ${nameOf(slot.playerId)}に代わり)`,
      });
      speak(`代打 ${matched.name}`);
      return true;
    }

    if (op === 'pr') {
      // 塁上でlineupに属する走者のうち、最も先の塁の走者を代走対象にする
      const base = [3, 2, 1].find((b) => {
        const r = game.runners[b];
        return r?.playerId && game.lineup.some((l) => l.playerId === r.playerId);
      });
      if (!base) { speak('塁上に走者がいません'); return true; }
      const runnerPid = game.runners[base].playerId;
      const slot = game.lineup.find((l) => l.playerId === runnerPid);
      dispatch({
        type: 'SUBSTITUTE', gameId: game.id, order: slot.order, playerId: matched.id,
        position: slot.position, asRunner: true,
        label: `代走: ${matched.name} (${slot.order}番 ${nameOf(runnerPid)}に代わり)`,
      });
      speak(`代走 ${matched.name}`);
      return true;
    }

    return false;
  };

  const handleContinuousFinal = async (rawText) => {
    const rest = stripWakeWord(rawText);
    if (rest === null) return; // ウェイクワードなしの発話は誤反応防止のため無視

    const cmd = parseCommand(rest);

    if (cmd === 'unmute') {
      if (muted) {
        setMuted(false);
        speak('マイク再開');
      }
      return;
    }
    if (muted) return; // ミュート中は解除コマンド以外を無視

    if (cmd === 'mute') {
      setMuted(true);
      cancelPendingCommit();
      speak('ミュートしました');
      return;
    }
    if (cmd === 'undo') {
      cancelPendingCommit();
      const last = state.history[state.history.length - 1];
      if (last && last.gameId === game.id) {
        dispatch({ type: 'UNDO' });
        speak('取り消しました');
      }
      return;
    }
    if (mode === 'editing') return; // プレイシート編集中は音声を無視(手動操作に専念)

    if (pendingCommit) {
      if (cmd === 'cancel') {
        cancelPendingCommit();
        speak('キャンセルしました');
        return;
      }
      if (cmd === 'confirm') {
        pendingCommit.commitNow();
        return;
      }
      // 次の発話が来た場合は保留中のプレイをまず確定してから続けて処理する
      pendingCommit.commitNow();
    }

    if (mode === 'confirming') {
      if (cmd === 'cancel') {
        setMode('idle');
        return;
      }
      handleAnswer(rest);
      return;
    }

    // ---- 操作コマンド(代打・代走・投手交代・チェンジ) ----
    const operation = parseOperation(rest);
    if (operation && handleOperation(operation)) return;

    const cands = await continuousInterpret(rest);
    const top = cands[0];
    if (!top) {
      beep(320, 70); // 解釈できず: 低い短音のみ(画面遷移なし)
      return;
    }
    if (top.kind === 'pitch') {
      apply(top);
      beepForPitch(top.pitchType);
      return;
    }
    if (needsComplexConfirm(top)) {
      setTranscript(rest);
      setCandidates(cands);
      setMode('confirming');
      speak(`${top.label}でよろしいですか`);
      return;
    }
    // sb/cs、または単純なプレイ: オプトアウト自動確定
    setTranscript(rest);
    startPendingCommit(top);
    speak(top.label);
  };

  handlerRef.current = handleContinuousFinal;

  useEffect(() => {
    if (!contMode) {
      contRecRef.current?.stop?.();
      contRecRef.current = null;
      setContStatus('idle');
      cancelPendingCommit();
      return;
    }
    const rec = createContinuousRecognizer({
      onFinal: (text) => handlerRef.current(text),
      onStatus: (status) => setContStatus(status),
    });
    contRecRef.current = rec;
    rec.start();
    return () => {
      rec.stop();
      contRecRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contMode]);

  // 三振の種別選択が必要なときは自動で音声回答の受付を開始(一発リスニングモードのみ。
  // 常時リスニングモードでは既存の継続認識がそのまま回答も拾う)
  const soPendingTop =
    mode === 'confirming' && candidates[0]?.kind === 'play' && candidates[0]?.result === 'so' && !candidates[0]?.soExplicit;
  useEffect(() => {
    if (soPendingTop && speechAvailable() && !contMode) startAnswerListening();
    return () => answerRecRef.current?.abort?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soPendingTop, contMode]);

  useEffect(() => {
    if (mode !== 'confirming') answerRecRef.current?.abort?.();
  }, [mode]);

  if (!speechAvailable() && mode === 'idle') {
    // 音声非対応ブラウザでもテキスト実況入力は使えるようにFABは出す
  }

  const canUndo = state.history.length > 0 && state.history[state.history.length - 1].gameId === game.id;

  return (
    <>
      {!contMode && (
        <button
          className="cont-mode-toggle"
          onClick={() => speechAvailable() && setContMode(true)}
          disabled={!speechAvailable()}
          title={speechAvailable() ? '常時リスニングモードを開始' : '音声認識が利用できません'}
        >
          🎙️常時
        </button>
      )}

      {!contMode && (
        <button
          className={`voice-fab${mode === 'listening' ? ' listening' : ''}`}
          onClick={() => (mode === 'listening' ? stopListening() : startListening())}
          aria-label="音声実況"
        >
          {mode === 'listening' ? '⏹' : '🎙'}
        </button>
      )}

      {contMode && (
        <>
          <button
            className={`cont-status-pill ${muted ? 'muted' : contStatus === 'listening' ? 'live' : 'connecting'}`}
            onClick={() => setMuted((m) => !m)}
            aria-label="ミュート切り替え"
          >
            {muted ? '🔇 ミュート' : contStatus === 'listening' ? '🎙️ LIVE' : '🤔 接続中'}
          </button>
          <button className="cont-exit-btn" onClick={() => setContMode(false)}>常時モード終了</button>
          {canUndo && (
            <button
              className="cont-undo-btn"
              onClick={() => {
                cancelPendingCommit();
                dispatch({ type: 'UNDO' });
              }}
            >
              ↩ 1つ前に戻す
            </button>
          )}
          {pendingCommit && (
            <div className="pending-toast">
              <div className="pending-label">{pendingCommit.cand.label}</div>
              <div className="pending-bar-track">
                <div
                  key={pendingCommit.startedAt}
                  className="pending-bar"
                  style={{ '--pending-ms': `${PENDING_MS}ms` }}
                />
              </div>
              <button className="ghost small" onClick={cancelPendingCommit}>キャンセル</button>
            </div>
          )}
        </>
      )}

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
                  {!contMode && <button onClick={startListening}>🎙 やり直す</button>}
                  <button className="ghost" onClick={() => setMode('idle')}>閉じる</button>
                </div>
              </>
            ) : (
              <>
                <div className="q mt8">
                  {candidates[0].label} でよろしいですか？
                  {candidates[0].result === 'so' && !candidates[0].soExplicit && (
                    <span className="dim small" style={{ display: 'block', fontSize: 13 }}>空振り/見逃しを選んで確定</span>
                  )}
                </div>
                <div className="cand">
                  {candidates[0].kind === 'play' && candidates[0].result === 'so' && !candidates[0].soExplicit ? (
                    <div className="grid2">
                      <button className="top" style={{ minHeight: 54 }} onClick={() => apply({ ...candidates[0], soType: 'swinging' })}>
                        ✔ 空振り三振
                      </button>
                      <button className="top" style={{ minHeight: 54 }} onClick={() => apply({ ...candidates[0], soType: 'looking' })}>
                        ✔ 見逃し三振
                      </button>
                    </div>
                  ) : (
                    <button className="top" onClick={() => apply(candidates[0])}>
                      ✔ はい、{candidates[0].label}
                      <span className="dim small"> (信頼度{Math.round(candidates[0].confidence * 100)}%)</span>
                    </button>
                  )}
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
                {contMode ? (
                  <p className="small dim mt8" style={{ textAlign: 'center' }}>
                    🎙️ 常時リスニング中: 「ログ、はい」「ログ、空振り」「ログ、キャンセル」等と話せます
                  </p>
                ) : (
                  <>
                    <button
                      className={`mt8 ${answerListening ? 'danger' : ''}`}
                      style={{ width: '100%' }}
                      onClick={startAnswerListening}
                    >
                      {answerListening ? '🎙 音声回答を聞いています…' : '🎙 音声で回答する'}
                    </button>
                    <p className="small dim mt8" style={{ textAlign: 'center' }}>
                      「はい」「空振り」「見逃し」「やり直し」などと話せます
                    </p>
                  </>
                )}
                <div className="sheet-actions">
                  {!contMode && <button onClick={startListening}>🎙 やり直す</button>}
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
          initial={{ result: editCand.result, direction: editCand.direction, outType: editCand.outType, soType: editCand.soType }}
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

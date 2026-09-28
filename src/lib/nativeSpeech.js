// ============================================================
// ネイティブ音声認識(iOS SFSpeechRecognizer / Android SpeechRecognizer)を
// Web Speech API と同じ形に揃えるアダプタ。
//
// アプリ版(WKWebView / System WebView)では webkitSpeechRecognition が
// 動かないので、@capgo/capacitor-speech-recognition を経由してOSの認識器を使う。
// 呼び出し側(VoiceControl / continuousSpeech)はブラウザ版と同じ
//   start() / stop() / abort()
//   onInterim(text) / onResult(text) / onError(code) / onEnd()
// だけを見ればよいようにする。エラーコードも Web Speech API の名前に寄せる
// ('not-allowed' と 'service-not-allowed' は常時モードの再試行を止める合図)。
//
// OSごとの違いで、ここが吸収しているもの:
//   - iOS は発話が終わっても自分では止まらない(無音検出が無い)。止めるまで
//     聞き続け、止めると確定結果を出さずに終わる。なので「途中結果が一定時間
//     変わらなければ止める」をこちらでやり、最後の途中結果を確定として渡す。
//   - Android は自分で発話の終わりを検出して止まり、確定結果を途中結果と
//     同じイベントで送ってくる。上の仕組みでそのまま扱える。
//   - どちらも同時に1つしか動かせない。前のセッションが止まりきる前に
//     start すると "already running" で弾かれるので、止まるのを待ってから始める。
// ============================================================

// 発話が途切れたとみなすまでの時間。短すぎると「センター前…ヒット」の
// 間で切れ、長すぎると確定までもたつく。ブラウザ版の体感に合わせた値。
export const SILENCE_MS = 1200;
// 何も聞こえないまま待つ上限。ブラウザ版の no-speech とおおむね同じ長さ。
export const NO_SPEECH_MS = 8000;
// stop を頼んでも止まった通知が来ない場合に、こちらで打ち切るまでの時間
export const STOP_GRACE_MS = 1500;
// 前のセッションが止まるのを待つ上限
export const SETTLE_MS = 2000;

// iOS の認識器に「この言葉が出やすい」と伝える語彙(contextualStrings)。
// 野球用語は一般の文脈では出にくく、「センター」が「センタ」に、
// 「ゲッツー」が別の語に化けやすい。Apple の推奨は100語程度まで。
// Android はこのオプションを使わない。
export const BASEBALL_VOCAB = [
  'ログ',
  'ストライク', 'ボール', 'ファウル', '空振り', '見逃し',
  'ヒット', 'ツーベース', 'スリーベース', 'ホームラン', 'ランニングホームラン',
  'フォアボール', 'デッドボール', '四球', '死球', '敬遠', '三振',
  'ゴロ', 'フライ', 'ライナー', 'ファウルフライ', 'バント', 'セーフティバント',
  '犠打', '犠飛', '犠牲フライ', 'エラー', '失策', '野選', 'フィルダースチョイス',
  '併殺', 'ゲッツー', 'ダブルプレー', '振り逃げ',
  '盗塁', '盗塁死', '暴投', 'ワイルドピッチ', '捕逸', 'パスボール', 'ボーク', '牽制', '牽制死',
  'ピッチャー', 'キャッチャー', 'ファースト', 'セカンド', 'サード', 'ショート',
  'レフト', 'センター', 'ライト', '左中間', '右中間', '三遊間', '一二塁間',
  'ランナー', '一塁', '二塁', '三塁', 'ホーム', 'そのまま',
  'はい', 'いいえ', 'やり直し', 'キャンセル', '確定',
];

// プラグインのエラーコード / 例外メッセージ → Web Speech API のエラー名
export function mapNativeError(codeOrMessage) {
  const s = String(codeOrMessage || '');
  if (/PERMISSION|permission|denied/i.test(s)) return 'not-allowed';
  // iOS の「何も話されなかった」は kAFAssistantErrorDomain の 1110
  if (/NO_MATCH|SPEECH_TIMEOUT|_1110$|no match|no speech/i.test(s)) return 'no-speech';
  if (/NETWORK|SERVER|network|server/i.test(s)) return 'network';
  if (/AUDIO|audio/i.test(s)) return 'audio-capture';
  // 言語が使えない、認識器そのものが使えない(Siriと音声入力がオフ等)。
  // 繰り返し試しても直らないので、常時モードの再試行を止める側に倒す
  if (/UNSUPPORTED_LOCALE|RECOGNIZER_UNAVAILABLE|unavailable|Unsupported locale|not available/i.test(s)) {
    return 'service-not-allowed';
  }
  return 'unknown';
}

// プラグイン1つにつき1つ作る。イベントの購読と「いま動いているセッション」を
// ここで一元管理する(OS側も同時に1セッションしか持てないため)。
export function createNativeSpeechEngine(plugin, deps = {}) {
  const setT = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout || ((id) => clearTimeout(id));
  const language = deps.language || 'ja-JP';

  let current = null; // いま音声を受けているセッション
  let settled = Promise.resolve(); // 直前のセッションが止まりきったら解決する
  let listening = null; // addListener の登録(一度だけ)

  const ensureListeners = () => {
    if (listening) return listening;
    const add = (name, fn) => Promise.resolve(plugin.addListener(name, fn)).catch(() => null);
    listening = Promise.all([
      add('partialResults', (ev) => current?.handlePartial(ev)),
      add('error', (ev) => current?.handleError(ev)),
      add('listeningState', (ev) => current?.handleState(ev)),
    ]);
    return listening;
  };

  const waitSettled = () => new Promise((resolve) => {
    const id = setT(resolve, SETTLE_MS);
    settled.then(() => { clearT(id); resolve(); });
  });

  const ensurePermission = async () => {
    try {
      const now = await plugin.checkPermissions();
      if (now?.speechRecognition === 'granted') return true;
      const asked = await plugin.requestPermissions();
      return asked?.speechRecognition === 'granted';
    } catch {
      return false;
    }
  };

  function createRecognizer({ onInterim, onResult, onError, onEnd } = {}) {
    let phase = 'idle'; // idle | starting | running | stopping | done
    let silent = false; // abort 後はどのコールバックも呼ばない
    let last = '';
    let errCode = null;
    let sid = null; // OS側のセッション番号。startingListening で分かる
    let silenceTimer = null;
    let noSpeechTimer = null;
    let graceTimer = null;
    let markSettled = () => {};

    const clearTimers = () => {
      clearT(silenceTimer);
      clearT(noSpeechTimer);
      clearT(graceTimer);
      silenceTimer = noSpeechTimer = graceTimer = null;
    };

    const finish = () => {
      if (phase === 'done') return;
      phase = 'done';
      clearTimers();
      if (current === session) current = null;
      markSettled();
      if (silent) return;
      const text = last.trim();
      if (text) onResult?.(text);
      else onError?.(errCode || 'no-speech');
      onEnd?.();
    };

    // 起動前に失敗した(権限なし・開始できない)。OS側のセッションは無い
    const fail = (code) => {
      if (phase === 'done') return;
      errCode = code;
      last = '';
      finish();
    };

    const requestStop = () => {
      if (phase === 'done' || phase === 'stopping') return;
      if (phase !== 'running') { finish(); return; }
      phase = 'stopping';
      clearT(silenceTimer);
      clearT(noSpeechTimer);
      Promise.resolve().then(() => plugin.stop()).catch(() => {});
      // 止まった通知が来なければこちらで打ち切る。OS側に残っていれば強制停止
      graceTimer = setT(() => {
        Promise.resolve().then(() => plugin.forceStop?.()).catch(() => {});
        finish();
      }, STOP_GRACE_MS);
    };

    // 自分のセッションのイベントか。強制停止で打ち切った前のセッションの
    // 「止まった」通知が遅れて届き、次のセッションを止めてしまうのを防ぐ。
    // 途中結果には番号が付かないが、番号が分かる前に届くものは前の残りなので捨てる
    const mine = (ev) => sid != null && (ev?.sessionId == null || ev.sessionId === sid);

    const session = {
      handlePartial(ev) {
        // stop を頼んだ後も受ける。Android は止めたあとに確定結果を送ってくる
        if ((phase !== 'running' && phase !== 'stopping') || sid == null) return;
        const text = String(ev?.accumulatedText || ev?.matches?.[0] || '').trim();
        if (!text || text === last) return;
        last = text;
        if (!silent) onInterim?.(text);
        if (phase !== 'running') return;
        clearT(noSpeechTimer);
        noSpeechTimer = null;
        clearT(silenceTimer);
        silenceTimer = setT(requestStop, SILENCE_MS);
      },
      handleError(ev) {
        if (phase === 'done' || !mine(ev)) return;
        errCode = mapNativeError(ev?.code || ev?.message);
      },
      handleState(ev) {
        if (phase === 'done') return;
        if (ev?.state === 'startingListening' && sid == null) { sid = ev.sessionId ?? 0; return; }
        if (ev?.state === 'stopped' && mine(ev)) finish();
      },
    };

    const begin = async () => {
      await ensureListeners();
      await waitSettled();
      if (phase === 'done') return;
      if (!(await ensurePermission())) return fail('not-allowed');
      if (phase === 'done') return;

      settled = new Promise((resolve) => { markSettled = resolve; });
      current = session;
      phase = 'running';
      noSpeechTimer = setT(requestStop, NO_SPEECH_MS);
      const opts = {
        language,
        maxResults: 1,
        partialResults: true,
        popup: false,
        contextualStrings: BASEBALL_VOCAB,
      };
      try {
        await plugin.start(opts);
      } catch (e) {
        const msg = String(e?.message || e || '');
        // 前のセッションが OS 側に残っていた。一度だけ強制停止してやり直す
        if (/already running/i.test(msg) && phase === 'running') {
          try { await plugin.forceStop?.(); } catch { /* ignore */ }
          try {
            await plugin.start(opts);
            return;
          } catch (e2) {
            if (phase === 'running') return fail(mapNativeError(e2?.message || e2));
            return;
          }
        }
        // 途中結果モードでは、stop 済みの start が reject されることがある。
        // それは失敗ではない(止まった通知で finish される)
        if (phase === 'running') fail(mapNativeError(msg));
      }
    };

    return {
      start() {
        if (phase !== 'idle') return;
        phase = 'starting';
        begin();
      },
      // Web Speech API の stop と同じく、それまでに聞き取れた分は結果として渡す
      stop() {
        requestStop();
      },
      // 結果もエラーも渡さずに捨てる
      abort() {
        silent = true;
        requestStop();
      },
    };
  }

  return { createRecognizer };
}

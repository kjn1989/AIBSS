// ============================================================
// 常時リスニング用ラッパー
// iOS Safari含む各ブラウザのSpeechRecognitionは「本当の意味での常時ON」を
// 維持できない(無音や発話終了でセッションが切れる)ため、
// 終了のたびに自動で再startすることで疑似的な常時リスニングを実現する。
// ============================================================
import { createRecognizer, isIOSWebKit } from './speech.js';

// onStatus: 'listening' | 'error' | 'stopped' | 'unsupported'
export function createContinuousRecognizer({ onFinal, onInterim, onStatus }) {
  // Android Chrome/デスクトップは continuous=true で1セッションを維持し、
  // 発話間の取りこぼしを無くす。iOS系WebKitはcontinuousが不安定なため
  // 従来どおり発話ごとに再起動する(ギャップは下で最小化)。
  const useContinuous = !isIOSWebKit();
  let rec = null;
  let stopped = true;
  let restartTimer = null;

  const launch = () => {
    if (stopped) return;
    rec = createRecognizer({
      continuous: useContinuous,
      onInterim,
      onResult: (text) => onFinal?.(text),
      onError: (err) => {
        onStatus?.('error', err);
        // マイク拒否等の致命的エラーはリトライしない
        if (err === 'not-allowed' || err === 'service-not-allowed') stopped = true;
      },
      onEnd: () => {
        if (stopped) {
          onStatus?.('stopped');
          return;
        }
        // セッションが切れたら即時再起動(旧250ms→50ms。発話の頭切れを最小化)
        clearTimeout(restartTimer);
        restartTimer = setTimeout(launch, 50);
      },
    });
    if (!rec) {
      onStatus?.('unsupported');
      stopped = true;
      return;
    }
    try {
      rec.start();
      onStatus?.('listening');
    } catch {
      // 直前のセッション終了直後のInvalidStateError等はリトライ
      clearTimeout(restartTimer);
      restartTimer = setTimeout(launch, 250);
    }
  };

  const start = () => {
    stopped = false;
    launch();
  };

  const stop = () => {
    stopped = true;
    clearTimeout(restartTimer);
    rec?.stop?.();
  };

  return { start, stop };
}

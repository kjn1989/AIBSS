// ============================================================
// 常時リスニング用ラッパー
// iOS Safari含む各ブラウザのSpeechRecognitionは「本当の意味での常時ON」を
// 維持できない(無音や発話終了でセッションが切れる)ため、
// 終了のたびに自動で再startすることで疑似的な常時リスニングを実現する。
// ============================================================
import { createRecognizer } from './speech.js';

// onStatus: 'listening' | 'error' | 'stopped' | 'unsupported'
export function createContinuousRecognizer({ onFinal, onInterim, onStatus }) {
  let rec = null;
  let stopped = true;
  let restartTimer = null;

  const launch = () => {
    if (stopped) return;
    rec = createRecognizer({
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
        // 短い間隔で再起動(iOS Safariのセッション終了に対応)
        clearTimeout(restartTimer);
        restartTimer = setTimeout(launch, 250);
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

// ============================================================
// Web Speech API (ja-JP) ラッパー
// iOS Safari / Android Chrome の webkitSpeechRecognition に対応
// ============================================================

export function speechAvailable() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// iOS/iPadOS(WebKit)判定。SpeechRecognitionのcontinuousが不安定なため再起動方式に切り替える
export function isIOSWebKit() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function createRecognizer({ onInterim, onResult, onError, onEnd, continuous = false }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ja-JP';
  rec.interimResults = true;
  // continuous=true: 1セッションで複数発話を受け続ける(Android Chrome/デスクトップ)。
  // 発話ごとのセッション終了→再起動のギャップ(0.5〜1秒の取りこぼし)が無くなる。
  rec.continuous = continuous;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let finalText = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    if (interim) onInterim?.(interim);
    if (finalText) onResult?.(finalText);
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => onEnd?.();
  return rec;
}

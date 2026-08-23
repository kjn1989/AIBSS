// ============================================================
// Web Speech API (ja-JP) ラッパー
// iOS Safari / Android Chrome の webkitSpeechRecognition に対応
// ============================================================

// ネイティブラッパー(Capacitor)の中で動いているか。
// Capacitorはネイティブビルド時だけ window.Capacitor を注入するので、
// これが立っていれば iOS の WKWebView / Android の System WebView の中にいる。
function inNativeWebView(w) {
  const cap = w?.Capacitor;
  return typeof cap?.isNativePlatform === 'function' ? !!cap.isNativePlatform() : false;
}

// 音声認識が「本当に動く」か。
//
// 存在チェックだけでは足りない。WebKitの既知の不具合(bug 239816)のとおり、
// iOSのWKWebViewは webkitSpeechRecognition を露出したまま認識が動かない。
// つまりネイティブアプリ版では window.webkitSpeechRecognition が truthy なのに
// 開始しても何も起きない。存在だけを見ていると、音声UIが出てくるのに押しても
// 無反応、という一番たちの悪い壊れ方をする。
//
// フルブラウザ(Safari / Chrome)だけがこのAPIを公開している機能なので、
// 埋め込みWebViewの中では一律「使えない」と答え、呼び出し側の
// テキスト入力フォールバックへ倒す。
// ネイティブでも音声を使いたい場合は、SFSpeechRecognizer等を叩く
// ネイティブプラグインを createRecognizer に差し込む必要がある。
export function speechSupported(w) {
  if (!w) return false;
  if (inNativeWebView(w)) return false;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function speechAvailable() {
  return speechSupported(typeof window === 'undefined' ? null : window);
}

// iOS/iPadOS(WebKit)判定。SpeechRecognitionのcontinuousが不安定なため再起動方式に切り替える
export function isIOSWebKit() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function createRecognizer({ onInterim, onResult, onError, onEnd, continuous = false }) {
  // speechAvailable()と同じ判定をここでも通す。呼び出し側が確認を忘れても、
  // 動かないrecognizerを掴んで無反応になるより null で失敗した方が分かりやすい
  if (!speechAvailable()) return null;
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

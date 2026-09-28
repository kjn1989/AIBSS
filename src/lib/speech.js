// ============================================================
// Web Speech API (ja-JP) ラッパー
// iOS Safari / Android Chrome の webkitSpeechRecognition に対応
// アプリ版(Capacitor)ではOSの認識器をつなぐ(nativeSpeech.js)
// ============================================================
import { createNativeSpeechEngine } from './nativeSpeech.js';

// ネイティブラッパー(Capacitor)の中で動いているか。
// Capacitorはネイティブビルド時だけ window.Capacitor を注入するので、
// これが立っていれば iOS の WKWebView / Android の System WebView の中にいる。
function inNativeWebView(w) {
  const cap = w?.Capacitor;
  return typeof cap?.isNativePlatform === 'function' ? !!cap.isNativePlatform() : false;
}

// アプリ版で使うOSの音声認識プラグイン。ネイティブ側に組み込まれていて、
// JS側でも登録済み(nativeBridge.js が読み込む)のときだけ返す
function nativeSpeechPlugin(w) {
  const cap = w?.Capacitor;
  if (typeof cap?.isPluginAvailable !== 'function' || !cap.isPluginAvailable('SpeechRecognition')) return null;
  return cap.Plugins?.SpeechRecognition || null;
}

// 音声認識が「本当に動く」か。
//
// 存在チェックだけでは足りない。WebKitの既知の不具合(bug 239816)のとおり、
// iOSのWKWebViewは webkitSpeechRecognition を露出したまま認識が動かない。
// つまりネイティブアプリ版では window.webkitSpeechRecognition が truthy なのに
// 開始しても何も起きない。存在だけを見ていると、音声UIが出てくるのに押しても
// 無反応、という一番たちの悪い壊れ方をする。
//
// なので埋め込みWebViewの中では webkitSpeechRecognition を一切見ず、
// OSの認識器をつなぐネイティブプラグインがあるときだけ「使える」と答える。
// プラグインの無い古いビルドでは、呼び出し側のテキスト入力フォールバックへ倒れる。
export function speechSupported(w) {
  if (!w) return false;
  if (inNativeWebView(w)) return !!nativeSpeechPlugin(w);
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

// プラグインごとに1つ。OS側は同時に1セッションしか持てないので、
// セッションの受け渡しを1か所で管理する
const nativeEngines = new WeakMap();
function nativeEngineFor(plugin) {
  let engine = nativeEngines.get(plugin);
  if (!engine) {
    engine = createNativeSpeechEngine(plugin);
    nativeEngines.set(plugin, engine);
  }
  return engine;
}

export function createRecognizer({ onInterim, onResult, onError, onEnd, continuous = false }) {
  // speechAvailable()と同じ判定をここでも通す。呼び出し側が確認を忘れても、
  // 動かないrecognizerを掴んで無反応になるより null で失敗した方が分かりやすい
  if (!speechAvailable()) return null;
  // アプリ版: OSの認識器。発話1回ごとのセッションなので continuous は使わない
  // (常時モードは continuousSpeech.js が終わるたびに start し直す)
  if (inNativeWebView(window)) {
    const plugin = nativeSpeechPlugin(window);
    return plugin ? nativeEngineFor(plugin).createRecognizer({ onInterim, onResult, onError, onEnd }) : null;
  }
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

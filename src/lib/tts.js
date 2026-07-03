// ============================================================
// 音声フィードバック: 読み上げ(TTS) + 短い電子音(SE)
// 常時リスニングモードで画面を見なくても状況を把握できるようにする。
// ============================================================

export function speak(text, { rate = 1.05 } = {}) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel(); // 前の読み上げを打ち切り、常に最新を優先(テンポ重視)
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = rate;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// 短いビープ音(超高頻度プレイの即時フィードバック用)
export function beep(freq = 880, durationMs = 90) {
  try {
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + durationMs / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + durationMs / 1000);
  } catch {
    /* AudioContext利用不可・自動再生制限時は無視 */
  }
}

// 投球種別ごとに音程を変え、画面を見なくても聞き分けられるようにする
export function beepForPitch(pitchType) {
  const freq = { ball: 660, strike: 990, foul: 440 }[pitchType] || 700;
  beep(freq, 90);
}

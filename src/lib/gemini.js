// ============================================================
// 任意拡張: Gemini APIによるAI選手名鑑スカウト寸評の生成
// APIキーは設定画面で任意入力。未設定時は呼び出さない(呼び出し元でダミー文言にフォールバック)。
// ============================================================

const MODEL = 'gemini-1.5-flash';

function buildPrompt({ name, number, tags }) {
  const plus = tags.filter((t) => t.type === 'plus').map((t) => t.label);
  const minus = tags.filter((t) => t.type === 'minus').map((t) => t.label);
  const joke = tags.filter((t) => t.type === 'joke').map((t) => t.label);
  return `あなたは草野球チームのベテランスカウトです。以下の選手情報から、パワプロ風の「愛のある辛口スカウト寸評」を作成してください。

選手名: ${name}${number ? ` #${number}` : ''}
長所タグ: ${plus.join('、') || 'なし'}
短所タグ: ${minus.join('、') || 'なし'}
個性・チーム貢献タグ: ${joke.join('、') || 'なし'}

条件:
- catchphraseは12文字程度の短いキャッチコピー
- reportは100〜150文字程度、親しみを込めつつ的確に長所と短所の両方に触れる文章
- 出力は次のJSON形式のみ。説明文や前置きは一切禁止:
{"catchphrase":"...","report":"..."}`;
}

export async function generateScoutReport({ apiKey, name, number, tags }) {
  if (!apiKey || !navigator.onLine) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt({ name, number, tags }) }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 300 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.report) return null;
    return { catchphrase: parsed.catchphrase || '', report: parsed.report };
  } catch {
    return null; // ネットワーク/解析エラー時はダミー生成にフォールバック
  }
}

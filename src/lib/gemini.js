// ============================================================
// 任意拡張: Gemini APIによるAI選手名鑑スカウト寸評の生成
// APIキーは設定画面で任意入力。未設定時は呼び出さない(呼び出し元でダミー文言にフォールバック)。
// ============================================================

// 個別バージョンを固定すると廃止時に壊れるため、Googleが常に生きたモデルを
// 指し続けるエイリアス(-latest)を使う。
const MODEL = 'gemini-flash-latest';

function buildPrompt({ name, number, tags, statsSummary }) {
  const plus = tags.filter((t) => t.type === 'plus').map((t) => t.label);
  const minus = tags.filter((t) => t.type === 'minus').map((t) => t.label);
  const joke = tags.filter((t) => t.type === 'joke').map((t) => t.label);
  return `あなたは草野球チームのベテランスカウトです。以下の選手情報から、パワプロ風の「愛のある辛口スカウト寸評」を作成してください。

選手名: ${name}${number ? ` #${number}` : ''}
今季成績: ${statsSummary || 'まだ実戦データなし'}
長所タグ: ${plus.join('、') || 'なし'}
短所タグ: ${minus.join('、') || 'なし'}
個性・チーム貢献タグ: ${joke.join('、') || 'なし'}

条件:
- catchphraseは12文字程度の短いキャッチコピー
- reportは100〜150文字程度、今季成績の具体的な数字に触れつつ、親しみを込めて長所と短所の両方に言及する文章(成績データがない場合は数字への言及は省略してよい)
- 出力は次のJSON形式のみ。説明文や前置きは一切禁止:
{"catchphrase":"...","report":"..."}`;
}

// 戻り値: 成功時 { catchphrase, report }。
// 失敗時 { error: '画面表示用の理由文字列' }。未設定/オフライン時のみ null。
export async function generateScoutReport({ apiKey, name, number, tags, statsSummary }) {
  if (!apiKey || !navigator.onLine) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt({ name, number, tags, statsSummary }) }] }],
          // thinkingBudget: 0 で内部思考トークンを無効化(有効なままだと出力トークンが
          // 思考に消費され、maxOutputTokensに達しても本文が空になることがある)。
          generationConfig: { temperature: 0.9, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let reason = body;
      try {
        reason = JSON.parse(body)?.error?.message || body;
      } catch {
        /* bodyがJSONでなければそのまま使う */
      }
      return { error: `HTTP ${res.status}: ${reason}`.slice(0, 200) };
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const finishReason = data.candidates?.[0]?.finishReason;
      return { error: `AIの応答からJSONを取り出せませんでした${finishReason ? ` (finishReason: ${finishReason})` : ''}` };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.report) return { error: 'AIの応答にreportが含まれていません' };
    return { catchphrase: parsed.catchphrase || '', report: parsed.report };
  } catch (e) {
    return { error: e?.message || 'ネットワークエラー' };
  }
}

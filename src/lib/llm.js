// ============================================================
// 任意拡張: 外部LLM API(Anthropic)による発話解釈
// オフラインエンジンの信頼度が低いときのみ呼ばれる。
// APIキーは設定画面で任意入力。未設定/オフライン時は使われない。
// ============================================================

const SYSTEM_PROMPT = `あなたは野球のスコアラー補助AIです。日本語の実況発話を解釈し、次のJSONだけを出力してください(説明文は禁止):
{"kind":"play"|"pitch"|"sb"|"cs"|"unknown","result":"single"|"double"|"triple"|"hr"|"out"|"bb"|"hbp"|"so"|"error"|"sacBunt"|"sacFly"|null,"outType":"ground"|"fly"|"liner"|"dp"|null,"direction":"P"|"C"|"1B"|"2B"|"3B"|"SS"|"LF"|"CF"|"RF"|null,"pitchType":"ball"|"strike"|"foul"|null,"confidence":0.0〜1.0}
kindの意味: play=打撃結果, pitch=1球の判定のみ, sb=盗塁成功, cs=盗塁死。判断できない場合はkind="unknown"。`;

export async function interpretWithLLM(text, apiKey) {
  if (!apiKey || !navigator.onLine) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `発話: ${text}` }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.kind || parsed.kind === 'unknown') return null;
    return parsed;
  } catch {
    return null; // ネットワーク/解析エラー時はオフライン結果にフォールバック
  }
}

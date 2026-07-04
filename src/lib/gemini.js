// ============================================================
// 任意拡張: Gemini API 連携
//   - AI選手名鑑(スカウト寸評)
//   - AIヘッドコーチ(スタメン提案)
//   - AIスポーツ新聞(試合記事)
// APIキーは設定画面で任意入力。未設定/オフライン時は呼ばない(呼び出し元でフォールバック)。
// ============================================================

// 個別バージョンを固定すると廃止時に壊れるため、Googleが常に生きたモデルを
// 指し続けるエイリアス(-latest)を使う。
const MODEL = 'gemini-flash-latest';

// 低レベル共通呼び出し。プロンプトを投げてJSONを1つ取り出す。
// 戻り値: 成功 { data: <parsed> } / 失敗 { error: <表示用文字列> } / 未設定・オフライン null
async function callGeminiJSON(apiKey, prompt, { maxOutputTokens = 1024, temperature = 0.9 } = {}) {
  if (!apiKey || !navigator.onLine) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget: 0 で内部思考トークンを無効化(有効だと出力が思考に消費され本文が空になる)。
          generationConfig: { temperature, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let reason = body;
      try {
        reason = JSON.parse(body)?.error?.message || body;
      } catch {
        /* JSONでなければそのまま */
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
    return { data: JSON.parse(jsonMatch[0]) };
  } catch (e) {
    return { error: e?.message || 'ネットワークエラー' };
  }
}

// ---------------- AI選手名鑑(スカウト寸評) ----------------
function scoutPrompt({ name, number, tags, statsSummary }) {
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

// 戻り値: 成功 { catchphrase, report } / 失敗 { error } / 未設定・オフライン null
export async function generateScoutReport({ apiKey, name, number, tags, statsSummary }) {
  const r = await callGeminiJSON(apiKey, scoutPrompt({ name, number, tags, statsSummary }));
  if (!r || r.error) return r;
  if (!r.data.report) return { error: 'AIの応答にreportが含まれていません' };
  return { catchphrase: r.data.catchphrase || '', report: r.data.report };
}

// ---------------- AIヘッドコーチ(スタメン提案) ----------------
// players: [{ name, statsLine }] 候補選手。statsLineは「打率.320 出塁率.400 OPS.850 打点5」等。
// dh=true: DH制(打順9人=守備8+DH1、別に打順外の投手1人、合計10人)
// dh=false: DHなし(打順9人=投手含む全員守備)
function lineupPrompt(players, dh) {
  const list = players.map((p) => `- ${p.name}（${p.statsLine || '成績データ少'}）`).join('\n');
  if (dh) {
    return `あなたは草野球チームの名将ヘッドコーチです。以下の候補選手の今季成績をもとに、最も得点が期待できるスタメンを提案してください。DH制です。

候補選手（今季成績）:
${list}

条件:
- 打順(lineup)はちょうど9人。守備位置は「捕 一 二 三 遊 左 中 右」を各1つずつ割り当て、残り1人をDHにする（8守備+DH=9人。各ポジション重複禁止・欠け禁止）。投手は打順に入れない。
- 別途、打順に入らない投手(pitcher)を1人選ぶ（打席に立たない）。合計10人。
- 候補が11人以上いる場合は、成績を見て使う10人を選抜する（全員を入れない）。
- nameは候補選手名を一字一句そのまま使う（余計な装飾なし）。
- 各打者に position（捕一二三遊左中右DHのいずれか）と reason（30字程度の起用理由）を付ける。
- 出塁率の高い打者を上位、長打力を3〜5番等のセオリーを踏まえる。
- strategy に全体の狙いを80字程度で。
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"lineup":[{"name":"...","position":"...","reason":"..."}],"pitcher":{"name":"...","reason":"..."},"strategy":"..."}`;
  }
  return `あなたは草野球チームの名将ヘッドコーチです。以下の候補選手の今季成績をもとに、最も得点が期待できるスタメン9人を選び、打順と守備位置を提案してください。DHなしです。

候補選手（今季成績）:
${list}

条件:
- 打順(lineup)はちょうど9人。守備位置「投 捕 一 二 三 遊 左 中 右」を9人に各1つずつ割り当てる（重複禁止・欠け禁止。投手も打席に立つ）。
- 候補が10人以上いる場合は、成績を見て9人を選抜する（全員を入れない）。
- nameは候補選手名を一字一句そのまま使う（余計な装飾なし）。
- 各選手に position（投捕一二三遊左中右のいずれか）と reason（30字程度の起用理由）を付ける。
- 出塁率の高い打者を上位、長打力を3〜5番等のセオリーを踏まえる。
- strategy に全体の狙いを80字程度で。
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"lineup":[{"name":"...","position":"...","reason":"..."}],"strategy":"..."}`;
}

// 戻り値: 成功 { lineup:[{name,position,reason}], pitcher(DH時のみ){name,reason}, strategy } / 失敗 { error } / 未設定・オフライン null
export async function generateLineup({ apiKey, players, dh = false }) {
  const r = await callGeminiJSON(apiKey, lineupPrompt(players, dh), { maxOutputTokens: 2048, temperature: 0.7 });
  if (!r || r.error) return r;
  if (!Array.isArray(r.data.lineup) || r.data.lineup.length === 0) {
    return { error: 'AIの応答にlineupが含まれていません' };
  }
  return { lineup: r.data.lineup, pitcher: dh ? r.data.pitcher || null : null, strategy: r.data.strategy || '' };
}

// ---------------- AIスポーツ新聞(試合記事) ----------------
// summary: 試合結果を人間可読テキストにまとめたもの(スコア・MVP・好投・見どころ等)
function newspaperPrompt(summary) {
  return `あなたはスポーツ新聞のベテラン記者です。以下の試合結果から、臨場感あふれるスポーツ新聞の記事を書いてください。草野球の試合ですが、プロ野球の一面記事のように熱く、少しユーモアも交えて。

${summary}

条件:
- headline: 力強い大見出し（20字以内、新聞一面風）
- subhead: 小見出し（30字程度）
- body: 本文（150〜250字、試合展開・主役の活躍・投手に触れる新聞記事調）
- comment: 一言講評（40字程度、愛のあるユーモアを添えて）
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"headline":"...","subhead":"...","body":"...","comment":"..."}`;
}

// 戻り値: 成功 { headline, subhead, body, comment } / 失敗 { error } / 未設定・オフライン null
export async function generateNewspaper({ apiKey, summary }) {
  const r = await callGeminiJSON(apiKey, newspaperPrompt(summary), { maxOutputTokens: 2048, temperature: 0.95 });
  if (!r || r.error) return r;
  if (!r.data.headline || !r.data.body) return { error: 'AIの応答に記事本文が含まれていません' };
  return {
    headline: r.data.headline,
    subhead: r.data.subhead || '',
    body: r.data.body,
    comment: r.data.comment || '',
  };
}

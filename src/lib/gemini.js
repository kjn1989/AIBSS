// ============================================================
// 任意拡張: Gemini API 連携
//   - AI選手名鑑(スカウト寸評)
//   - AIヘッドコーチ(スタメン提案)
//   - AIスポーツ新聞(試合記事)
// APIキーは設定画面で任意入力。未設定/オフライン時は呼ばない(呼び出し元でフォールバック)。
// ============================================================

// 無料枠(レート上限)はモデルごとに別枠で、しかもモデルによって大きく違う。
// エイリアス(-latest)は上限の厳しいプレビュー系を指すことがあり、ほとんど使って
// いなくても 429 になることがある。そこで安定版から順に試し、429(上限)や
// 404(そのキーで使えない)なら次の候補へ回す。廃止によるロックインも避けられる。
const MODEL_CANDIDATES = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
let preferredModel = null; // 一度成功したモデルは次回から先に試す(無駄な失敗を減らす)

// Geminiのエラーは英語で返るため、記録係がそのまま読んで対処できる日本語にする。
// 原因の切り分けに使えるようHTTPコードは残し、必要なら原文も短く添える。
function describeApiError(status, raw = '') {
  const m = String(raw);
  const brief = m.replace(/\s+/g, ' ').slice(0, 60);
  if (status === 429) return '無料枠の上限に達しました (HTTP 429)';
  if (status === 400 && /api[_ ]?key|API_KEY_INVALID/i.test(m)) return 'APIキーが正しくありません (HTTP 400)';
  if (status === 400) return `リクエストが受け付けられませんでした (HTTP 400: ${brief})`;
  if (status === 401 || status === 403) return `APIキーが無効か、利用が許可されていません (HTTP ${status})`;
  if (status === 404) return '指定のAIモデルが利用できません (HTTP 404)';
  if (status >= 500) return `Gemini側が混雑または障害中です (HTTP ${status})`;
  return `AIの呼び出しに失敗しました (HTTP ${status}: ${brief})`;
}

// 1モデルぶんの呼び出し。戻り値: { status, data } | { status, error }
async function callModel(model, apiKey, prompt, maxOutputTokens, temperature) {
  const request = (generationConfig) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
    }
  );

  // 1回目: thinkingBudget:0 で内部思考を無効化(対応モデルは出力が思考に消費されず本文が埋まる)。
  let res = await request({ temperature, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } });
  // 一部の新しいモデルは thinkingBudget:0 を「無効な引数」として400を返す。
  // その場合は thinkingConfig を外して再試行(思考ぶんを見込んで出力トークンを増やす)。
  if (res.status === 400) {
    res = await request({ temperature, maxOutputTokens: Math.max(maxOutputTokens * 3, 4096) });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let reason = body;
    try {
      reason = JSON.parse(body)?.error?.message || body;
    } catch {
      /* JSONでなければそのまま */
    }
    return { status: res.status, error: describeApiError(res.status, reason) };
  }
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const finishReason = data.candidates?.[0]?.finishReason;
    return { status: 200, error: `AIの応答からJSONを取り出せませんでした${finishReason ? ` (finishReason: ${finishReason})` : ''}` };
  }
  return { status: 200, data: JSON.parse(jsonMatch[0]) };
}

// 低レベル共通呼び出し。プロンプトを投げてJSONを1つ取り出す。
// 戻り値: 成功 { data: <parsed> } / 失敗 { error: <表示用文字列> } / 未設定・オフライン null
async function callGeminiJSON(apiKey, prompt, { maxOutputTokens = 1024, temperature = 0.9 } = {}) {
  if (!apiKey || !navigator.onLine) return null;

  const order = preferredModel
    ? [preferredModel, ...MODEL_CANDIDATES.filter((m) => m !== preferredModel)]
    : MODEL_CANDIDATES;
  let last = null;
  for (const model of order) {
    try {
      const r = await callModel(model, apiKey, prompt, maxOutputTokens, temperature);
      if (r.data) { preferredModel = model; return { data: r.data }; }
      last = r.error;
      // 上限(429)・そのキーで使えない(404)は、別モデルなら通ることがあるので次を試す
      if (r.status === 429 || r.status === 404) { if (preferredModel === model) preferredModel = null; continue; }
      return { error: r.error }; // キー不正など、モデルを変えても直らないものは即返す
    } catch {
      last = 'AIに接続できませんでした（通信エラー）';
    }
  }
  return { error: last || 'AIに接続できませんでした（通信エラー）' };
}

// 送信前のプライバシー保護: テキスト内の登録選手名を「選手」に置換する。
// 出力(結果種別/方向/塁)には名前が含まれないため、逆写像は不要。
// (名鑑・スタメン・新聞は名前が本質的に必要なので適用しない)
export function maskNames(text, names = []) {
  if (!text) return text;
  let out = text;
  for (const n of [...new Set(names.filter((x) => x && x.length >= 2))].sort((a, b) => b.length - a.length)) {
    out = out.split(n).join('選手');
  }
  return out;
}

// ---------------- 音声発話の解釈(旧Anthropic版から統一。Geminiで実行) ----------------
// VoiceControlのオフラインエンジンの信頼度が低いときだけ呼ぶ。戻り値: 解釈JSON or null。
const VOICE_SYSTEM = `あなたは野球のスコアラー補助AIです。日本語の実況発話を解釈し、次のJSONだけを出力してください(説明文は禁止):
{"kind":"play"|"pitch"|"sb"|"cs"|"unknown","result":"single"|"double"|"triple"|"hr"|"out"|"bb"|"hbp"|"so"|"error"|"sacBunt"|"sacFly"|null,"outType":"ground"|"fly"|"liner"|"dp"|"ifly"|null,"direction":"P"|"C"|"1B"|"2B"|"3B"|"SS"|"LF"|"CF"|"RF"|null,"pitchType":"ball"|"strike"|"foul"|null,"confidence":0.0〜1.0}
kindの意味: play=打撃結果, pitch=1球の判定のみ, sb=盗塁成功, cs=盗塁死。判断できない場合はkind="unknown"。`;

export async function interpretUtterance(text, apiKey) {
  const r = await callGeminiJSON(apiKey, `${VOICE_SYSTEM}\n\n発話: ${text}`, { maxOutputTokens: 200, temperature: 0.2 });
  if (!r || r.error) return null; // 失敗時はオフライン結果にフォールバック
  const parsed = r.data;
  if (!parsed?.kind || parsed.kind === 'unknown') return null;
  return parsed;
}

// ---------------- その他メモ → 正式なスコア記録の候補へ変換(#5) ----------------
// situation: 現在の状況(イニング/アウト/走者/打者)の人間可読テキスト。
// 戻り値: 成功 { candidates:[{result,outType,direction,batterTo,why,confidence}] } / 失敗 { error } / 未設定null
function memoPrompt(memo, situation) {
  return `あなたは野球の公式記録員です。記録員が残した自由記述メモを、アプリのスコア記録スキーマ(JSON)に変換します。断定できない場合は候補を複数返し、必ずconfidence(0-1)とwhy(理由)を付けてください。与えられた現在状況の範囲だけで解釈し、存在しない走者を作らないこと。

# 現在の状況
${situation}

# メモ(記録員の自由記述)
${memo}

# 変換ルール
- 「弾く/はじく/後逸/トンネル/こぼす」→ error を第一候補
- 「振り逃げ」→ result:"so", batterTo:1
- 「ゲッツー/併殺/ダブルプレー」→ result:"out", outType:"dp"
- 「インフィールドフライ」→ result:"out", outType:"ifly"(一二塁・2アウト未満でのみ宣告される)
- 守備位置番号: 1投 2捕 3一 4二 5三 6遊 7左 8中 9右。方向はP/C/1B/2B/3B/SS/LF/CF/RF
- batterTo は打者の到達塁(1/2/3、4=得点、"out"=アウト)
- 曖昧なら candidates を最大3件、confidence降順で
- 出力は次のJSONのみ(前置き禁止):
{"candidates":[{"result":"single|double|triple|hr|out|bb|hbp|so|error|sacBunt|sacFly|fieldInterference|obstruction","outType":"ground|fly|liner|dp|null","direction":"P|C|1B|2B|3B|SS|LF|CF|RF|null","batterTo":"1|2|3|4|out","why":"理由","confidence":0.0}]}`;
}

export async function convertMemoToPlay({ apiKey, memo, situation }) {
  const r = await callGeminiJSON(apiKey, memoPrompt(memo, situation), { maxOutputTokens: 1024, temperature: 0.2 });
  if (!r || r.error) return r;
  if (!Array.isArray(r.data.candidates) || r.data.candidates.length === 0) {
    return { error: 'AIが変換候補を返しませんでした' };
  }
  return { candidates: r.data.candidates };
}

// 「AIスコア修正」: 記録係の自由文を、行うべき修正操作の配列に変換する。
// context: { players:[{name,number}], lineup:[{order,name,position}], atbats:[{inning,order,batter,result}] }
// 戻り値: { ops: [...] } | { error } | null(キー無し/オフライン)
export async function interpretCorrection({ apiKey, text, players = [], lineup = [], atbats = [] }) {
  const pl = players.map((p) => (p.number ? `${p.name}(#${p.number})` : p.name)).join('、');
  const lu = lineup.map((l) => `${l.order}番 ${l.name}${l.position ? `(${l.position})` : ''}`).join('、');
  // 同じ回に同じ打者が2打席立つ(打者一巡)ことがあるので、何打席目かを添えて曖昧さを消す
  const paSeen = new Map();
  const ab = atbats.map((a) => {
    const k = `${a.inning}|${a.batter}`;
    const n = (paSeen.get(k) || 0) + 1;
    paSeen.set(k, n);
    const dup = atbats.filter((x) => `${x.inning}|${x.batter}` === k).length > 1;
    return `${a.inning}回 ${a.order}番 ${a.batter}${dup ? `(${n}打席目)` : ''}: ${a.result}`;
  }).join('\n');
  const prompt = `あなたは野球のスコア記録を修正するアシスタントです。記録係の文章を読み、行うべき修正を厳密なJSONだけで出力してください(説明文は禁止)。選手は必ず下の登録名で参照します。
出力形式:
{"operations":[
 {"type":"reassign","inning":整数,"from":"元の打者(登録名)","to":"実際の打者(登録名)","ordinal":整数またはnull},
 {"type":"substitution","inning":整数,"out":"退く選手","in":"入る選手","position":"投|捕|一|二|三|遊|左|中|右|DH|null","role":"ph|pr|def","afterBatter":相手打者の打順(回の途中で交代した場合その打者の後)またはnull},
 {"type":"result","inning":整数,"batter":"打者(登録名)またはnull","nth":整数またはnull,"result":"single|double|triple|hr|out|so|bb|hbp|error|sacBunt|sacFly","direction":"P|C|1B|2B|3B|SS|LF|CF|RF|null","outType":"ground|fly|liner|dp|null","soType":"swinging|looking|null","contact":"weak|normal|hard|null","rbi":整数またはnull},
 {"type":"delete","inning":整数,"batter":"打者(登録名)","nth":整数またはnull},
 {"type":"position","player":"選手(登録名)","position":"投|捕|一|二|三|遊|左|中|右|DH"},
 {"type":"defense","inning":整数,"toInning":整数またはnull,"player":"選手(登録名)","position":"投|捕|一|二|三|遊|左|中|右|DH"}
],"questions":[{"text":"確認したいこと(日本語)","options":["答えの候補(そのまま修正文として使える一文)"]}]}
【確認(questions)】文章だけでは決めきれない点があるときは、operations に無理に入れず questions に日本語の質問を入れる。判断がつかない例: 交代なのか守備位置の変更なのか分からない/どの回か書かれていない/同姓の選手が複数いる/守備位置が書かれていない。質問は最大2件、options には答えの候補を「そのまま修正文として使える一文」で入れる(例:「6回から山城は捕手です。」)。決められる場合は questions は空配列にする。
【打球の強さ(contact)】「痛烈」「鋭い」「芯を食った」=hard、「ボテボテ」「詰まった」「ポテン」「当たり損ね」=weak、「平凡」=normal。強さに触れていない文では必ず null にする(記録済みの強さを消さないため)。outType(軌道)はヒットのときも書いてよい。
【何打席目か(nth)】打者一巡した回では同じ打者が同じ回に2打席立つ。下の打席記録で同じ回に同じ打者が複数回出てくる場合は、nth に何打席目かを必ず入れる(1打席目=1)。「1打席目は左二、2打席目は中安」のように書かれていれば、その回のその打者について result を打席の数だけ出力し、それぞれに nth を付ける。1打席しか無い打者は nth を null にする。
【三振の種類(soType)】「見逃し三振」「見三振」=looking、「空振り三振」=swinging。単に「三振」なら null。
【打席の取り消し(delete)】「◯◯の打席は取り消し/削除/無し/回ってきていない」のように、記録されている打席そのものを消す指示があるときだけ delete を出力する。書かれていない打席を推測で消してはいけない(「1打席目は△△です」とだけ書かれていても、2打席目を消してはならない)。delete は operations の1つとして出力できるので、questions で「対応していない」と返してはいけない。
規則: reassign=ある回の打者が実は別選手だった時の付け替え。substitution=交代の記録(role: ph=代打, pr=代走, def=守備交代や投手交代)。result=打席結果の訂正(方向directionは打球方向)。
position=先発(スタメン)の守備位置そのものの登録ミスの訂正。「◯◯の先発守備位置が△△になっているが正しくは□□」のように回を伴わず、交代ではなく最初から誤って登録されていた場合に使う(positionには訂正後の正しい位置を入れる)。
defense=その回からの守備位置の申告。「3〜6回はキャッチャーは山城だけです」のように回に幅がある場合は inning=3, toInning=6 のように範囲で出力する(1回だけなら toInning は null)。「7回の守備はショート茂木、サード入交、セカンド宇田川でした」のように、守備位置と選手の組が並ぶ文では、組の数だけ defense を出力する(この例なら茂木=遊、入交=三、宇田川=二 の3件)。選手の入れ替わりではなく守備位置の組み替えなので substitution にはしない。「AがBに代わって」「AからBに交代しました」のように退く選手と入る選手が書かれている場合だけ substitution を使う(この場合は打順の記録がズレていても、書かれたとおり substitution として出力する)。
「◯回は△△が投げた/登板した」のように新しい投手だけが書かれている場合も substitution(position:"投") として出力し、out はその直前の投手をあなたが特定する(不明ならnull)。
複数の交代・登板があれば全て漏れなく列挙する。該当が無ければ operations は空配列。登録名に無い選手名は使わない。回や打者は下記の記録から特定する。
【登録選手】${pl}
【現在の打順】${lu}
【自チームの打席記録】\n${ab}
【文章】${text}`;
  const r = await callGeminiJSON(apiKey, prompt, { maxOutputTokens: 1536, temperature: 0.15 });
  if (!r || r.error) return r;
  return {
    ops: Array.isArray(r.data?.operations) ? r.data.operations : [],
    questions: Array.isArray(r.data?.questions) ? r.data.questions : [],
  };
}

// APIキーが無い/オフライン時の簡易フォールバック(キーワード規則)。1件の候補を返す。
export function guessPlayFromMemo(memo) {
  const t = (memo || '').toLowerCase();
  const has = (...ws) => ws.some((w) => memo.includes(w) || t.includes(w));
  let result = null, outType = null, batterTo = 'out', intentional = false, why = 'キーワードからの簡易推定';
  if (has('弾', 'はじ', '後逸', 'トンネル', 'こぼ', 'エラー', '悪送球')) { result = 'error'; batterTo = 1; }
  else if (has('ゲッツー', '併殺', 'ダブルプレー', 'ゲツ')) { result = 'out'; outType = 'dp'; }
  else if (has('振り逃げ')) { result = 'so'; batterTo = 1; }
  else if (has('三振', 'さんしん')) { result = 'so'; }
  else if (has('ホームラン', '本塁打', 'ホーマー')) { result = 'hr'; batterTo = 4; }
  else if (has('タイムリー', 'ヒット', '安打', 'シングル')) { result = 'single'; batterTo = 1; }
  else if (has('二塁打', 'ツーベース')) { result = 'double'; batterTo = 2; }
  else if (has('敬遠', '故意四球')) { result = 'bb'; batterTo = 1; intentional = true; }
  else if (has('四球', 'フォアボール', 'フォア')) { result = 'bb'; batterTo = 1; }
  else if (has('死球', 'デッドボール')) { result = 'hbp'; batterTo = 1; }
  else if (has('犠', 'バント', 'スクイズ')) { result = 'sacBunt'; }
  else if (has('走塁妨害', 'オブストラクション')) { result = 'obstruction'; batterTo = 1; }
  else if (has('守備妨害', '打撃妨害')) { result = 'fieldInterference'; }
  else if (has('凡打', 'ゴロ', 'フライ', 'アウト')) { result = 'out'; outType = has('フライ') ? 'fly' : 'ground'; }
  if (!result) return null;
  const dir = (() => {
    const m = { 投: 'P', ピッチャー: 'P', 捕: 'C', キャッチャー: 'C', 一塁: '1B', ファースト: '1B', 二塁: '2B', セカンド: '2B', 三塁: '3B', サード: '3B', 遊: 'SS', ショート: 'SS', 左: 'LF', レフト: 'LF', 中: 'CF', センター: 'CF', 右: 'RF', ライト: 'RF' };
    for (const [k, v] of Object.entries(m)) if (memo.includes(k)) return v;
    return null;
  })();
  return { result, outType, direction: dir, batterTo, intentional, why, confidence: 0.4 };
}

// ---------------- AI選手名鑑(AIコーチコメント) ----------------
// uniqueFacts: チーム内タイトル・レートスタッツ首位など、この選手だけが持つ数字上の裏付け
// (stats.jsのteamHighlights()で算出。あれば「他の選手にはない強み」として具体的に触れさせる)
// recentSummary: 直近数試合だけの成績サマリー(stats.jsのrecentGames()で抽出)。
// 今季通算と見比べて「今の調子」を具体的に踏まえた伸びしろ分析・アドバイスに使う。
function scoutPrompt({ name, number, tags, statsSummary, uniqueFacts = [], recentSummary = '' }) {
  const plus = tags.filter((t) => t.type === 'plus').map((t) => t.label);
  const minus = tags.filter((t) => t.type === 'minus').map((t) => t.label);
  const joke = tags.filter((t) => t.type === 'joke').map((t) => t.label);
  return `あなたはAIコーチです。選手一人ひとりの長所を見抜き、伸びしろを前向きに引き出す、部員から慕われる人格者のベテランコーチとして、以下の選手情報からコメントを作成してください。

選手名: ${name}${number ? ` #${number}` : ''}
今季通算成績: ${statsSummary || 'まだ実戦データなし'}
直近数試合の成績: ${recentSummary || 'データなし'}
チーム内での特筆データ(他の選手と比較した客観的な裏付け): ${uniqueFacts.join('、') || 'なし'}
長所タグ: ${plus.join('、') || 'なし'}
伸びしろタグ: ${minus.join('、') || 'なし'}
個性・チーム貢献タグ: ${joke.join('、') || 'なし'}

条件:
- 文体は「です・ます調」で統一する。親しみやすく丁寧な、人格者コーチらしい落ち着いた言葉遣いにする
- catchphraseは12文字程度の短いキャッチコピー(長所を活かした前向きなもの)
- reportは100〜150文字程度。「チーム内での特筆データ」があれば、その中から最も際立つもの(複数あれば同率よりも単独首位を優先)を具体的な数字とともに「他の選手にはない独自の強み」として一番に取り上げる(無ければ今季成績の数字や長所タグから一番の武器を1つ選んで具体的に褒める)。伸びしろタグがあれば、今季通算成績と直近数試合の成績を見比べて具体的な傾向(好調が続いている/やや停滞気味など)を踏まえ、欠点の指摘ではなく「ここを意識すればもっと伸びる」という具体的なアドバイスとして1つだけ前向きに触れる(データがない場合は言及を省略してよい)
- 個性・チーム貢献タグについては、タグが実際にある場合のみそのタグの内容に直接紐づけて触れる。タグが「なし」の場合はキャラクターについて無理に言及しない(裏付けのない一般論は書かない)
- nextGameTipは30〜50文字程度。直近数試合の調子を踏まえて、次の試合で意識すると良い具体的なワンポイントアドバイス
- practiceTipは30〜50文字程度。伸びしろタグや今季通算成績を踏まえて、普段の練習で意識すると良い基本に忠実なアドバイス
- 皮肉・辛口・ダメ出しのニュアンスは一切禁止。常に応援口調で、選手の可能性を信じるコーチの温かい言葉遣いにする
- 出力は次のJSON形式のみ。説明文や前置きは一切禁止:
{"catchphrase":"...","report":"...","nextGameTip":"...","practiceTip":"..."}`;
}

// 戻り値: 成功 { catchphrase, report, nextGameTip, practiceTip } / 失敗 { error } / 未設定・オフライン null
export async function generateScoutReport({ apiKey, name, number, tags, statsSummary, uniqueFacts = [], recentSummary = '' }) {
  const r = await callGeminiJSON(apiKey, scoutPrompt({ name, number, tags, statsSummary, uniqueFacts, recentSummary }));
  if (!r || r.error) return r;
  if (!r.data.report) return { error: 'AIの応答にreportが含まれていません' };
  return {
    catchphrase: r.data.catchphrase || '',
    report: r.data.report,
    nextGameTip: r.data.nextGameTip || '',
    practiceTip: r.data.practiceTip || '',
  };
}

// ---------------- AIヘッドコーチ(スタメン提案) ----------------
// players: [{ name, statsLine }] 候補選手。statsLineは「打率.320 出塁率.400 OPS.850 打点5」等。
// dh=true: DH制(打順9人=守備8+DH1、別に打順外の投手1人、合計10人)
// dh=false: DHなし(打順9人=投手含む全員守備)
function lineupPrompt(players, dh, edition) {
  // 守備位置を渡さないと、AIは誰がどこを守れるか知らないまま9枠を埋めることになる。
  // 主(いつもの位置)と可(任せられる位置)を分けて渡し、主を優先させる。
  const list = players.map((p) => {
    const pos = p.mainPos
      ? `メイン:${p.mainPos}${p.subPos && p.subPos.length ? ` サブ:${p.subPos.join('')}` : ''}`
      : (p.subPos && p.subPos.length ? `サブ:${p.subPos.join('')}` : '守備位置の登録なし');
    return `- ${p.name}（${pos}／${p.statsLine || '成績データ少'}）`;
  }).join('\n');
  const posRule = `
守備位置の決め方（最優先の条件）:
- 各選手には【メイン】(いつもの守備位置)と【サブ】(任せられる位置)が付いています。
- 原則として【メイン】の位置に置いてください。
- 【メイン】だけでは9つの守備位置が埋まらない場合に限り、その位置を【サブ】に持つ選手を回してください。
- 【サブ】は書かれている順に優先度が高いものとします。同じ位置を複数の選手が【サブ】に持つときは、その位置をより先に書いている選手を使ってください。
- 【メイン】にも【サブ】にも無い位置には、絶対に置かないでください。
- 誰も守れない位置が残る場合は、その位置を無理に埋めず、unfilled にその位置を入れてください。
- 「守備位置の登録なし」の選手は、守備につけず DH か控えに回してください。`;
  if (dh) {
    return `あなたは${editionForPrompt(edition)}のチームの名将ヘッドコーチです。以下の候補選手の今季成績をもとに、最も得点が期待できるスタメンを提案してください。DH制です。

候補選手（今季成績）:
${list}

${posRule}

条件:
- 打順(lineup)はちょうど9人。守備位置は「捕 一 二 三 遊 左 中 右」を各1つずつ割り当て、残り1人をDHにする（8守備+DH=9人。各ポジション重複禁止）。投手は打順に入れない。
- 別途、打順に入らない投手(pitcher)を1人選ぶ（打席に立たない）。合計10人。
- 候補が11人以上いる場合は、成績を見て使う10人を選抜する（全員を入れない）。
- nameは候補選手名を一字一句そのまま使う（余計な装飾なし）。
- 各打者に position（捕一二三遊左中右DHのいずれか）と reason（30字程度の起用理由）を付ける。
- 各打者に fit を付ける。その位置が【メイン】なら "main"、【サブ】なら "sub"、DHなら "dh"。
- 出塁率の高い打者を上位、長打力を3〜5番等のセオリーを踏まえる。
- strategy に全体の狙いを80字程度で。
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"lineup":[{"name":"...","position":"...","fit":"main|sub|dh","reason":"..."}],"pitcher":{"name":"...","reason":"..."},"unfilled":["..."],"strategy":"..."}`;
  }
  return `あなたは${editionForPrompt(edition)}のチームの名将ヘッドコーチです。以下の候補選手の今季成績をもとに、最も得点が期待できるスタメン9人を選び、打順と守備位置を提案してください。DHなしです。

候補選手（今季成績）:
${list}

${posRule}

条件:
- 打順(lineup)はちょうど9人。守備位置「投 捕 一 二 三 遊 左 中 右」を9人に各1つずつ割り当てる（重複禁止。投手も打席に立つ）。
- 候補が10人以上いる場合は、成績を見て9人を選抜する（全員を入れない）。
- nameは候補選手名を一字一句そのまま使う（余計な装飾なし）。
- 各選手に position（投捕一二三遊左中右のいずれか）と reason（30字程度の起用理由）を付ける。
- 各選手に fit を付ける。その位置が【メイン】なら "main"、【サブ】なら "sub"。
- 出塁率の高い打者を上位、長打力を3〜5番等のセオリーを踏まえる。
- strategy に全体の狙いを80字程度で。
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"lineup":[{"name":"...","position":"...","fit":"main|sub","reason":"..."}],"unfilled":["..."],"strategy":"..."}`;
}

// 戻り値: 成功 { lineup:[{name,position,reason}], pitcher(DH時のみ){name,reason}, strategy } / 失敗 { error } / 未設定・オフライン null
export async function generateLineup({ apiKey, players, dh = false, edition }) {
  const r = await callGeminiJSON(apiKey, lineupPrompt(players, dh, edition), { maxOutputTokens: 2048, temperature: 0.7 });
  if (!r || r.error) return r;
  if (!Array.isArray(r.data.lineup) || r.data.lineup.length === 0) {
    return { error: 'AIの応答にlineupが含まれていません' };
  }
  return {
    lineup: r.data.lineup,
    pitcher: dh ? r.data.pitcher || null : null,
    // 誰も守れなかった位置。黙って埋めさせるより、埋まらなかったと言わせる
    unfilled: Array.isArray(r.data.unfilled) ? r.data.unfilled : [],
    strategy: r.data.strategy || '',
  };
}

// ---------------- AIスポーツ新聞(試合記事) ----------------
// この試合が何の野球なのかを、必ず渡して書かせる。
// 以前は「草野球の試合ですが」と直書きしていたので、ブカツで大会を甲子園に
// してあっても「草野球頂上決戦」「草野球の神も苦笑い」と書かれていた。
export function editionForPrompt(edition) {
  if (edition === 'ブカツ(中高大)') return '中学・高校・大学の部活動の野球';
  if (edition === '少年野球') return '少年野球(小学生)';
  return '草野球(社会人の趣味の野球)';
}

// summary: 試合結果を人間可読テキストにまとめたもの(スコア・MVP・好投・見どころ等)
export function newspaperPrompt(summary, { edition, season } = {}) {
  return `あなたはスポーツ新聞のベテラン記者です。以下の試合結果から、臨場感あふれるスポーツ新聞の記事を書いてください。プロ野球の一面記事のように熱く、少しユーモアも交えて。

この試合の位置づけ（ここに書いてあることだけを使うこと）:
- 種別: ${editionForPrompt(edition)}
- 大会: ${season || '（大会名の指定なし。大会には触れないこと）'}

${summary}

条件:
- headline: 力強い大見出し（20字以内、新聞一面風）
- subhead: 小見出し（30字程度）
- body: 本文（150〜250字、試合展開・主役の活躍・投手に触れる新聞記事調）
- comment: 一言講評（40字程度、愛のあるユーモアを添えて）
- 種別と大会名は上に書いてあるものだけを使う。「草野球」「高校野球」などを勝手に決めない
- 大会の段階（決勝・準決勝・◯回戦）は、大会名に含まれていない限り書かない
- 上の試合結果に書かれていないこと（捕逸か暴投かの別、球場、天候、観客数、選手の心情)は事実として書かない
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"headline":"...","subhead":"...","body":"...","comment":"..."}`;
}

// 戻り値: 成功 { headline, subhead, body, comment } / 失敗 { error } / 未設定・オフライン null
export async function generateNewspaper({ apiKey, summary, edition, season }) {
  const r = await callGeminiJSON(apiKey, newspaperPrompt(summary, { edition, season }), { maxOutputTokens: 2048, temperature: 0.95 });
  if (!r || r.error) return r;
  if (!r.data.headline || !r.data.body) return { error: 'AIの応答に記事本文が含まれていません' };
  return {
    headline: r.data.headline,
    subhead: r.data.subhead || '',
    body: r.data.body,
    comment: r.data.comment || '',
  };
}

// ---------------- CSV取り込みのAI補完(メモ・線スコアの整合性から空欄を埋める) ----------------
// batters/pitchers は lib/importCsv.js の parseGameCsv() が返す構造(memoフィールド含む)をそのまま渡す。
function completionPrompt({ meta, linescore, batters, pitchers }) {
  const linescoreText = Object.keys(linescore || {}).length
    ? Object.entries(linescore).map(([inn, s]) => `${inn}回: 自${s.my}-相手${s.opp}`).join('、')
    : '不明';
  return `以下は野球の試合をCSVから読み取った構造化データです。値が入っていない(未入力の)項目があります。各選手の「memo」欄の具体的な記述と、線スコアとの整合性だけを手がかりに、確信を持って埋められる項目だけを補完してください。

試合情報: ${meta.myTeam || '自チーム'} vs ${meta.opponent || '相手'}（${meta.date || '日付不明'}）
試合メモ: ${meta.memo || 'なし'}
線スコア: ${linescoreText}

打者データ(JSON配列。値がない項目=未入力):
${JSON.stringify(batters)}

投手データ(JSON配列。outsRecordedはアウト数=投球回×3+端数。例: 4回2/3=14):
${JSON.stringify(pitchers)}

厳守事項:
- 出力するbatters/pitchersは入力と同じ人数・同じ順序・同じnameのみ(選手を増減しない)
- memoに具体的に書かれている事実(例:「3回に満塁弾」→本塁打1・打点4以上）だけを根拠に埋める。根拠のない平均的な数字での穴埋めや創作は禁止
- 根拠が無い項目は元の値のまま(未入力ならnull)にする。無理に全項目を埋めない
- memo欄はそのまま出力に含める(内容を変更・削除しない)
- 出力は次のJSON形式のみ。前置き・説明は一切禁止:
{"batters":[{"name":"...","...":"..."}],"pitchers":[{"name":"...","...":"..."}]}`;
}

// 戻り値: 成功 { batters, pitchers }(元の配列と同じ人数・順序) / 失敗 { error } / 未設定・オフライン null
export async function completeBoxScore({ apiKey, meta, linescore, batters, pitchers }) {
  const r = await callGeminiJSON(apiKey, completionPrompt({ meta, linescore, batters, pitchers }), { maxOutputTokens: 4096, temperature: 0.2 });
  if (!r || r.error) return r;
  if (!Array.isArray(r.data.batters) && !Array.isArray(r.data.pitchers)) {
    return { error: 'AIの応答が期待した形式ではありません' };
  }
  return { batters: r.data.batters || batters, pitchers: r.data.pitchers || pitchers };
}

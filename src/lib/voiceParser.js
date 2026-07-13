// ============================================================
// 音声実況パーサー(オフライン・ルールベースエンジン)
// 「センター前ヒット」のような定型だけでなく
// 「センター深くに抜けた単打」「サードがエラー」「際どいけどフォアボール」
// のような曖昧・ラフな発話を、同義語辞書 + 部分一致スコアリングで解釈する。
// 戻り値: 信頼度順の候補配列(上位2〜3件を確認カードに表示)
// ============================================================
import { RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES, outTypeLabel } from './model.js';

// ---- 音声認識(ASR)の定番誤変換を補正 ----
// iOS/Androidの音声認識が野球用語を一般語に誤変換するパターンを吸収する。
// (ひらがな化した後に適用)
const ASR_FIXES = [
  [/まいひっと/g, 'まえひっと'], // 「前ヒット」→「マイヒット」
  [/五郎|5郎|ごろう/g, 'ごろ'], // 「ゴロ」→「五郎/ゴロー」
  [/頃/g, 'ごろ'], // 「ゴロ」→「頃」
  [/降ろ|凝ろ/g, 'ごろ'],
  [/送信|三線|散々|散心|賛親/g, 'さんしん'], // 「三振」→「送信/三線」
  [/そうしん/g, 'さんしん'],
  [/tbs/g, 'すりーべーす'], // 「スリーベース」→「TBS」
  [/svb|3b/g, 'すりーべーす'],
  [/2b/g, 'つーべーす'],
  [/ホームrun|homerun|hr/g, 'ほーむらん'],
  [/しんげき/g, 'ゆうげき'], // 「遊撃」誤変換
  [/ほーむいん/g, 'せいかん'],
];

// ---- 正規化: 表記ゆれ吸収 ----
// カタカナ→ひらがな、全角英数→半角、長音・促音・記号のゆれを吸収
export function normalize(text) {
  if (!text) return '';
  let t = text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // カナ→かな
    .toLowerCase()
    .replace(/[、。！!？?・\s]/g, '')
    .replace(/ー+/g, 'ー');
  for (const [re, to] of ASR_FIXES) t = t.replace(re, to);
  return t;
}

// ---- 文字バイグラムのDice係数(あいまい一致) ----
function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
export function diceSimilarity(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// キーワードのマッチスコア: 完全包含 > あいまい一致
function matchScore(text, keyword) {
  const kw = normalize(keyword);
  if (!kw) return 0;
  if (text.includes(kw)) return kw.length; // 長い語ほど特異的
  // あいまい一致: 発話の部分窓とのDice係数
  let best = 0;
  const win = kw.length;
  for (let i = 0; i + win <= text.length; i++) {
    const sim = diceSimilarity(text.slice(i, i + win), kw);
    if (sim > best) best = sim;
  }
  return best >= 0.6 ? kw.length * best * 0.6 : 0;
}

// ---- 同義語辞書 ----
const DIRECTION_DICT = {
  P: ['ピッチャー', '投手', 'ピッチャ', 'マウンド'],
  C: ['キャッチャー', '捕手', 'キャッチャ'],
  '1B': ['ファースト', '一塁', 'いちるい', 'ファスト'],
  '2B': ['セカンド', '二塁', 'にるい', 'セカン'],
  '3B': ['サード', '三塁', 'さんるい'],
  SS: ['ショート', '遊撃', 'しょーと', 'ゆうげき'],
  LF: ['レフト', '左翼', 'ひだり', 'れふと'],
  CF: ['センター', '中堅', 'まんなか', 'せんたー'],
  RF: ['ライト', '右翼', 'みぎ', 'らいと'],
};

const RESULT_DICT = {
  single: ['ヒット', '単打', 'シングル', 'シングルヒット', '内野安打', 'ポテンヒット', 'テキサス', 'クリーンヒット', '抜けた', '前ヒット', 'ぬけた', 'セーフティバント', 'セーフティーバント', 'セーフティ'],
  double: ['ツーベース', '二塁打', 'ツーベースヒット', 'ダブル', 'フェンス直撃', '2ベース'],
  triple: ['スリーベース', '三塁打', 'トリプル', '3ベース'],
  hr: ['ホームラン', '本塁打', 'ホーマー', '柵越え', 'スタンドイン', '場外', 'アーチ'],
  out: ['ゴロ', 'フライ', 'ライナー', '凡打', 'ポップ', 'アウト', 'ゲッツー', '併殺', 'ダブルプレー', '正面', '刺された'],
  bb: ['フォアボール', '四球', 'フォア', '歩いた', '歩かせ', 'ボール4', 'ボールフォア', '押し出し'],
  hbp: ['デッドボール', '死球', '当てた', '当たった', 'ぶつけた'],
  so: ['三振', '空振り三振', '見逃し三振', 'サンシン', '空振った', '振り逃げ'],
  error: ['エラー', '失策', 'トンネル', '悪送球', 'お手玉', '落とした', 'ファンブル'],
  sacBunt: ['送りバント', '犠打', 'バント成功', 'バント'],
  sacFly: ['犠牲フライ', '犠飛', 'タッチアップ', '犠牲フライで生還'],
};

const OUT_TYPE_DICT = {
  ground: ['ゴロ', 'ぼてぼて', 'ボテボテ', 'ごろ'],
  fly: ['フライ', 'ポップ', '打ち上げ', 'ふらい'],
  liner: ['ライナー', '直撃', 'らいなー'],
  dp: ['ゲッツー', '併殺', 'ダブルプレー', '併殺打'],
};

const PITCH_DICT = {
  ball: ['ボール', 'ぼーる'],
  strike: ['ストライク', '見逃し', 'すとらいく'],
  foul: ['ファウル', 'ファール', 'ふぁうる'],
};

// 修飾語: 解釈のヒント
const HINT_HIT = ['抜けた', '落ちた', '間を破', 'ぬけた', 'ポテン', '深く', 'ふかく'];
const HINT_UNCERTAIN = ['際どい', 'きわどい', '微妙', 'たぶん', 'ぎりぎり', 'かな'];
const SB_WORDS = ['盗塁', 'スチール', 'すちーる'];

function scoreDict(text, dict) {
  const scores = {};
  for (const [key, words] of Object.entries(dict)) {
    let s = 0;
    for (const w of words) s = Math.max(s, matchScore(text, w));
    if (s > 0) scores[key] = s;
  }
  return scores;
}

// ---- メイン: 発話→候補配列 ----
// 戻り値: [{ kind, result, direction, outType, pitchType, base, label, confidence }]
export function parseUtterance(rawText) {
  const text = normalize(rawText);
  if (!text) return [];

  const candidates = [];
  const dirScores = scoreDict(text, DIRECTION_DICT);
  const resScores = scoreDict(text, RESULT_DICT);
  const outTypeScores = scoreDict(text, OUT_TYPE_DICT);
  const pitchScores = scoreDict(text, PITCH_DICT);

  const bestDir = topKey(dirScores);
  const uncertain = HINT_UNCERTAIN.some((w) => text.includes(normalize(w)));
  const hitHint = HINT_HIT.some((w) => text.includes(normalize(w)));

  // --- 盗塁 ---
  const sbScore = Math.max(...SB_WORDS.map((w) => matchScore(text, w)), 0);
  if (sbScore > 0) {
    candidates.push({
      kind: 'sb',
      label: '盗塁成功',
      confidence: norm(sbScore) * (text.includes('しっぱい') || text.includes('あうと') || text.includes('失敗') ? 0 : 1),
    });
    if (text.includes('あうと') || text.includes('失敗') || text.includes('しっぱい') || text.includes('死')) {
      candidates.push({ kind: 'cs', label: '盗塁死', confidence: norm(sbScore) });
    }
  }

  // --- 打撃結果 ---
  // エラーが明示されたら失策を優先(「サードがエラー」)
  const errorScore = resScores.error || 0;
  for (const [result, score] of Object.entries(resScores)) {
    let s = score;
    // ヒット系ヒント(「抜けた」等)は単打を後押し
    if (result === 'single' && hitHint) s += 1.5;
    // 「アウト」だけで方向があれば凡打
    if (result === 'out' && bestDir && !resScores.single && !resScores.error) s += 1;
    // エラー明示時は他の解釈を減点
    if (errorScore > 2 && result !== 'error') s *= 0.5;
    // 「タッチアップ」「犠牲」があれば犠飛を後押し、ただの「フライ」は凡打のまま
    if (result === 'sacFly' && (text.includes('たっちあっぷ') || text.includes('犠'))) s += 1.5;
    // 「バント」+「失敗」なら凡打側へ
    if (result === 'sacBunt' && (text.includes('失敗') || text.includes('しっぱい'))) s *= 0.3;
    // セーフティバントは犠打ではなく単打(内野安打)
    if (result === 'sacBunt' && text.includes('せーふてぃ')) s *= 0.1;
    if (result === 'single' && text.includes('せーふてぃ')) s += 2;

    if (s <= 0) continue;
    const outType = result === 'out' ? topKey(outTypeScores) || 'ground' : null;
    // 三振: 発話に「見逃し/空振り」が含まれていれば確定、なければ確認カードで選ばせる
    const soExplicit = result === 'so' && (text.includes('見逃') || text.includes('空振') || text.includes('からぶ'));
    const soType = result === 'so' ? (text.includes('見逃') ? 'looking' : 'swinging') : null;
    candidates.push({
      kind: 'play',
      result,
      direction: needsDirection(result) ? bestDir || null : null,
      outType,
      soType,
      soExplicit,
      label: result === 'so' && !soExplicit ? '三振' : playLabel(result, bestDir, outType, soType),
      confidence: norm(s) * (uncertain ? 0.75 : 1),
    });
  }

  // --- 投球(単独の「ボール」「ストライク」「ファウル」) ---
  for (const [pitchType, score] of Object.entries(pitchScores)) {
    // 「フォアボール」の「ボール」誤検出を抑制
    if (pitchType === 'ball' && (resScores.bb || 0) > 0) continue;
    if (pitchType === 'strike' && (resScores.so || 0) > score) continue;
    candidates.push({
      kind: 'pitch',
      pitchType,
      label: { ball: 'ボール', strike: 'ストライク', foul: 'ファウル' }[pitchType],
      confidence: norm(score) * (text.length <= 6 ? 1 : 0.5), // 短い発話ほど投球単独の可能性大
    });
  }

  // --- 方向だけ聞き取れた場合のフォールバック ---
  // 例:「ライトゴロ」の「ゴロ」が認識落ちして「ライト」だけになったケース。
  // その方向の代表的な結果(単打/ゴロ/フライ)を候補として提示する。
  const hasPlay = candidates.some((c) => c.kind === 'play');
  if (bestDir && !hasPlay) {
    candidates.push(
      { kind: 'play', result: 'single', direction: bestDir, outType: null, soType: null, label: playLabel('single', bestDir), confidence: 0.5 },
      { kind: 'play', result: 'out', direction: bestDir, outType: 'ground', soType: null, label: playLabel('out', bestDir, 'ground'), confidence: 0.45 },
      { kind: 'play', result: 'out', direction: bestDir, outType: 'fly', soType: null, label: playLabel('out', bestDir, 'fly'), confidence: 0.4 }
    );
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  // 重複除去して上位3件
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = `${c.kind}:${c.result || c.pitchType || ''}:${c.direction || ''}:${c.outType || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}

function topKey(scores) {
  let best = null;
  let bestV = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (v > bestV) { best = k; bestV = v; }
  }
  return best;
}

const norm = (s) => Math.min(1, s / 5);

function needsDirection(result) {
  return ['single', 'double', 'triple', 'hr', 'out', 'error', 'sacBunt', 'sacFly'].includes(result);
}

export function playLabel(result, direction, outType, soType, edition) {
  const dir = direction ? DIRECTIONS[direction] : '';
  if (result === 'out') return `${dir}${outTypeLabel(outType || 'ground', edition)}・アウト`;
  if (result === 'so') return SO_TYPES[soType || 'swinging'];
  return `${dir ? dir + ' ' : ''}${RESULTS[result]?.label || result}`;
}

// ============================================================
// 常時リスニングモード用: ウェイクワード切り出し + 操作コマンド解釈
// ============================================================

// 「ログ、〜」の枕詞を必須にすることで、周囲の歓声・実況・審判の声等への
// 誤反応を防ぐ(全ての発話に例外なく必須)。
const WAKE_WORD_VARIANTS = ['ろぐ', 'ろーぐ', 'log'];

// 発話にウェイクワードが含まれていなければ null、含まれていれば
// それ以降の本文(未正規化のまま次の解析に渡せる正規化済みテキスト)を返す。
export function stripWakeWord(rawText) {
  const n = normalize(rawText);
  for (const w of WAKE_WORD_VARIANTS) {
    if (n.startsWith(w)) return n.slice(w.length);
  }
  return null;
}

// ---- 操作コマンド辞書(ミュート・取り消し等) ----
const COMMAND_DICT = {
  mute: ['ミュート', 'みゅーと', 'マイクオフ'],
  unmute: ['ミュート解除', 'みゅーとかいじょ', 'かいじょ', 'マイクオン'],
  cancel: ['キャンセル', 'きゃんせる', '違う', 'ちがう', 'やめて'],
  undo: ['取り消し', 'とりけし', '戻して', 'もどして', 'アンドゥ'],
  confirm: ['はい', 'うん', 'おっけー', 'おっけ', '確定', 'かくてい'],
};

// テキスト(ウェイクワード除去済み)が操作コマンドに一致すればそのキーを返す
export function parseCommand(text) {
  const t = normalize(text);
  if (!t) return null;
  let best = null;
  let bestScore = 0;
  for (const [cmd, words] of Object.entries(COMMAND_DICT)) {
    for (const w of words) {
      const s = matchScore(t, w);
      if (s > bestScore) {
        bestScore = s;
        best = cmd;
      }
    }
  }
  return best;
}

// 3階層の確定方式: このプレイは画面確認が必須な「複雑なプレイ」か
// (併殺・エラー・方向不明の長打・犠打犠飛など、走者処理の解釈が割れうるもの)
export function needsComplexConfirm(cand) {
  if (cand.kind !== 'play') return false;
  if (['double', 'triple', 'hr'].includes(cand.result) && !cand.direction) return true;
  if (['sacBunt', 'sacFly'].includes(cand.result)) return true;
  if (cand.result === 'error') return true;
  if (cand.result === 'out' && cand.outType === 'dp') return true;
  return false;
}

// ---- 操作(選手交代・チェンジ)コマンド辞書 ----
// 例:「代打、田中」「投手交代、鈴木」「チェンジ」
const OPERATION_DICT = {
  ph: ['代打', 'だいだ'],
  pr: ['代走', 'だいそう'],
  pitcher: ['投手交代', 'とうしゅこうたい', '継投', 'けいとう', 'ピッチャー交代'],
  change: ['チェンジ', 'ちぇんじ', '攻守交代', 'こうしゅこうたい'],
};

// ウェイクワード除去済みテキストから、操作コマンドと選手名部分を切り出す。
// 戻り値: { op: 'ph'|'pr'|'pitcher'|'change', name: 残りテキスト } | null
// name は VoiceControl 側で登録選手名とファジー照合する。
export function parseOperation(text) {
  const t = normalize(text);
  if (!t) return null;
  let best = null;
  let bestScore = 0;
  let bestKw = '';
  for (const [op, words] of Object.entries(OPERATION_DICT)) {
    for (const w of words) {
      const nw = normalize(w);
      // 先頭一致を優先しつつ、含まれていれば拾う
      const idx = t.indexOf(nw);
      if (idx >= 0) {
        const score = nw.length + (idx === 0 ? 2 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = op;
          bestKw = nw;
        }
      }
    }
  }
  if (!best) return null;
  // 操作語より後ろの部分を選手名候補として返す(「代打田中」「代打、田中」両対応)
  const after = t.slice(t.indexOf(bestKw) + bestKw.length);
  return { op: best, name: after };
}

// 発話の選手名候補を登録選手リストにファジー照合し、最も近い選手を返す
// players: [{ id, name }]
export function matchPlayer(nameText, players) {
  const t = normalize(nameText);
  if (!t || !players?.length) return null;
  let best = null;
  let bestSim = 0;
  for (const p of players) {
    const pn = normalize(p.name);
    if (!pn) continue;
    let sim = 0;
    if (t.includes(pn) || pn.includes(t)) sim = 1;
    else sim = diceSimilarity(t, pn);
    if (sim > bestSim) {
      bestSim = sim;
      best = p;
    }
  }
  return bestSim >= 0.5 ? best : null;
}

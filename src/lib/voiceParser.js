// ============================================================
// 音声実況パーサー(オフライン・ルールベースエンジン)
// 「センター前ヒット」のような定型だけでなく
// 「センター深くに抜けた単打」「サードがエラー」「際どいけどフォアボール」
// のような曖昧・ラフな発話を、同義語辞書 + 部分一致スコアリングで解釈する。
// 戻り値: 信頼度順の候補配列(上位2〜3件を確認カードに表示)
// ============================================================
import { RESULTS, DIRECTIONS, OUT_TYPES } from './model.js';

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
  single: ['ヒット', '単打', 'シングル', 'シングルヒット', '内野安打', 'ポテンヒット', 'テキサス', 'クリーンヒット', '抜けた', '前ヒット', 'ぬけた'],
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

    if (s <= 0) continue;
    const outType = result === 'out' ? topKey(outTypeScores) || 'ground' : null;
    candidates.push({
      kind: 'play',
      result,
      direction: needsDirection(result) ? bestDir || null : null,
      outType,
      label: playLabel(result, bestDir, outType),
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

  candidates.sort((a, b) => b.confidence - a.confidence);
  // 重複除去して上位3件
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = `${c.kind}:${c.result || c.pitchType || ''}:${c.direction || ''}`;
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

export function playLabel(result, direction, outType) {
  const dir = direction ? DIRECTIONS[direction] : '';
  if (result === 'out') return `${dir}${OUT_TYPES[outType || 'ground']}・アウト`;
  return `${dir ? dir + ' ' : ''}${RESULTS[result].label}`;
}

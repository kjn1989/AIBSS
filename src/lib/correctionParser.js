// ============================================================
// 文章での打者修正パーサ(オフライン・正規表現ベース)
// リエントリーや多い交代で打者の帰属がズレたとき、文章で付け替えを指示する。
// 対応する言い回し(例):
//   「4回の第2打席は河合でなく山城です」
//   「3回の入交の打席は髙島でした」
//   「4回、山城の打席、ほんとは河合」
// 解釈結果: { inning, ordinal|null, targetName|null, newName, targetPlayerId|null, newPlayerId }
// 端末内で完結し、AIキー不要。判別できない場合は理由つきで返す。
// ============================================================

import { parseUtterance } from './voiceParser.js';

// 全角数字→半角
function toHalf(s) {
  return (s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 文(。．！？改行)に分割
function splitSentences(text) {
  return toHalf(text || '').split(/[。．.!！?？\n]+/).map((s) => s.trim()).filter(Boolean);
}

// テキスト中に現れる登録選手名を、出現位置つきで拾う(長い名前優先・内包する短名は除外)。
function findNameHits(text, players) {
  const hits = [];
  // 長い名前から走査して、短い名前が長い名前の一部に一致する誤検出を避ける
  const sorted = [...players].filter((p) => p.name && p.name.length >= 1).sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    let from = 0;
    let i;
    // 同名選手が複数いることは稀だが、同一idの複数出現は全部拾う
    while ((i = text.indexOf(p.name, from)) !== -1) {
      const span = [i, i + p.name.length];
      // 既に確定した(より長い)名前の範囲に内包されるなら採用しない
      const inside = hits.some((h) => h.span[0] <= span[0] && span[1] <= h.span[1]);
      if (!inside) hits.push({ id: p.id, name: p.name, index: i, span });
      from = i + p.name.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// 守備位置ワード(カタカナ/漢字)→コード。長い語を優先してマッチさせる。
const POSITION_WORDS = {
  ピッチャー: '投', 投手: '投', キャッチャー: '捕', 捕手: '捕',
  ファースト: '一', 一塁: '一', セカンド: '二', 二塁: '二', サード: '三', 三塁: '三',
  ショート: '遊', 遊撃: '遊', レフト: '左', 左翼: '左', センター: '中', 中堅: '中',
  ライト: '右', 右翼: '右', 指名打者: 'DH',
};
const SUB_KEYWORDS = /交代|代わっ|代わり|代え|入れ替|負傷|退場|退い|下げ|リエントリー|再出場|入っ/;

// テキスト中の守備位置ワードを出現位置つきで拾う(長い語を優先し、内包する短語は除外)。
function findPositionHits(text) {
  const hits = [];
  for (const w of Object.keys(POSITION_WORDS).sort((a, b) => b.length - a.length)) {
    let from = 0;
    let i;
    while ((i = text.indexOf(w, from)) !== -1) {
      const span = [i, i + w.length];
      if (!hits.some((h) => h.span[0] <= span[0] && span[1] <= h.span[1])) hits.push({ code: POSITION_WORDS[w], index: i, span });
      from = i + w.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// 先発(スタメン)の守備位置そのものの訂正を解釈する。
// 交代と違い「回」を伴わないのが特徴(入力時に回を要求しない)。
// 例: 「清水の先発守備位置がファーストになっていますが、正しくはライトでした」
//     →[{ playerId, playerName, position:'右' }]
// 「正しくは/本当は/ではなく」以降に現れる位置を採用し、無ければ最後に現れた位置を採る。
export function parsePositionCorrections(rawText, players = []) {
  const out = [];
  for (const seg of splitSentences(rawText)) {
    if (/\d+\s*回/.test(seg)) continue; // 回の指定があるものは交代として扱う
    if (!/守備|ポジション|先発|スタメン|守って/.test(seg)) continue;
    const hits = findNameHits(seg, players);
    if (!hits.length) continue;
    // 2人以上出てくる文は交代の可能性が高いので、位置訂正としては扱わない
    if (hits.some((h) => h.id !== hits[0].id)) continue;
    const posHits = findPositionHits(seg);
    if (!posHits.length) continue;
    const marker = seg.match(/正しく|本当|実際|ではなく|でなく/);
    const after = marker ? posHits.filter((p) => p.index > marker.index) : [];
    const list = after.length ? after : posHits;
    out.push({ playerId: hits[0].id, playerName: hits[0].name, position: list[list.length - 1].code });
  }
  return out;
}

// 守備陣形の申告を解釈する。ある回からの守備位置を、位置＋選手の組で並べた文。
// 例: 「7回の守備はショート茂木、サード入交、セカンド宇田川でした」
//     →[{inning:7, playerId:'茂木', position:'遊'}, {…'三'}, {…'二'}]
// 交代の言い回し(◯◯が△△と交代)とは別物なので、交代語を含む文は対象外にする。
// 位置が1つだけの文も、従来どおり交代の解釈に任せる(取り合いを避ける)。
export function parseDefensiveAlignment(rawText, players = []) {
  const out = [];
  for (const seg of splitSentences(rawText)) {
    if (/交代|代わ|替わ|代打|代走/.test(seg)) continue; // 交代文は parseSubstitutions の担当
    const innM = seg.match(/(\d+)\s*回/);
    if (!innM) continue;
    const inning = parseInt(innM[1], 10);
    const posHits = findPositionHits(seg);
    if (posHits.length < 2) continue; // 位置1つは交代解釈に任せる
    const nameHits = findNameHits(seg, players);
    for (const ph of posHits) {
      const next = posHits.find((x) => x.index > ph.index);
      // その位置ワードの直後(次の位置ワードより前)に現れる選手名を対応づける
      const nm = nameHits.find((n) => n.index >= ph.span[1] && (!next || n.index < next.index));
      if (nm) out.push({ inning, playerId: nm.id, playerName: nm.name, position: ph.code });
    }
  }
  return out;
}

// 文章から「交代(守備交代・代打・代走・リエントリー)」を解釈する。
// 例: 「2回にキャッチャー河合が負傷し山城と交代」「6回、髙島に代わって宇田川」
// 先に登場する選手名=退く側(out)、後の別選手=入る側(in) とみなす(確認ダイアログで是正可能)。
// 戻り値: { ok:true, inning, outId, outName, inId, inName, position, subKind } | { ok:false, reason }
export function parseSubstitution(rawText, players = []) {
  const text = toHalf(rawText || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const inningM = text.match(/(\d+)\s*回/);
  if (!inningM) return { ok: false, reason: 'noInning' };
  const inning = parseInt(inningM[1], 10);

  let position = null;
  for (const w of Object.keys(POSITION_WORDS).sort((a, b) => b.length - a.length)) {
    if (text.includes(w)) { position = POSITION_WORDS[w]; break; }
  }
  const pitcherCtx = /投げ|登板|マウンド/.test(text); // 「◯回は△△が投げた」等
  if (!position && pitcherCtx) position = '投';
  const hasSubKw = SUB_KEYWORDS.test(text) || pitcherCtx;
  if (!hasSubKw && !position) return { ok: false, reason: 'notSub' }; // 交代ではなさそう→打者付け替えへ
  // 「◯回の守備はショート茂木、サード入交、セカンド宇田川」のように守備位置が複数並ぶ文は
  // 陣形の申告(parseDefensiveAlignment の担当)。交代として読むと先頭2名を勝手に
  // out→in にしてしまうため、交代語が無ければここでは扱わない。
  if (!hasSubKw && findPositionHits(text).length >= 2) return { ok: false, reason: 'alignment' };

  // 回の途中の交代アンカー:「◯番(に四球など)を出した後に」→ その相手打者の後で交代。
  let afterOppOrder = null;
  if (/後/.test(text)) { const bm = text.match(/(\d+)\s*番/); if (bm) afterOppOrder = parseInt(bm[1], 10); }
  // 守備位置が明示なら守備交代を優先。位置指定が無いときだけ 代打/代走 を採用。
  let subKind = 'def';
  if (!position) { if (/代打/.test(text)) subKind = 'ph'; else if (/代走/.test(text)) subKind = 'pr'; }

  const hits = findNameHits(text, players);
  const distinctIn = hits.slice(1).find((h) => h.id !== hits[0]?.id) || null;
  const continued = /も\s*(投げ|登板|投球)|投げ続け/.test(text); // 「◯回も投げた」= 継続(交代ではない)
  // 投手が1人だけ:「◯回は△△が投げた」= その回から△△登板(退く側は呼び出し側が直前投手に解決)
  if (position === '投' && hits[0] && !distinctIn && !continued) {
    return { ok: true, inning, outId: null, outName: null, inId: hits[0].id, inName: hits[0].name, position: '投', subKind: 'def', afterOppOrder };
  }
  const outHit = hits[0] || null;
  const inHit = distinctIn;
  if (!outHit || !inHit) return { ok: false, reason: 'needTwoNames' };

  return { ok: true, inning, outId: outHit.id, outName: outHit.name, inId: inHit.id, inName: inHit.name, position, subKind, afterOppOrder };
}

// 1つの文章から「複数の交代」をまとめて解釈する。
// 文(。．！？改行)ごとに分割して各文を parseSubstitution にかけ、成立したものを順に返す。
// 回が省略された文は直前に成立した回を引き継ぐ。1文に複数交代を入れると取りこぼすため、
// 各交代は句点や改行で区切るのが確実(呼び出し側UIで案内)。
export function parseSubstitutions(rawText, players = []) {
  const text = toHalf(rawText || '');
  const segments = text.split(/[。．.!！?？\n]+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let lastInning = null;
  for (const seg of segments) {
    let r = parseSubstitution(seg, players);
    if (!r.ok && r.reason === 'noInning' && lastInning != null) {
      r = parseSubstitution(`${lastInning}回 ${seg}`, players); // 回の省略を直前の回で補完
    }
    if (r.ok) { out.push(r); lastInning = r.inning; }
  }
  return out;
}

// 文章を解釈する。players: [{ id, name }]
// 戻り値: { ok:true, inning, ordinal, targetName, newName, targetPlayerId, newPlayerId }
//       | { ok:false, reason }
export function parseBatterCorrection(rawText, players = []) {
  const text = toHalf(rawText || '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const inningM = text.match(/(\d+)\s*回/);
  if (!inningM) return { ok: false, reason: 'noInning' };
  const inning = parseInt(inningM[1], 10);

  const ordM = text.match(/第\s*(\d+)\s*打席/) || text.match(/(\d+)\s*打席目/);
  const ordinal = ordM ? parseInt(ordM[1], 10) : null;

  const hits = findNameHits(text, players);
  // 「新しい打者」は文末側(最後の出現)、「対象打者」はその前の別選手
  const newHit = hits[hits.length - 1] || null;
  const targetHit = hits.slice(0, -1).find((h) => h.id !== newHit?.id) || null;

  if (!newHit) return { ok: false, reason: 'noNewName' };
  if (!targetHit && !ordinal) return { ok: false, reason: 'noTarget' };

  return {
    ok: true,
    inning,
    ordinal,
    targetName: targetHit?.name || null,
    newName: newHit.name,
    targetPlayerId: targetHit?.id || null,
    newPlayerId: newHit.id,
  };
}

// 複数回にまたがる打者付け替えを解釈する。
// 例: 「清水の5回、7回の打撃は中島です」→ [{inning:5,...},{inning:7,...}]
// 各文で「打撃/打席」を含み、回番号(複数可)と2名(先=対象/後=付け替え先)を拾う。
export function parseBatterReassignments(rawText, players = []) {
  const out = [];
  for (const seg of splitSentences(rawText)) {
    if (!/打撃|打席/.test(seg)) continue;
    const innings = [...seg.matchAll(/(\d+)\s*回/g)].map((m) => parseInt(m[1], 10));
    if (!innings.length) continue;
    const hits = findNameHits(seg, players);
    const newHit = hits[hits.length - 1];
    const targetHit = hits.slice(0, -1).find((h) => h.id !== newHit?.id) || null;
    if (!newHit || (!targetHit && !/第\s*\d+\s*打席/.test(seg))) continue;
    const ordM = seg.match(/第\s*(\d+)\s*打席/);
    const ordinal = ordM ? parseInt(ordM[1], 10) : null;
    for (const inning of innings) {
      out.push({
        inning, ordinal: innings.length === 1 ? ordinal : null,
        targetId: targetHit?.id || null, targetName: targetHit?.name || null,
        newId: newHit.id, newName: newHit.name,
      });
    }
  }
  return out;
}

// 打席結果の修正を解釈する。
// 例: 「7回はセンターゴロではなく、センター犠牲フライで1点でした」
//     →[{ inning:7, patch:{ result:'sacFly', direction:'CF', rbi:1 } }]
// 「ではなく/でなく」以降を正しい結果とみなし、音声パーサで結果種別・方向を得る。
export function parseResultCorrections(rawText) {
  const out = [];
  for (const seg of splitSentences(rawText)) {
    const innM = seg.match(/(\d+)\s*回/);
    if (!innM) continue;
    if (!/でなく|ではなく|でした|です/.test(seg)) continue;
    const parts = seg.split(/でなく|ではなく/);
    const phrase = parts.length > 1 ? parts.slice(1).join('') : seg;
    const top = (parseUtterance(phrase) || []).find((c) => c.kind === 'play' && c.result);
    if (!top) continue;
    const rbiM = phrase.match(/(\d+)\s*点/);
    out.push({
      inning: parseInt(innM[1], 10),
      patch: {
        result: top.result,
        direction: top.direction || null,
        outType: top.result === 'out' ? (top.outType || 'ground') : null,
        soType: top.result === 'so' ? (top.soType || 'swinging') : null,
        ...(rbiM ? { rbi: parseInt(rbiM[1], 10) } : {}),
      },
    });
  }
  return out;
}

// 解釈結果から、対象の打席ログ(kind:'atbat')を特定する。
// game.playLogs から、その回の自軍打席を集め、対象打者名 or 打席順で1件に絞る。
// 戻り値: { ok:true, log } | { ok:false, reason, matches? }
export function findTargetAtBat(game, parsed) {
  const inn = Number(parsed.inning); // AIが文字列で返す場合に備え数値化
  const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat' && Number(l.inning) === inn);
  if (logs.length === 0) return { ok: false, reason: 'noInningPlays' };

  let candidates = logs;
  if (parsed.targetPlayerId) {
    candidates = logs.filter((l) => l.payload?.playerId === parsed.targetPlayerId);
    // 既に付け替え済み等で対象選手が居なくても、その打順(order)で1件に絞れれば救済
    if (candidates.length === 0 && parsed.targetOrder != null) {
      candidates = logs.filter((l) => l.payload?.order === parsed.targetOrder);
    }
  } else if (parsed.ordinal) {
    const one = logs[parsed.ordinal - 1];
    candidates = one ? [one] : [];
  }

  if (candidates.length === 0) return { ok: false, reason: 'notFound' };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous', matches: candidates };
  return { ok: true, log: candidates[0] };
}

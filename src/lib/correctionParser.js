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
// 打席結果を表す語。守備位置の話か打席の話かを見分けるのに使う
// (音声パーサは曖昧な文でも安打を返すため、キーワードの有無で判定する)。
const RESULT_WORDS = /安打|単打|ヒット|ゴロ|フライ|ライナー|三振|四球|死球|デッドボール|本塁打|ホームラン|二塁打|三塁打|ツーベース|スリーベース|犠飛|犠打|犠牲|エラー|失策|併殺|ゲッツー|打点|適時打|タイムリー|出塁|盗塁|振り逃げ|空振り|見逃し|凡退|バント|打席|打撃/;

// 「3-6回」「3〜6回」「3回から6回」のような回の範囲を読む。
// 単独の「6回」なら from=to=6。範囲が読めなければ null。
export function parseInningRange(seg) {
  const m = seg.match(/(\d+)\s*回?\s*(?:から|[-–—〜～~ー])\s*(\d+)\s*回/);
  if (m) {
    const from = parseInt(m[1], 10);
    const to = parseInt(m[2], 10);
    if (to > from && to - from <= 12) return { from, to };
    if (to === from) return { from, to };
  }
  const one = seg.match(/(\d+)\s*回/);
  return one ? { from: parseInt(one[1], 10), to: parseInt(one[1], 10) } : null;
}

// その文章に「この2人の交代」がはっきり書かれているか。
// AIや正規表現が守備位置の申告を交代と読み違えたときの誤適用を防ぐ判定に使う。
export function isExplicitSubText(rawText, names = []) {
  const list = names.filter(Boolean);
  if (!list.length) return false;
  for (const seg of splitSentences(rawText)) {
    if (!SUB_KEYWORDS.test(seg)) continue;
    if (list.every((n) => seg.includes(n))) return true;
  }
  return false;
}

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

// その回からの守備位置(交代ではなく、出場中の選手の位置の変更)を解釈する。
// 2つの言い回しに対応する:
//  (A) 位置＋選手の組が並ぶ陣形の申告 (選手2人以上)
//      「7回の守備はショート茂木、サード入交、セカンド宇田川でした」
//      →[{inning:7,'茂木','遊'}, {…'三'}, {…'二'}]
//  (B) 1人の守備位置変更 (選手1人)
//      「中島は6回からレフトからファーストに変更していました」→[{inning:6,'中島','一'}]
//      移動後の位置は最後に現れた位置ワードを採る(「AからBに」でもBが取れる)。
// 交代の言い回し(◯◯が△△と交代)は parseSubstitutions の担当なので対象外。
// 投手への変更も継投の記録が必要なため交代側に任せる。
export function parseDefensiveAlignment(rawText, players = []) {
  const out = [];
  for (const seg of splitSentences(rawText)) {
    if (/交代|代わ|替わ|代打|代走/.test(seg)) continue; // 交代文は parseSubstitutions の担当
    const range = parseInningRange(seg);
    if (!range) continue;
    const inning = range.from;
    const toInning = range.to;
    const posHits = findPositionHits(seg);
    if (!posHits.length) continue;
    const nameHits = findNameHits(seg, players);
    if (!nameHits.length) continue;
    const distinct = [...new Set(nameHits.map((h) => h.id))];

    if (distinct.length >= 2) {
      // (A) 位置ワードの直後(次の位置ワードより前)に現れる選手名を対応づける
      if (posHits.length < 2) continue;
      for (const ph of posHits) {
        const next = posHits.find((x) => x.index > ph.index);
        const nm = nameHits.find((n) => n.index >= ph.span[1] && (!next || n.index < next.index));
        if (nm) out.push({ inning, toInning, playerId: nm.id, playerName: nm.name, position: ph.code });
      }
    } else {
      // (B) 打席結果の記述(「レフト前ヒット」「中犠飛」等)は守備位置ではないので除く。
      //     逆に結果語が無ければ「◯回から◯◯は△△」のような素直な言い方も拾える。
      if (RESULT_WORDS.test(seg)) continue;
      const to = posHits[posHits.length - 1].code;
      if (to === '投') continue; // 投手への変更は継投の記録が要るので交代側に任せる
      out.push({ inning, toInning, playerId: nameHits[0].id, playerName: nameHits[0].name, position: to });
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

// 打席そのものを取り消す(スコアシートのマスを空欄にする)指示を解釈する。
// 例:「7回の平川の打席は空欄にしてください」「7回の8番の打席を削除」
// 打順が繰り上がって、実際には回ってこなかった打席が記録されている場合に使う。
// 「空欄/削除/取り消し」等の語を必須にして、通常の訂正と取り違えないようにする。
const DELETE_WORDS = /空欄|空白|削除|消して|消す|取り消|取消|無しに|なしに|打席なし|回ってい?ない|回らなかった/;

export function parseAtBatDeletions(rawText, players = []) {
  const out = [];
  let lastInning = null;
  for (const seg of splitSentences(rawText)) {
    const innM = seg.match(/(\d+)\s*回/);
    if (innM) lastInning = parseInt(innM[1], 10);
    const inning = lastInning;
    if (inning == null) continue;
    if (!DELETE_WORDS.test(seg)) continue;
    const hits = findNameHits(seg, players);
    const ordM = seg.match(/第\s*(\d+)\s*打席/);
    const slotM = seg.match(/(\d+)\s*番/);
    if (!hits.length && !ordM && !slotM) continue; // 誰の打席か分からないものは扱わない
    out.push({
      inning,
      playerId: hits[0]?.id || null,
      playerName: hits[0]?.name || null,
      ordinal: ordM ? parseInt(ordM[1], 10) : null,
      order: slotM ? parseInt(slotM[1], 10) : null,
    });
  }
  return out;
}

// 打順を指定した打者の訂正。
// 例:「7回の8番は奥田です」「7回、8番は奥田」→ その回のその打順の打席を奥田のものにする。
// 打順が繰り上がった(9番の選手が8番に入った)ような、名前だけでは指せない訂正に使う。
// 交代文・守備位置の申告は別のパーサーの担当なので除外する。
export function parseSlotBatters(rawText, players = []) {
  const out = [];
  let lastInning = null;
  for (const seg of splitSentences(rawText)) {
    if (/交代|代わ|替わ/.test(seg)) continue; // 交代は parseSubstitutions
    if (findPositionHits(seg).length) continue; // 守備位置の話は parseDefensiveAlignment
    const innM = seg.match(/(\d+)\s*回/);
    if (innM) lastInning = parseInt(innM[1], 10);
    const inning = lastInning;
    if (inning == null) continue;
    const ordM = seg.match(/(\d+)\s*番/);
    if (!ordM) continue;
    const order = parseInt(ordM[1], 10);
    if (!(order >= 1 && order <= 9)) continue;
    const hits = findNameHits(seg, players);
    if (!hits.length) continue;
    // 「8番は平川ではなく奥田」— 訂正マーカーがあればそれ以降の名前を優先する
    const marker = seg.match(/正しく|本当|実際|ではなく|でなく/);
    const after = marker ? hits.filter((h) => h.index > marker.index) : [];
    // 無ければ「8番は奥田」の形とみなし、打順より後ろの名前(無ければ最後の名前)を採る
    const hit = after[0] || hits.find((h) => h.index > ordM.index) || hits[hits.length - 1];
    out.push({ inning, order, playerId: hit.id, playerName: hit.name });
  }
  return out;
}

// 短縮表記(中犠飛・右飛・遊ゴ…)の先頭1文字から打球方向を取る。
// 音声パーサは「センター犠牲フライ」等の言い方が前提で、短縮表記の方向を拾えないため補う。
const DIR_CHAR = { 投: 'P', 捕: 'C', 一: '1B', 二: '2B', 三: '3B', 遊: 'SS', 左: 'LF', 中: 'CF', 右: 'RF' };
function directionFromShort(phrase) {
  // 方向の1文字＋結果語が続く形だけを見る(「中島」のような名前に引っかからないように)
  const m = phrase.match(SHORT_RESULT_RE);
  return m ? DIR_CHAR[m[1]] : null;
}

// スコアシートと同じ短縮表記(中安・中2・三飛・遊ゴ…)を打席結果として読む。
// 画面に出ている表記をそのまま打ち返せるようにするためのもの。
// 「犠飛」は「飛」より先に判定する(順序に意味がある)。
const SHORT_RESULT_RE = /([投捕一二三遊左中右])\s*(犠飛|犠打|塁打|[23２３]|安|本|飛|ゴ|直|エ|失)/;
const SHORT_RESULT_MAP = {
  安: { result: 'single' },
  本: { result: 'hr' },
  飛: { result: 'out', outType: 'fly' },
  ゴ: { result: 'out', outType: 'ground' },
  直: { result: 'out', outType: 'liner' },
  犠飛: { result: 'sacFly' },
  犠打: { result: 'sacBunt' },
  エ: { result: 'error' },
  失: { result: 'error' },
  2: { result: 'double' }, '２': { result: 'double' },
  3: { result: 'triple' }, '３': { result: 'triple' },
  塁打: { result: 'double' },
};

export function parseShortResult(phrase) {
  const m = (phrase || '').match(SHORT_RESULT_RE);
  if (!m) return null;
  const def = SHORT_RESULT_MAP[m[2]];
  if (!def) return null;
  return { ...def, direction: DIR_CHAR[m[1]] || null };
}

// 打席結果の修正を解釈する。
// 例: 「7回はセンターゴロではなく、センター犠牲フライで1点でした」
//     →[{ inning:7, patch:{ result:'sacFly', direction:'CF', rbi:1 } }]
//     「7回表の中島は中犠飛です。宇田川は四球です。」
//     →[{ inning:7, batterId:'中島', … }, { inning:7, batterId:'宇田川', … }]
// 「ではなく/でなく」以降を正しい結果とみなし、音声パーサで結果種別・方向を得る。
// 回が省略された文は直前の回を引き継ぐ。対象打者名があれば拾い、どの打席かの特定に使う。
export function parseResultCorrections(rawText, players = []) {
  const out = [];
  let lastInning = null;
  let lastBatter = null; // 「山城は3回に中2、4回に中安」のように後半で名前が省かれる形に備える
  for (const seg of splitSentences(rawText)) {
    if (!/でなく|ではなく|でした|です/.test(seg)) continue;
    const segHit = findNameHits(seg, players)[0] || null;
    if (segHit) lastBatter = segHit;

    // 「AでなくB」は文全体で1件(読点で切ると訂正前の結果まで拾ってしまう)
    const marker = /でなく|ではなく/.test(seg);
    // それ以外は「◯回に△△、□回に◇◇」を読点で分け、1文で複数の打席を直せるようにする
    const clauses = marker ? [seg] : seg.split(/[、,]/).map((c) => c.trim()).filter(Boolean);

    for (const clause of clauses) {
      const innM = clause.match(/(\d+)\s*回/);
      if (innM) lastInning = parseInt(innM[1], 10);
      const inning = lastInning;
      if (inning == null) continue;
      const parts = clause.split(/でなく|ではなく/);
      const phrase = parts.length > 1 ? parts.slice(1).join('') : clause;
      // 打席結果を表す語も短縮表記(中安・三飛…)も無い文は打撃の話ではない
      const short = parseShortResult(phrase);
      if (!RESULT_WORDS.test(phrase) && !short) continue;
      const top = (parseUtterance(phrase) || []).find((c) => c.kind === 'play' && c.result);
      if (!top && !short) continue;
      const rbiM = phrase.match(/(\d+)\s*点/);
      const hit = findNameHits(clause, players)[0] || lastBatter; // 節に名前が無ければ文の打者を継ぐ
      const result = top?.result || short.result;
      out.push({
        inning,
        batterId: hit?.id || null,
        batterName: hit?.name || null,
        patch: {
          result,
          direction: top?.direction || directionFromShort(phrase) || short?.direction || null,
          outType: result === 'out' ? (top?.outType || short?.outType || 'ground') : null,
          soType: result === 'so' ? (top?.soType || 'swinging') : null,
          ...(rbiM ? { rbi: parseInt(rbiM[1], 10) } : {}),
        },
      });
    }
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

// この試合に出ている選手IDの集合を作る。
// (同名の二重登録がある名簿から「本人」を選び直すために使う)
export function inGamePlayerIds(game) {
  return new Set([
    ...(game?.lineup || []).map((l) => l.playerId),
    ...(game?.startingLineup || []).map((l) => l.playerId),
    ...(game?.atBats || []).map((a) => a.playerId),
    ...(game?.playLogs || []).flatMap((l) => [l.payload?.playerId, l.payload?.in, l.payload?.out]),
  ].filter(Boolean));
}

// 同名で二重登録された選手を1人に畳む。この試合に出ている方を優先する。
// 出ていない方のIDを掴むと、その回の打席が見つからず修正が黙って捨てられるため。
export function preferInGamePlayers(players, inThisGame) {
  const byName = new Map();
  for (const p of players || []) {
    const cur = byName.get(p.name);
    if (!cur || (!inThisGame.has(cur.id) && inThisGame.has(p.id))) byName.set(p.name, p);
  }
  return [...byName.values()];
}

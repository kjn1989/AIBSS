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

// 全角数字→半角
function toHalf(s) {
  return (s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
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
  const hasSubKw = SUB_KEYWORDS.test(text);
  if (!hasSubKw && !position) return { ok: false, reason: 'notSub' }; // 交代ではなさそう→打者付け替えへ

  const hits = findNameHits(text, players);
  const outHit = hits[0] || null;
  const inHit = hits.slice(1).find((h) => h.id !== outHit?.id) || null;
  if (!outHit || !inHit) return { ok: false, reason: 'needTwoNames' };

  // 守備位置が明示されていれば守備交代を優先(「代打…でなく」等の否定文に引っ張られないため)。
  // 位置指定が無いときだけ 代打/代走 を採用する。
  let subKind = 'def';
  if (!position) {
    if (/代打/.test(text)) subKind = 'ph';
    else if (/代走/.test(text)) subKind = 'pr';
  }

  return { ok: true, inning, outId: outHit.id, outName: outHit.name, inId: inHit.id, inName: inHit.name, position, subKind };
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

// 解釈結果から、対象の打席ログ(kind:'atbat')を特定する。
// game.playLogs から、その回の自軍打席を集め、対象打者名 or 打席順で1件に絞る。
// 戻り値: { ok:true, log } | { ok:false, reason, matches? }
export function findTargetAtBat(game, parsed) {
  const logs = (game.playLogs || []).filter((l) => l.kind === 'atbat' && l.inning === parsed.inning);
  if (logs.length === 0) return { ok: false, reason: 'noInningPlays' };

  let candidates = logs;
  if (parsed.targetPlayerId) {
    candidates = logs.filter((l) => l.payload?.playerId === parsed.targetPlayerId);
  } else if (parsed.ordinal) {
    const one = logs[parsed.ordinal - 1];
    candidates = one ? [one] : [];
  }

  if (candidates.length === 0) return { ok: false, reason: 'notFound' };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous', matches: candidates };
  return { ok: true, log: candidates[0] };
}

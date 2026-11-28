// ============================================================
// 貼り付けた名簿(LINE などのテキスト)を、選手・打順・守備位置に読み取る。
//
//   1 入交（遊）        ①入交 ショート       1番 遊 入交
//   2 磯野（一）        2. 磯野(1B)          磯野 #12
//
// 書き方はチームごと・人ごとに揺れるので、決まった形を要求しない。
// 読めなかった部分は捨てずに名前へ残す(消すより、見て直せるほうがいい)。
// ============================================================
import { FIELD_POSITIONS } from './model.js';

// 守備位置の書き方 → アプリの位置(投捕一二三遊左中右 / DH)
const POS_WORDS = [
  ['投', ['先発投手', '先発', '投手', '投', 'ピッチャー', 'ピッチャ', 'P']],
  ['捕', ['捕手', '捕', 'キャッチャー', 'キャッチャ', 'C']],
  ['一', ['一塁手', '一塁', '一', 'ファースト', '1B']],
  ['二', ['二塁手', '二塁', '二', 'セカンド', '2B']],
  ['三', ['三塁手', '三塁', '三', 'サード', '3B']],
  ['遊', ['遊撃手', '遊撃', '遊', 'ショート', 'SS']],
  ['左', ['左翼手', '左翼', '左', 'レフト', 'LF']],
  ['中', ['中堅手', '中堅', '中', 'センター', 'CF']],
  ['右', ['右翼手', '右翼', '右', 'ライト', 'RF']],
  ['DH', ['指名打者', '指名', '指', 'DH']],
];
const POS_MAP = new Map();
for (const [pos, words] of POS_WORDS) for (const w of words) POS_MAP.set(w.toUpperCase(), pos);
// 長い書き方から先に試す(「一塁手」を「一」で切らない)
const POS_KEYS = [...POS_MAP.keys()].sort((a, b) => b.length - a.length);
// 守備番号(1=投 … 9=右)
const posByNumber = (n) => FIELD_POSITIONS[n - 1] || null;

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const toHalf = (s) => s
  .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[①-⑳]/g, (c) => `${CIRCLED.indexOf(c) + 1} `)
  .replace(/　/g, ' ');

const asPosition = (word) => {
  const w = String(word || '').trim().toUpperCase();
  if (!w) return null;
  if (POS_MAP.has(w)) return POS_MAP.get(w);
  if (/^[1-9]$/.test(w)) return posByNumber(Number(w));
  return null;
};

// 1行を読む。{ lead: 先頭の数字|null, name, position|null, number: 背番号|null }
export function parseRosterLine(raw) {
  let s = toHalf(String(raw || '')).trim();
  if (!s) return null;
  s = s.replace(/^[・\-*•>\s]+/, '');

  let lead = null;
  const m = s.match(/^(\d{1,3})\s*(?:番\s*[、,.:：．]?|[.)）:：、,．])?\s*/);
  // 数字だけの行(名前が無い)は名簿の行ではない
  let ban = false; // 「1番」と書いてあれば、先頭の数字は打順で確定
  if (m && s.length > m[0].length) { lead = Number(m[1]); ban = m[0].includes('番'); s = s.slice(m[0].length); }

  // 「1番 6大槻」「1番 DH岩崎」: 打順のあとに守備番号(1〜9)やDHが名前にくっついている
  let gluedPos = null;
  if (lead != null) {
    const g = s.match(/^([1-9])(?=[^\d\s.)）:：、,．#])/);
    if (g) { gluedPos = posByNumber(Number(g[1])); s = s.slice(1); }
  }
  const dhGlued = s.match(/^(DH|ＤＨ)(?=[^A-Za-z\s])/i);
  if (!gluedPos && dhGlued) { gluedPos = 'DH'; s = s.slice(dhGlued[0].length); }

  let number = null;
  s = s.replace(/(?:#|＃|No\.?|背番号|背番)\s*(\d{1,3})/i, (_, d) => { number = d; return ' '; });

  let position = gluedPos;
  // かっこの中。守備位置として読めたら位置、読めなければ(「主将」など)捨てる
  s = s.replace(/[（(［\[【〈<]\s*([^）)］\]】〉>]*)\s*[）)］\]】〉>]/g, (_, inner) => {
    const p = asPosition(inner);
    if (p && !position) position = p;
    return ' ';
  });
  // かっこ無し: 「遊 入交」「入交 ショート」「入交/遊」
  // 区切りに使われる記号(「黒瀬：捕」「黒瀬 - 捕」「黒瀬→捕」)。名前の中の「ー」(ジョージ)は
  // 区切りとは限らないので、前後が空白のときだけ(単独の語として)落とす
  s = s.replace(/[:：|｜→＝=]/g, ' ');
  const parts = s.split(/[\s/／、,]+/).filter((w) => w && !/^[\-–—ー−・]+$/.test(w));
  if (!position && parts.length > 1) {
    const first = asPosition(parts[0]);
    const last = asPosition(parts[parts.length - 1]);
    if (last) { position = last; parts.pop(); } else if (first) { position = first; parts.shift(); }
  }
  // 名前にくっついた片仮名の位置(「ショート入交」「入交ショート」)
  // 敬称と行末の記号(「大槻さん！」)
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/[!！。.、,]+$/, '').replace(/(さん|くん|君|選手|ちゃん)$/, '');
  let name = parts.filter(Boolean).join(' ').trim();
  if (!position && name) {
    for (const k of POS_KEYS) {
      if (k.length < 3) continue; // 1〜2文字は名前の一部と区別できない(「中島」「右田」)
      const up = name.toUpperCase();
      if (up.startsWith(k) && name.length > k.length) { position = POS_MAP.get(k); name = name.slice(k.length).trim(); break; }
      if (up.endsWith(k) && name.length > k.length) { position = POS_MAP.get(k); name = name.slice(0, -k.length).trim(); break; }
    }
  }
  if (!name || /^\d+$/.test(name)) return null; // 数字だけの行は名簿の行ではない
  return { lead, ban, name, position, number };
}

// 貼り付けた全文を読む。
//   rows: [{ name, position, number, order }]
//   pitcher: 打順の外の先発投手 { name, number } | null
//   numbersAre: 'order'(先頭の数字は打順) | 'uniform'(背番号) | 'none'
export function parseRosterText(text) {
  const seen = new Set();
  const rows = [];
  for (const line of String(text || '').split(/\r?\n|[;；]/)) {
    const r = parseRosterLine(line);
    if (!r) continue;
    const key = r.name.replace(/\s+/g, '');
    if (seen.has(key)) continue; // 同じ名前の2行目は捨てる
    seen.add(key);
    rows.push(r);
  }
  // 打順の行(先頭に数字)のあとの「投手 藤田」「先発：藤田」は、打順の外の先発投手(DH制)
  let pitcher = null;
  if (rows.some((r) => r.lead != null)) {
    const i = rows.findIndex((r) => r.lead == null && r.position === '投');
    if (i >= 0) { pitcher = { name: rows[i].name, number: rows[i].number || '' }; rows.splice(i, 1); }
  }
  const leads = rows.map((r) => r.lead).filter((n) => n != null);
  let numbersAre = 'none';
  if (leads.length) {
    // 1 から順に並んでいれば打順。飛んでいたり大きい数字があれば背番号
    const sequential = leads.length === rows.length && leads.every((n, i) => n === i + 1);
    const banAll = rows.every((r) => r.ban);
    numbersAre = sequential || banAll ? 'order' : 'uniform';
    // 「◯番」の並びが前後していても、打順の数字どおりに並べる
    if (banAll) rows.sort((a, b) => a.lead - b.lead);
  }
  return {
    numbersAre,
    pitcher,
    rows: rows.map((r, i) => ({
      name: r.name,
      position: r.position,
      number: r.number ?? (numbersAre === 'uniform' && r.lead != null ? String(r.lead) : ''),
      order: i + 1,
    })),
  };
}

// 打順として使うときの守備位置。書いていない人には、空いている位置を前から割り当てる。
// 同じ位置が2人に書かれていたら、後の人は空いている位置へ回す
export function lineupPositions(rows) {
  const taken = new Set();
  const out = rows.map((r) => {
    if (r.position && !taken.has(r.position)) { taken.add(r.position); return r.position; }
    return null;
  });
  const free = FIELD_POSITIONS.filter((p) => !taken.has(p));
  return out.map((p, i) => p || (i < 9 ? free.shift() : null) || '打');
}

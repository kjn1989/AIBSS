// ============================================================
// 指定フォーマットCSVからの試合取り込み(ボックススコア＋線スコア)
// OCRはAIBSS側では行わず、ユーザーがこのフォーマットに整形して渡す。
// 空欄は「不明」として0扱い(まばらなデータも許容)。
// ============================================================

// ---- テンプレートCSVの生成 ----
const BATTERS_HEADER = ['名前', '背番号', '守備位置', '打席', '打数', '安打', '二塁打', '三塁打', '本塁打', '打点', '四球', '死球', '三振', '犠打', '盗塁', '得点', 'メモ'];
const PITCHERS_HEADER = ['名前', '投球回', '失点', '自責点', '被安打', '与四球', '与死球', '奪三振', '投球数', '勝', 'セーブ', 'ホールド', 'メモ'];
const blankRow = (n) => Array(n).fill('').join(',');

// あらかじめ空行を並べておき、行を手動で追加しなくても1試合分(打者12人・投手4人)を埋められるようにする
export function buildTemplateCsv(myTeam = 'マイチーム') {
  return [
    '# AIBSS 試合取り込みテンプレート (CSV / UTF-8)',
    '# 各セクションの値を埋めて保存し、AIBSSの「CSVで試合を取り込む」からアップロードします。',
    '# 空欄は「不明」として扱われます(合計では0)。分からない列は空欄のままでOK。行は最初から多めに用意してあるので追加不要です。',
    '# 名前は既存の選手名と一致すればその選手に、なければ新規登録されます。',
    '# メモ欄に自由に書いておくと、AIBSS側で「AIによる不足項目の補完」時にヒントとして使われます',
    '# (例: "3回に山田が満塁弾" 「今井、危なげなく完投勝利」 等。スコアブック右上の備忘録欄をご活用ください)。',
    '',
    '[GAME]',
    '日付,2026-07-04',
    `自チーム,${myTeam}`,
    '相手チーム,対戦相手',
    '自チームは先攻か後攻,後攻',
    '大会・シーズン,',
    '試合メモ,',
    '',
    '[LINESCORE]  (回別得点。分かる範囲でOK。空欄可)',
    'チーム,1,2,3,4,5,6,7,8,9,10',
    '自,,,,,,,,,,',
    '相手,,,,,,,,,,',
    '',
    '[BATTERS]  (打者のボックススコア。1人1行。守備位置は 投/捕/一/二/三/遊/左/中/右/DH、' +
      'スコアブック番号(1〜9)、投手/捕手等、ピッチャー/キャッチャー等いずれの表記でもOK。メモは自由記述、AI補完のヒントに使えます)',
    BATTERS_HEADER.join(','),
    '例)山田,10,三塁,4,4,2,1,0,0,2,0,0,1,0,1,1,',
    ...Array.from({ length: 12 }, () => blankRow(BATTERS_HEADER.length)),
    '',
    '[PITCHERS]  (投手成績。分かる範囲でOK。投球回は 4.2 = 4回2/3)',
    PITCHERS_HEADER.join(','),
    '例)田中,5.0,2,1,,,,6,,1,,,',
    ...Array.from({ length: 4 }, () => blankRow(PITCHERS_HEADER.length)),
    '',
  ].join('\n');
}

// ---- CSVパース(簡易。引用符は最小対応) ----
function splitLine(line) {
  // カンマ区切り。ダブルクオート内のカンマのみ保護
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const numOrU = (v) => {
  if (v == null || String(v).trim() === '') return undefined;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const intOrU = (v) => {
  const n = numOrU(v);
  return n == null ? undefined : Math.round(n);
};
const truthy = (v) => {
  const s = String(v ?? '').trim();
  return s === '1' || s === '○' || s === '◯' || s === '〇' || /^(true|yes|y|勝|S|H)$/i.test(s);
};
// "4.2" → アウト数 14 (4回2/3)。"4" → 12。空欄 → undefined
export const ipToOuts = (v) => {
  if (v == null || String(v).trim() === '') return undefined;
  const s = String(v).trim();
  const [full, frac] = s.split('.');
  const f = parseInt(full, 10) || 0;
  const r = frac ? Math.min(2, parseInt(frac[0], 10) || 0) : 0;
  return f * 3 + r;
};

const BAT_SYN = {
  名前: 'name', 選手: 'name', 選手名: 'name', 背番号: 'number', 番号: 'number',
  守備位置: 'position', 守備: 'position', ポジション: 'position', 位置: 'position',
  打席: 'pa', 打席数: 'pa', 打数: 'ab', 安打: 'h', 単打: 'single',
  二塁打: 'double', '2塁打': 'double', 三塁打: 'triple', '3塁打': 'triple',
  本塁打: 'hr', 本: 'hr', 打点: 'rbi', 四球: 'bb', 死球: 'hbp', 三振: 'so',
  犠打: 'sacBunt', 犠飛: 'sacFly', 盗塁: 'sb', 得点: 'runs', メモ: 'memo', 備考: 'memo',
};

// 守備位置の表記ゆれを吸収: 数字(スコアブック番号1〜9)/漢字1文字/漢字フル/カタカナ いずれも受け付ける
const POSITION_SYN = {
  '1': '投', '2': '捕', '3': '一', '4': '二', '5': '三', '6': '遊', '7': '左', '8': '中', '9': '右',
  投: '投', 捕: '捕', 一: '一', 二: '二', 三: '三', 遊: '遊', 左: '左', 中: '中', 右: '右',
  投手: '投', 捕手: '捕',
  一塁: '一', 一塁手: '一', ファースト: '一',
  二塁: '二', 二塁手: '二', セカンド: '二',
  三塁: '三', 三塁手: '三', サード: '三',
  遊撃: '遊', 遊撃手: '遊', ショート: '遊',
  左翼: '左', 左翼手: '左', レフト: '左',
  中堅: '中', 中堅手: '中', センター: '中',
  右翼: '右', 右翼手: '右', ライト: '右',
  ピッチャー: '投', キャッチャー: '捕',
  DH: 'DH', 指名打者: 'DH', ディーエイチ: 'DH',
};
function normalizePosition(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return POSITION_SYN[s.toUpperCase()] || POSITION_SYN[s] || '';
}
const PIT_SYN = {
  名前: 'name', 選手: 'name', 選手名: 'name', 投球回: 'ip', 回: 'ip',
  失点: 'runs', 自責点: 'earnedRuns', 自責: 'earnedRuns', 被安打: 'hitsAllowed',
  与四球: 'walks', 与死球: 'hitByPitch', 奪三振: 'strikeouts', 投球数: 'pitches', 球数: 'pitches',
  被打数: 'abFaced', 対戦打者: 'abFaced', 勝: 'win', 勝利: 'win', セーブ: 'save', S: 'save',
  ホールド: 'hold', H: 'hold', メモ: 'memo', 備考: 'memo',
};

// ヘッダ行 → 列index→正規キー のマップ
function headerMap(cells, syn) {
  const m = {};
  cells.forEach((c, i) => {
    const key = syn[c.replace(/\s/g, '')];
    if (key) m[i] = key;
  });
  return m;
}

// メイン: CSVテキスト → 構造化データ
export function parseGameCsv(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  const sections = {}; // name -> array of split rows
  let cur = null;
  for (const raw of rawLines) {
    const line = raw.replace(/^﻿/, '');
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const sec = /^\[([^\]]+)\]/.exec(t);
    if (sec) {
      cur = sec[1].trim().toUpperCase();
      sections[cur] = [];
      continue;
    }
    if (cur) sections[cur].push(splitLine(line));
  }

  // GAME
  const meta = { date: '', myTeam: '', opponent: '', season: '', isHome: false, myScore: undefined, oppScore: undefined, memo: '' };
  for (const row of sections.GAME || []) {
    const k = (row[0] || '').replace(/\s/g, '');
    const v = (row[1] || '').trim();
    if (/日付|date/i.test(k)) meta.date = v;
    else if (/自チーム|自軍|マイ/.test(k)) meta.myTeam = v;
    else if (/相手/.test(k)) meta.opponent = v;
    else if (/先攻|後攻/.test(k)) meta.isHome = /後攻/.test(v);
    else if (/大会|シーズン|season/i.test(k)) meta.season = v;
    else if (/自得点/.test(k)) meta.myScore = intOrU(v);
    else if (/相手得点/.test(k)) meta.oppScore = intOrU(v);
    else if (/メモ|備考/.test(k)) meta.memo = v;
  }

  // LINESCORE
  // ヘッダ行(例: チーム,1,2,...,10,合計)の数字ラベルから列→回のマップを作る。
  // 「合計」等の非数値列は無視することで、合計列を余分な1回分として誤集計するのを防ぐ。
  const linescore = {}; // { inning: { my, opp } }
  const lrows = sections.LINESCORE || [];
  if (lrows.length) {
    const header = lrows[0] || [];
    const inningCols = [];
    header.forEach((cell, i) => {
      if (i === 0) return;
      const s = String(cell).trim();
      if (/^\d+$/.test(s)) inningCols.push({ idx: i, inning: parseInt(s, 10) });
    });
    let myRow = null, oppRow = null;
    for (const row of lrows.slice(1)) {
      const label = (row[0] || '').replace(/\s/g, '');
      if (/^自/.test(label)) myRow = row;
      else if (/^相手|^敵/.test(label)) oppRow = row;
    }
    if (myRow || oppRow) {
      for (const { idx, inning } of inningCols) {
        const my = intOrU(myRow?.[idx]);
        const opp = intOrU(oppRow?.[idx]);
        if (my != null || opp != null) linescore[inning] = { my: my || 0, opp: opp || 0 };
      }
    }
  }

  // BATTERS
  const batters = [];
  const brows = sections.BATTERS || [];
  if (brows.length) {
    const hmap = headerMap(brows[0], BAT_SYN);
    for (const row of brows.slice(1)) {
      const rec = {};
      row.forEach((cell, i) => { if (hmap[i]) rec[hmap[i]] = cell; });
      const name = (rec.name || '').replace(/^例\)/, '').trim();
      if (!name) continue;
      batters.push({
        name,
        number: (rec.number || '').trim(),
        position: normalizePosition(rec.position),
        pa: intOrU(rec.pa), ab: intOrU(rec.ab), h: intOrU(rec.h),
        single: intOrU(rec.single), double: intOrU(rec.double), triple: intOrU(rec.triple), hr: intOrU(rec.hr),
        rbi: intOrU(rec.rbi), bb: intOrU(rec.bb), hbp: intOrU(rec.hbp), so: intOrU(rec.so),
        sacBunt: intOrU(rec.sacBunt), sacFly: intOrU(rec.sacFly), sb: intOrU(rec.sb), runs: intOrU(rec.runs),
        memo: (rec.memo || '').trim(),
      });
    }
  }

  // PITCHERS
  const pitchers = [];
  const prows = sections.PITCHERS || [];
  if (prows.length) {
    const hmap = headerMap(prows[0], PIT_SYN);
    for (const row of prows.slice(1)) {
      const rec = {};
      row.forEach((cell, i) => { if (hmap[i]) rec[hmap[i]] = cell; });
      const name = (rec.name || '').replace(/^例\)/, '').trim();
      if (!name) continue;
      pitchers.push({
        name,
        outsRecorded: ipToOuts(rec.ip), runs: intOrU(rec.runs), earnedRuns: intOrU(rec.earnedRuns),
        hitsAllowed: intOrU(rec.hitsAllowed), walks: intOrU(rec.walks), hitByPitch: intOrU(rec.hitByPitch),
        strikeouts: intOrU(rec.strikeouts), pitches: intOrU(rec.pitches), abFaced: intOrU(rec.abFaced),
        win: truthy(rec.win), save: truthy(rec.save), hold: truthy(rec.hold),
        memo: (rec.memo || '').trim(),
      });
    }
  }

  if (!meta.opponent && batters.length === 0 && pitchers.length === 0 && Object.keys(linescore).length === 0) {
    return { ok: false, error: 'データを読み取れませんでした。テンプレート形式(セクション見出し[GAME]など)をご確認ください。' };
  }
  return { ok: true, meta, linescore, batters, pitchers };
}

// ---- AI補完結果のマージ(元データの値は絶対に上書きしない。未入力だった項目のみ埋める) ----
const BAT_NUM_KEYS = ['pa', 'ab', 'h', 'single', 'double', 'triple', 'hr', 'rbi', 'bb', 'hbp', 'so', 'sacBunt', 'sacFly', 'sb', 'runs'];
const PIT_NUM_KEYS = ['outsRecorded', 'runs', 'earnedRuns', 'hitsAllowed', 'walks', 'hitByPitch', 'strikeouts', 'pitches', 'abFaced'];
const PIT_BOOL_KEYS = ['win', 'save', 'hold'];

function mergeOne(orig, ai, numKeys, boolKeys) {
  if (!ai) return { ...orig, aiFilled: false, aiFieldCount: 0 };
  const out = { ...orig };
  let fieldCount = 0;
  for (const key of numKeys) {
    if (out[key] === undefined && ai[key] != null) {
      const n = Number(ai[key]);
      if (Number.isFinite(n)) { out[key] = Math.round(n); fieldCount++; }
    }
  }
  for (const key of boolKeys || []) {
    if (out[key] === false && ai[key] === true) { out[key] = true; fieldCount++; }
  }
  return { ...out, aiFilled: fieldCount > 0, aiFieldCount: fieldCount };
}

// 戻り値: { batters, pitchers, filledCount(補完されたフィールドの総数) }
// (batters/pitchersの各要素に aiFilled:boolean が付く)
export function mergeCompletion({ batters, pitchers }, ai) {
  const aiBatters = Array.isArray(ai?.batters) ? ai.batters : [];
  const aiPitchers = Array.isArray(ai?.pitchers) ? ai.pitchers : [];
  const mergedBatters = batters.map((b) => mergeOne(b, aiBatters.find((a) => a.name === b.name), BAT_NUM_KEYS));
  const mergedPitchers = pitchers.map((p) => mergeOne(p, aiPitchers.find((a) => a.name === p.name), PIT_NUM_KEYS, PIT_BOOL_KEYS));
  const filledCount = [...mergedBatters, ...mergedPitchers].reduce((s, r) => s + r.aiFieldCount, 0);
  return { batters: mergedBatters, pitchers: mergedPitchers, filledCount };
}

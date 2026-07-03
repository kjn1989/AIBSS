// ============================================================
// CSV出力: 全成績・全プレイログ
// - ヘッダー付き・1行1レコード(Googleスプレッドシート貼り付け対応)
// - UTF-8 BOM付き(Excel/スマホでの文字化け防止)
// - ダウンロード / 端末の共有機能(LINE等, Web Share API)
// ============================================================
import { RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES, formatIP } from './model.js';
import { aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, fmtAvg, fmt2, fmtPct } from './stats.js';

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ---- 打者成績CSV ----
export function battingCSV(games, nameOf) {
  const stats = aggregateBatting(games);
  const rows = [[
    '選手', '打席', '打数', '安打', '単打', '二塁打', '三塁打', '本塁打', '塁打',
    '打点', '得点', '盗塁', '四球', '死球', '三振', '犠打', '犠飛', '失策出塁',
    '打率', '得点圏打率', '出塁率', '長打率', 'OPS', '進塁打成功率', 'PPA', 'クラッチ打数', '初球安打率', '総投球数',
  ]];
  for (const s of Object.values(stats).sort((a, b) => b.h - a.h)) {
    const m = battingMetrics(s);
    rows.push([
      nameOf(s.playerId), s.pa, s.ab, s.h, s.single, s.double, s.triple, s.hr, s.tb,
      s.rbi, s.runs, s.sb, s.bb, s.hbp, s.so, s.sacBunt, s.sacFly, s.error,
      fmtAvg(m.ba), fmtAvg(m.risp), fmtAvg(m.obp), fmtAvg(m.slg),
      m.ops === null ? '-' : m.ops.toFixed(3), fmtPct(m.adv), fmt2(m.ppa), m.clutch, fmtPct(m.fhit), s.totalPitches,
    ]);
  }
  return toCSV(rows);
}

// ---- 投手成績CSV ----
export function pitchingCSV(games, nameOf) {
  const stats = aggregatePitching(games);
  const rows = [[
    '投手', '登板', '投球回', '投球数', '失点', '自責点', '被安打', '被打数', '与四球', '与死球', '奪三振',
    '勝利', 'セーブ', 'ホールド', '防御率(7回換算)', '被打率', 'WHIP', 'K/BB',
  ]];
  for (const s of Object.values(stats).sort((a, b) => b.outsRecorded - a.outsRecorded)) {
    const m = pitchingMetrics(s);
    rows.push([
      nameOf(s.playerId), s.games, formatIP(s.outsRecorded), s.pitches, s.runs, s.earnedRuns,
      s.hitsAllowed, s.abFaced, s.walks, s.hitByPitch, s.strikeouts, s.wins, s.saves, s.holds,
      m.era7 === null ? '-' : m.era7.toFixed(2), fmtAvg(m.oba),
      m.whip === null ? '-' : m.whip.toFixed(2), m.kbbDisplay,
    ]);
  }
  return toCSV(rows);
}

// ---- プレイログCSV ----
export function playLogCSV(games, nameOf, teamName) {
  const rows = [['日付', '対戦相手', 'イニング', '表裏', '種別', '内容', '選手']];
  for (const g of games) {
    for (const l of g.playLogs || []) {
      rows.push([
        g.date, g.opponent, l.inning, l.isTop ? '表' : '裏', l.kind, l.text,
        l.payload?.playerId ? nameOf(l.payload.playerId) : '',
      ]);
    }
  }
  return toCSV(rows);
}

// ---- 打席詳細CSV(スナップショット・投球シーケンス込み) ----
export function atBatCSV(games, nameOf) {
  const rows = [[
    '日付', '対戦相手', 'イニング', '打順', '選手', '結果', '凡打種別', '方向',
    '打点', '打席時得点', '投球数', '初球', '初球安打', '投球シーケンス',
    '開始時走者一', '開始時走者二', '開始時走者三', '開始時アウト', '開始時点差',
    '進塁打', 'クラッチ',
  ]];
  const clutchLabel = { first: '先制打', tie: '同点打', comeback: '逆転打', goahead: '勝ち越し打' };
  const pitchLabel = { ball: 'B', strike: 'S', foul: 'F', inplay: 'X' };
  for (const g of games) {
    for (const ab of g.atBats || []) {
      if (!ab.result) continue;
      const snap = ab.snapshot || {};
      rows.push([
        g.date, g.opponent, snap.inning ?? '', ab.order, nameOf(ab.playerId),
        (ab.result === 'so' && SO_TYPES[ab.soType]) || RESULTS[ab.result]?.label || ab.result,
        ab.outType ? OUT_TYPES[ab.outType] : '',
        ab.direction ? DIRECTIONS[ab.direction] : '',
        ab.rbi, ab.runsOnPlay, ab.pitchCount,
        pitchLabel[ab.firstPitch] || '', ab.firstPitchHit ? '○' : '',
        (ab.pitches || []).map((p) => pitchLabel[p.type] || '?').join(''),
        snap.runners?.[1] ? '○' : '', snap.runners?.[2] ? '○' : '', snap.runners?.[3] ? '○' : '',
        snap.outs ?? '', snap.scoreDiff ?? '',
        ab.advSuccess === true ? '成功' : ab.advSuccess === false ? '失敗' : '',
        clutchLabel[ab.clutch] || '',
      ]);
    }
  }
  return toCSV(rows);
}

// ---- ダウンロード ----
export function downloadCSV(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- 端末の共有機能(LINE等)で共有 ----
export async function shareCSV(filename, csv, title) {
  const file = new File(['﻿' + csv], filename, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return true; // ユーザーキャンセル
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text: csv.slice(0, 5000) });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return true;
    }
  }
  downloadCSV(filename, csv); // 共有非対応ブラウザはダウンロードにフォールバック
  return false;
}

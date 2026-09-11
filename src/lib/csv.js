// ============================================================
// CSV出力: 全成績・全プレイログ
// - ヘッダー付き・1行1レコード(Googleスプレッドシート貼り付け対応)
// - UTF-8 BOM付き(Excel/スマホでの文字化け防止)
// - ダウンロード / 端末の共有機能(LINE等, Web Share API)
// ============================================================
import { DIRECTIONS, OUT_TYPES, formatIP, resultLabelOf } from './model.js';
import { aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, fmtAvg, fmt2, fmtPct } from './stats.js';
import { translate } from './i18n.js';

// 見出しはキーで並べて、書き出すときにその言語へ引く。
// 画面の表(stats.col.*)は幅の都合で「H」「回」のように短くしてあるが、CSVは
// 表計算に貼ってから読むものなので、被安打と安打が同じ「H」にならないよう別に持つ。
const head = (lang, keys) => keys.map((k) => translate(lang, k));

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ---- 打者成績CSV ----
export function battingCSV(games, nameOf, lang = 'ja') {
  const stats = aggregateBatting(games);
  const rows = [head(lang, [
    'csv.player', 'csv.pa', 'csv.ab', 'csv.h', 'csv.single', 'csv.double', 'csv.triple', 'csv.hr', 'csv.tb',
    'csv.rbi', 'csv.runs', 'csv.sb', 'csv.bb', 'csv.ibb', 'csv.hbp', 'csv.so', 'csv.sacBunt', 'csv.sacFly', 'csv.error',
    'csv.ba', 'csv.risp', 'csv.obp', 'csv.slg', 'csv.ops', 'csv.adv', 'csv.ppa', 'csv.clutch', 'csv.fhit', 'csv.totalPitches',
  ])];
  for (const s of Object.values(stats).sort((a, b) => b.h - a.h)) {
    const m = battingMetrics(s);
    rows.push([
      nameOf(s.playerId), s.pa, s.ab, s.h, s.single, s.double, s.triple, s.hr, s.tb,
      s.rbi, s.runs, s.sb, s.bb, s.ibb, s.hbp, s.so, s.sacBunt, s.sacFly, s.error,
      fmtAvg(m.ba), fmtAvg(m.risp), fmtAvg(m.obp), fmtAvg(m.slg),
      m.ops === null ? '-' : m.ops.toFixed(3), fmtPct(m.adv), fmt2(m.ppa), m.clutch, fmtPct(m.fhit), s.totalPitches,
    ]);
  }
  return toCSV(rows);
}

// ---- 投手成績CSV ----
export function pitchingCSV(games, nameOf, lang = 'ja', basis = 7) {
  const stats = aggregatePitching(games);
  const rows = [[
    ...head(lang, [
      'csv.pitcher', 'csv.app', 'csv.ip', 'csv.pitches', 'csv.runs', 'csv.er', 'csv.ha', 'csv.abFaced',
      'csv.walks', 'csv.iwalks', 'csv.hbpP', 'csv.k', 'csv.wins', 'csv.saves', 'csv.holds',
    ]),
    // 防御率は何回換算かで意味が変わるので、見出しにその回数を入れる
    translate(lang, 'csv.era', { n: basis }),
    ...head(lang, ['csv.oba', 'csv.whip', 'csv.kbb']),
  ]];
  for (const s of Object.values(stats).sort((a, b) => b.outsRecorded - a.outsRecorded)) {
    const m = pitchingMetrics(s, basis, lang);
    rows.push([
      nameOf(s.playerId), s.games, formatIP(s.outsRecorded), s.pitches, s.runs, s.earnedRuns,
      s.hitsAllowed, s.abFaced, s.walks, s.intentionalWalks, s.hitByPitch, s.strikeouts, s.wins, s.saves, s.holds,
      m.era === null ? '-' : m.era.toFixed(2), fmtAvg(m.oba),
      m.whip === null ? '-' : m.whip.toFixed(2), m.kbbDisplay,
    ]);
  }
  return toCSV(rows);
}

// ---- プレイログCSV ----
export function playLogCSV(games, nameOf, teamName, lang = 'ja') {
  const rows = [head(lang, ['csv.date', 'csv.opponent', 'csv.inning', 'csv.half', 'csv.kind', 'csv.text', 'csv.player'])];
  for (const g of games) {
    for (const l of g.playLogs || []) {
      rows.push([
        g.date, g.opponent, l.inning, translate(lang, l.isTop ? 'csv.top' : 'csv.bot'), l.kind, l.text,
        l.payload?.playerId ? nameOf(l.payload.playerId) : '',
      ]);
    }
  }
  return toCSV(rows);
}

// 打球の強さ。空欄は未記録(平凡ではない)
const CONTACT_KEY = { weak: 'csv.contactWeak', normal: 'csv.contactNormal', hard: 'csv.contactHard' };

// ---- 打席詳細CSV(スナップショット・投球シーケンス込み) ----
export function atBatCSV(games, nameOf, lang = 'ja') {
  const T = (k) => translate(lang, k);
  const rows = [head(lang, [
    'csv.date', 'csv.opponent', 'csv.inning', 'csv.order', 'csv.player', 'csv.result', 'csv.outType', 'csv.direction',
    'csv.contact', 'csv.hitAngle', 'csv.hitDepth',
    'csv.rbi', 'csv.runsOnPlay', 'csv.pitchCount', 'csv.firstPitch', 'csv.firstPitchHit', 'csv.pitchSeq',
    'csv.r1', 'csv.r2', 'csv.r3', 'csv.outsAtStart', 'csv.diffAtStart',
    'csv.adv', 'csv.clutchKind',
  ])];
  const clutchKey = { first: 'csv.clutchFirst', tie: 'csv.clutchTie', comeback: 'csv.clutchComeback', goahead: 'csv.clutchGoahead' };
  const pitchLabel = { ball: 'B', strike: 'S', foul: 'F', inplay: 'X' };
  for (const g of games) {
    for (const ab of g.atBats || []) {
      if (!ab.result) continue;
      const snap = ab.snapshot || {};
      rows.push([
        g.date, g.opponent, snap.inning ?? '', ab.order, nameOf(ab.playerId),
        lang === 'en' ? translate('en', `result.${ab.result}`) : resultLabelOf(ab),
        ab.outType ? (lang === 'en' ? translate('en', `outType.${ab.outType}`) : OUT_TYPES[ab.outType]) : '',
        ab.direction ? (lang === 'en' ? translate('en', `dir.${ab.direction}`) : DIRECTIONS[ab.direction]) : '',
        // 未記録は空欄。「平凡」と書くと押していないものまで平凡になってしまう
        CONTACT_KEY[ab.contact] ? T(CONTACT_KEY[ab.contact]) : '',
        ab.hitAngle != null ? ab.hitAngle.toFixed(1) : '',
        ab.hitDepth != null ? ab.hitDepth.toFixed(3) : '',
        ab.rbi, ab.runsOnPlay, ab.pitchCount,
        pitchLabel[ab.firstPitch] || '', ab.firstPitchHit ? '○' : '',
        (ab.pitches || []).map((p) => pitchLabel[p.type] || '?').join(''),
        snap.runners?.[1] ? '○' : '', snap.runners?.[2] ? '○' : '', snap.runners?.[3] ? '○' : '',
        snap.outs ?? '', snap.scoreDiff ?? '',
        ab.advSuccess === true ? T('csv.yes') : ab.advSuccess === false ? T('csv.no') : '',
        clutchKey[ab.clutch] ? T(clutchKey[ab.clutch]) : '',
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

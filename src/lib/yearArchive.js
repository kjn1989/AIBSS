// ============================================================
// 年度アーカイブの書き出し
//
// 目的は「アプリが無くなっても読めること」。20年後に開いたときに
// どの項目が何かが分からなければ、データが残っていても意味がない。
// そのため書き出しには次を必ず同梱する:
//   - スキーマ版(schemaVersion)
//   - 項目の説明(fields)
//   - 書き出した時点の名簿(選手名や背番号の対応表)
//
// 書き出しても端末からは何も消さない。消すかどうかは利用者の判断。
// ============================================================
import { yearOfGame, labelOfYear, gradeOf, isArchived, DEFAULT_YEAR_START_MONTH } from './year.js';

export const ARCHIVE_SCHEMA_VERSION = 1;

// 20年後の自分(や他人)が読むための、項目の説明。
// アプリのコードを参照しなくても中身が分かる程度に書く。
const FIELD_DOC = {
  game: {
    id: '試合の識別子',
    date: '試合日 YYYY-MM-DD',
    year: '年度。既定は4月始まり(2026-03-20 は 2025年度)',
    season: '大会・シーズン名(年度の中の区分。任意)',
    opponent: '対戦相手のチーム名',
    isHome: '自チームが後攻なら true',
    myScore: '自チームの得点',
    oppScore: '相手の得点',
    linescore: '回ごとの得点 { 回: { my, opp } }',
    lineup: '最終的な打順 [{ order, playerId, position }]',
    startingLineup: '先発の打順',
    atBats: '自チームの打席記録',
    pitchingRecords: '自チームの投手記録',
    playLogs: '1プレイ1件の記録。kind で種類が分かる',
  },
  playLog: {
    kind: "atbat=自チームの打席 / defense=相手の打席 / sub=自チームの交代 / oppsub=相手の交代 / pitcher,opppitcher=投手交代 / run=得点 / sb=盗塁 / runner=走者イベント(盗塁死・暴投・捕逸・牽制死・ボーク) / position=守備位置の変更 / note=メモ",
    inning: 'イニング',
    isTop: '表なら true',
    text: '人間が読むための1行(表示用。集計には payload を使う)',
    'payload.result': "single=単打 double=二塁打 triple=三塁打 hr=本塁打 out=凡打 bb=四球 hbp=死球 so=三振 error=失策 sacBunt=犠打 sacFly=犠飛 ほか",
    'payload.direction': '打球方向(P,C,1B,2B,3B,SS,LF,CF,RF)',
    'payload.outType': 'ground=ゴロ fly=フライ liner=ライナー dp=併殺。2026年以降はヒットにも入る',
    'payload.contact': '打球の強さ weak=弱い normal=平凡 hard=強い。空欄は未記録(平凡ではない)',
    'payload.hitAngle': '打球の角度(度)。本塁から見て中堅=0、三塁線=-45、一塁線=+45',
    'payload.hitDepth': '打球の深さ。フェンスまでの距離を1とした比率。1を超えると柵越え',
    'payload.rbi': '打点',
    'payload.runs': 'そのプレイで入った得点',
    'payload.outsOnPlay': 'そのプレイで増えたアウト数',
    'payload.pitchCount': 'その打席の投球数',
    'payload.letter': '相手選手の記号(A〜T)。試合ごとの識別子で、試合をまたぐ意味はない',
    'payload.pitcherId': '投げていた自チーム投手のID',
  },
  player: {
    id: '選手の識別子。playLogs の playerId と対応する',
    name: '氏名',
    number: '背番号',
    throws: "投げる手 R=右 L=左",
    bats: "打つ側 R=右 L=左 S=両",
    entryYear: '入学年度。学年は「年度 − 入学年度 + 1」で求める',
    teamRole: "captain=主将 vice=副主将",
    archivedAt: '卒業・退部でアーカイブした日時(記録は残っている)',
  },
};

// 年度に属する試合を取り出す
export function gamesInYear(games, year, startMonth = DEFAULT_YEAR_START_MONTH) {
  return Object.values(games || {})
    .filter((g) => yearOfGame(g, startMonth) === year)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// その年度の要約(勝敗・得失点)。締めの完了画面と、書き出しの見出しに使う。
export function yearSummary(games, year, startMonth = DEFAULT_YEAR_START_MONTH) {
  const rows = gamesInYear(games, year, startMonth).filter((g) => g.status === 'finished');
  let win = 0; let lose = 0; let draw = 0; let rs = 0; let ra = 0;
  for (const g of rows) {
    rs += g.myScore || 0;
    ra += g.oppScore || 0;
    if ((g.myScore || 0) > (g.oppScore || 0)) win += 1;
    else if ((g.myScore || 0) < (g.oppScore || 0)) lose += 1;
    else draw += 1;
  }
  return { year, games: rows.length, win, lose, draw, rs, ra };
}

// 年度アーカイブ(JSON)。この1ファイルだけで、その年度の記録が完結する。
export function buildYearArchive(state, year) {
  const startMonth = state.settings?.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  const games = gamesInYear(state.games, year, startMonth);
  // その年度に関わった選手だけを、その時点の学年つきで残す
  const used = new Set();
  for (const g of games) {
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      for (const id of [p.playerId, p.in, p.out, p.pitcherId]) if (id) used.add(id);
    }
    for (const a of g.atBats || []) if (a.playerId) used.add(a.playerId);
    for (const l of g.lineup || []) if (l.playerId) used.add(l.playerId);
  }
  const roster = (state.players || [])
    .filter((p) => used.has(p.id))
    .map((p) => ({
      id: p.id, name: p.name, number: p.number || '',
      throws: p.throws || '', bats: p.bats || '',
      entryYear: p.entryYear ?? null,
      gradeThisYear: gradeOf(p, year), // その年度の学年(あとから計算しなくて済むよう埋めておく)
      teamRole: p.teamRole || '',
      archived: isArchived(p),
    }));

  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    app: 'AI-BASE DIAMOND',
    exportedAt: new Date().toISOString(),
    team: state.settings?.teamName || '',
    edition: state.settings?.edition || '',
    year,
    yearStartMonth: startMonth,
    yearLabel: labelOfYear(year, state.settings || {}),
    summary: yearSummary(state.games, year, startMonth),
    roster,
    games,
    // 20年後にこのファイルだけを開いても中身が分かるように、項目の説明を同梱する
    fields: FIELD_DOC,
    readme: [
      'このファイルは AI-BASE DIAMOND が書き出した1年度分の記録です。',
      'games[].playLogs が1プレイ1件の生の記録で、他はそこから作れます。',
      '相手選手は記号(A〜T)で記録されており、記号は試合ごとの識別子です。',
    '打球の位置は hitAngle(角度)と hitDepth(深さ)の極座標です。図の大きさに依存しません。',
      'games[].oppNames に名前が入っている場合、その試合での対応が分かります。',
      '項目の意味は fields を参照してください。',
    ].join('\n'),
  };
}

// ファイル名。日本語のファイル名を無視するブラウザがあるためASCIIも併記する。
export function archiveFileName(year, ext) {
  return `aibss_${year}_${ext}`;
}

// ============================================================
// 年度(シーズンの世代)
//
// 4月始まりを既定とする(設定 settings.yearStartMonth で変更可)。
// 2026-03-20 は 2025年度、2026-04-05 は 2026年度。
//
// 年度は試合の日付から導出する。保存項目を増やさないので移行が要らず、
// 過去に記録した試合にも遡って年度が付く。合宿やオープン戦で年度をまたぐ
// 場合だけ game.year に手で入れて上書きできる。
//
// 「大会/シーズン名(game.season)」とは別の軸。
//   年度 = 人の世代(誰が在籍しているか)
//   大会 = その年度の中の区分(春季大会・秋季リーグ など)
// ============================================================

export const DEFAULT_YEAR_START_MONTH = 4; // 日本の年度。設定で 1(暦年) や 9 にもできる

// エディション・学校区分ごとの、代(チームの世代)の開始月。
//
// 学校の年度は4月始まりだが、野球部の「代」はそれとは違う。
// 中学・高校は夏の大会で3年生が引退し、負けた時点で新チームが動き出す。
// 多くのチームは7月に大会を終え、8月から新チームで練習試合を始める。
//
// 8月始まりを既定にする理由:
//   7月始まり … 夏の大会そのものが新しい代に入ってしまう(大会は前の代の最後の試合)
//   9月始まり … 8月の新チームの試合が前の代に入る。甲子園へ行くチームは
//                ごく一部なので、取りこぼしはこちらの方が多い
//   8月始まり … 7月の大会=前の代 / 8月から=新チーム で大半が正しくなる
// 甲子園に出た年の8月だけ例外になるが、そこは試合ごとに game.year で上書きできる。
//
// 大学は秋のリーグ戦まで戦って年度末に卒業するので4月始まり。
// 少年野球(学童)は学年で動くので4月。草野球は代替わりが緩いので4月。
export const SEASON_START_MONTHS = [7, 8, 9, 4, 1]; // 設定で選べる開始月
export function defaultYearStartMonth(edition, schoolType) {
  if (schoolType === 'junior' || schoolType === 'high') return 8; // 夏の大会後に代が替わる
  return DEFAULT_YEAR_START_MONTH;
}

// 学年は「学校の年度」(常に4月始まり)で決まる。チームの代(中学・高校は9月始まり)
// とは別の軸なので、混ぜてはいけない。
// 混ぜると、4月に入学した1年生が9月に2年生になってしまう。
export const SCHOOL_YEAR_START_MONTH = 4;
export function schoolYearOfDate(date) { return yearOfDate(date, SCHOOL_YEAR_START_MONTH); }
export function currentSchoolYear(now = new Date()) { return currentYear(SCHOOL_YEAR_START_MONTH, now); }

// その代が終わる時点の学校年度。引退(卒業)の判定に使う。
// 9月始まりの代は翌年の夏に終わるので、学校年度は1つ進む。
//   代2025(2025年9月〜2026年8月) の終わり = 2026年8月 = 学校年度 2026
export function schoolYearAtSeasonEnd(seasonYear, startMonth = DEFAULT_YEAR_START_MONTH) {
  return (Number(startMonth) || DEFAULT_YEAR_START_MONTH) >= 7 ? seasonYear + 1 : seasonYear;
}

// その年度が「いつ終わるか」を表す月(締めの案内を出す判断に使う)
export function yearEndMonth(startMonth = DEFAULT_YEAR_START_MONTH) {
  return ((Number(startMonth) || DEFAULT_YEAR_START_MONTH) + 10) % 12 + 1;
}

// 日付文字列(YYYY-MM-DD) → 年度。startMonth が1なら暦年と一致する。
export function yearOfDate(date, startMonth = DEFAULT_YEAR_START_MONTH) {
  if (!date) return null;
  const m = String(date).match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const start = Math.min(12, Math.max(1, Number(startMonth) || DEFAULT_YEAR_START_MONTH));
  return mo >= start ? y : y - 1;
}

// 試合の年度。手入力の game.year があればそれを優先する。
export function yearOfGame(game, startMonth = DEFAULT_YEAR_START_MONTH) {
  if (game?.year != null && game.year !== '') return Number(game.year);
  return yearOfDate(game?.date, startMonth);
}

// 今日が属する年度
export function currentYear(startMonth = DEFAULT_YEAR_START_MONTH, now = new Date()) {
  const mo = now.getMonth() + 1;
  const start = Math.min(12, Math.max(1, Number(startMonth) || DEFAULT_YEAR_START_MONTH));
  return mo >= start ? now.getFullYear() : now.getFullYear() - 1;
}

// 記録のある年度の一覧(新しい順)
export function yearsInGames(games = [], startMonth = DEFAULT_YEAR_START_MONTH) {
  const set = new Set();
  for (const g of games) {
    const y = yearOfGame(g, startMonth);
    if (y != null) set.add(y);
  }
  return [...set].sort((a, b) => b - a);
}

// 選手ごとの在籍期間を、実際に出場した試合から割り出す。
// 手入力を増やさず、過去のデータにも遡って効かせるための導出。
// 戻り値: Map<playerId, { from, to, games }>
export function tenureByPlayer(games = [], startMonth = DEFAULT_YEAR_START_MONTH) {
  const map = new Map();
  for (const g of games) {
    const y = yearOfGame(g, startMonth);
    if (y == null) continue;
    // その試合に出た選手(打席・投球・交代のいずれかに現れた選手)
    const ids = new Set();
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      for (const id of [p.playerId, p.in, p.out, p.pitcherId]) if (id) ids.add(id);
    }
    for (const a of g.atBats || []) if (a.playerId) ids.add(a.playerId);
    for (const r of g.pitchingRecords || []) if (r.playerId) ids.add(r.playerId);
    for (const id of ids) {
      const cur = map.get(id);
      if (!cur) map.set(id, { from: y, to: y, games: 1 });
      else { cur.from = Math.min(cur.from, y); cur.to = Math.max(cur.to, y); cur.games += 1; }
    }
  }
  return map;
}

// 在籍期間の表示。まだ現役(アーカイブされていない)なら「2023–」。
export function tenureLabel(tenure, archived) {
  if (!tenure) return archived ? '' : '';
  if (!archived) return tenure.from === tenure.to ? `${tenure.from}–` : `${tenure.from}–`;
  return tenure.from === tenure.to ? `${tenure.from}` : `${tenure.from}–${tenure.to}`;
}

// アーカイブ済みか(卒業・退部などで名簿の前面から外れているか)
export function isArchived(player) {
  return !!player?.archivedAt;
}

// その年度に在籍していた選手か。
// 「年度」スコープでは出場した選手だけを見せ、卒業生を自動的に外すために使う。
export function playedInYear(tenureMap, playerId, year) {
  const t = tenureMap.get(playerId);
  if (!t) return false;
  return year >= t.from && year <= t.to;
}

// 年度の表示名。
// 9月始まり(中学・高校の代)は「2026年の代」と呼ぶのが実感に合う。
// 2025年9月に始まった代は、2026年の夏に引退するため。
export function yearLabel(year, lang = 'ja', startMonth = DEFAULT_YEAR_START_MONTH) {
  if (year == null) return '';
  const m = Number(startMonth) || DEFAULT_YEAR_START_MONTH;
  if (lang === 'ja') {
    if (m === 1) return `${year}年`;
    if (m >= 7) return `${year + 1}年の代`; // 夏に代が替わる区分
    return `${year}年度`;
  }
  if (m === 1) return String(year);
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

// ============================================================
// 集計スコープ(年度 / 試合 / 通算)
// 見出しの年度と集計対象がずれないよう、既定の解決をここに1つだけ置く。
// ============================================================

// 表示する年度を決める。value.year が未指定なら「今年度(記録があれば)」→「最新の年度」。
export function resolveYear(games, value, startMonth = DEFAULT_YEAR_START_MONTH) {
  if (value?.year != null) return value.year;
  const years = yearsInGames(games, startMonth);
  if (!years.length) return null;
  const now = currentYear(startMonth);
  return years.includes(now) ? now : years[0];
}

// スコープに応じた試合配列。value: { scope:'year'|'game'|'total', gameId, year, season }
export function scopedGames(state, value) {
  const all = Object.values(state.games || {});
  const startMonth = state.settings?.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  if (value.scope === 'game') {
    const g = value.gameId ? state.games[value.gameId] : null;
    return g ? [g] : [];
  }
  if (value.scope === 'year') {
    const y = resolveYear(all, value, startMonth);
    if (y == null) return all; // まだ1試合も無いときだけ全件(空表示になるより素直)
    let rows = all.filter((g) => yearOfGame(g, startMonth) === y);
    if (value.season) rows = rows.filter((g) => g.season === value.season);
    return rows;
  }
  // 通算: 大会名の指定があればそれだけに絞る(従来どおり)
  if (value.season) return all.filter((g) => g.season === value.season);
  return all;
}

// ============================================================
// 学年(ブカツ・少年野球)
//
// 学年そのものは保存しない。保存するのは入学年度(player.entryYear)で、
// 学年は見ている年度から導出する。学年を持つと毎年4月に名簿全体が
// 間違いになるが、入学年度なら一度入れたら二度と変わらない。
//   学年 = 年度 − 入学年度 + 1
// 過去の年度を見れば、そのときの学年が出る。
//
// 入力は「学年」で受け、保存時に入学年度へ変換する(人間には自然な入力、
// データには不変の値)。
// ============================================================

export const SCHOOL_TYPES = [
  { id: 'elementary', maxGrade: 6 },
  { id: 'junior', maxGrade: 3 },
  { id: 'high', maxGrade: 3 },
  { id: 'university', maxGrade: 4 },
];

// 学年を使うエディションか。草野球は使わない(欄ごと出さない)。
export function usesGrade(edition) {
  return edition === '少年野球' || edition === 'ブカツ(中高大)';
}

// エディションから学校区分の既定。ブカツは中高大が混ざるので設定で選ばせる。
export function defaultSchoolType(edition) {
  if (edition === '少年野球') return 'elementary';
  if (edition === 'ブカツ(中高大)') return 'high';
  return null;
}

export function maxGradeOf(schoolType) {
  return SCHOOL_TYPES.find((s) => s.id === schoolType)?.maxGrade ?? null;
}

// その年度の学年。入学年度が未設定なら null(「学年 未設定」として扱う)。
export function gradeOf(player, year) {
  const entry = player?.entryYear;
  if (entry == null || entry === '' || year == null) return null;
  return year - Number(entry) + 1;
}

// 「◯年」と入力された学年を、保存用の入学年度へ変換する。
export function entryYearFromGrade(grade, year) {
  if (grade == null || grade === '' || year == null) return null;
  return year - Number(grade) + 1;
}

// その代を終えたら引退(卒業)か。
// 学年は学校年度で数えるので、代の終わり時点の学校年度で判定する。
// 中学・高校なら「翌年の夏の大会を終えたときに3年生か」を見ることになる。
export function willGraduate(player, seasonYear, maxGrade, startMonth = DEFAULT_YEAR_START_MONTH) {
  const g = gradeOf(player, schoolYearAtSeasonEnd(seasonYear, startMonth));
  return g != null && maxGrade != null && g >= maxGrade;
}

// 学年順に並べる。未設定は末尾へ。同学年内は背番号順(数値優先)。
export function sortByGrade(players = [], year) {
  const key = (p) => {
    const g = gradeOf(p, year);
    return g == null ? Infinity : -g; // 上級生を先に
  };
  const num = (p) => {
    const n = parseInt(p.number, 10);
    return Number.isFinite(n) ? n : Infinity;
  };
  return [...players].sort((a, b) => key(a) - key(b) || num(a) - num(b) || (a.createdAt || 0) - (b.createdAt || 0));
}

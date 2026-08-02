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

// 年度の表示名。ja: 「2025年度」 / en: 「2025–26」(4月始まりのように年をまたぐ場合)
export function yearLabel(year, lang = 'ja', startMonth = DEFAULT_YEAR_START_MONTH) {
  if (year == null) return '';
  if (lang === 'ja') return `${year}年度`;
  return startMonth === 1 ? String(year) : `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
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

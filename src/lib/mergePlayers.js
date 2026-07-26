// ============================================================
// 同名で二重登録された選手の統合(参照の付け替え)
//
// 同じ人が2件の選手レコードに分かれていると、打順移動の検出も通算成績も分断される。
// 統合では、試合データの中に散らばる「選手ID」への参照をすべて残す側へ付け替える。
//
// 重要: 付け替えが起きた試合は updatedAt を必ず進める。クラウド同期は
// Last-Write-Wins(updatedAtの新しい方を採用)なので、これを忘れると
//   - 送信条件(updatedAt > 送信済み版)を満たさず、統合結果がアップロードされない
//   - 受信時に古いクラウド版が「同じか新しい」と判定されローカルを上書きする
// となり、アプリを開き直すと統合が元に戻ってしまう。
// ============================================================

// 試合1件ぶんの選手ID参照を mergeId → keepId に付け替える。
// game は呼び出し側でコピー済みであることを前提に破壊的に書き換える。
// 付け替えが1つでも起きたら updatedAt を now に進め、true を返す。
export function remapPlayerInGame(game, mergeId, keepId, now = Date.now()) {
  let touched = false;
  const swap = (id) => {
    if (id !== mergeId) return id;
    touched = true;
    return keepId;
  };

  for (const l of game.lineup || []) l.playerId = swap(l.playerId);
  for (const l of game.startingLineup || []) l.playerId = swap(l.playerId);
  for (const ab of game.atBats || []) ab.playerId = swap(ab.playerId);
  for (const pr of game.pitchingRecords || []) pr.playerId = swap(pr.playerId);
  for (const b of game.importedBatting || []) b.playerId = swap(b.playerId);
  for (const p of game.importedPitching || []) p.playerId = swap(p.playerId);
  game.retiredPlayerIds = [...new Set((game.retiredPlayerIds || []).map(swap))];
  game.usedPlayerIds = [...new Set((game.usedPlayerIds || []).map(swap))];
  if (game.currentPitcherId) game.currentPitcherId = swap(game.currentPitcherId);
  for (const b of [1, 2, 3]) {
    const r = game.runners?.[b];
    if (r?.playerId) r.playerId = swap(r.playerId);
  }
  for (const log of game.playLogs || []) {
    const p = log.payload;
    if (!p) continue;
    for (const key of ['playerId', 'in', 'out', 'pitcherId', 'batterId']) {
      if (p[key]) p[key] = swap(p[key]);
    }
  }

  if (touched) game.updatedAt = now; // クラウド同期に確実に載せる(上記コメント参照)
  return touched;
}

// 残す側の空欄項目を、統合する側の値で補完する(背番号だけ入っている方を活かす)。
export function fillPlayerGaps(keep, dup) {
  const filled = { ...keep };
  for (const key of ['number', 'throws', 'bats', 'position', 'memo']) {
    if (!filled[key] && dup[key]) filled[key] = dup[key];
  }
  return filled;
}

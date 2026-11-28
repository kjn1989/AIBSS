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
  game.attendees = Array.isArray(game.attendees) ? [...new Set(game.attendees.map(swap))] : game.attendees;
  // 上で名指ししていない参照(ファインプレー・失策の守備者、臨時代走の元の走者、
  // 走者の責任投手、生還の自責点の帰属…)も漏らさない。選手IDは時刻+乱数の一意な文字列なので、
  // 試合の中で同じ文字列が出てきたら、それはその選手への参照とみなして付け替える
  const walk = (v) => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (v[i] === mergeId) v[i] = swap(v[i]);
        else if (v[i] && typeof v[i] === 'object') walk(v[i]);
      }
      return;
    }
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x === mergeId) v[k] = swap(x);
      else if (x && typeof x === 'object') walk(x);
      // 選手IDを鍵にした表(選手ごとの値)。残す側の鍵がまだ無いときだけ移す
      if (k === mergeId && !(keepId in v)) { v[keepId] = v[k]; delete v[k]; touched = true; }
    }
  };
  for (const key of Object.keys(game)) {
    if (key === 'retiredPlayerIds' || key === 'usedPlayerIds' || key === 'attendees') continue;
    const x = game[key];
    if (x && typeof x === 'object') walk(x);
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

// ---- 表記ちがいの同一人物 ----
// 「髙島」と「高島」、「山﨑」と「山崎」は、入力のしかたで分かれてしまうだけで同じ名字。
// 名簿を貼り付けた人と手で入れた人で字が違うと、同じ人が2人に分かれて成績も分かれる。
// 異体字をふつうの字にそろえ、空白・全角半角の違いも無くした鍵で見比べる。
// (「斉藤」と「斎藤」、「島田」と「嶋田」のように別の名字として使われる組は寄せない。
//  そういう書きまちがいは「選手をまとめる」から手で選ぶ)
const VARIANT_CHARS = {
  '髙': '高', '﨑': '崎', '嵜': '崎', '濵': '浜', '濱': '浜', '邊': '辺', '邉': '辺',
  '齋': '斎', '齊': '斉', '德': '徳', '𠮷': '吉', '槗': '橋', '塚': '塚', '黑': '黒',
  '惠': '恵', '澤': '沢', '櫻': '桜', '廣': '広', '國': '国', '眞': '真', '藏': '蔵',
  '瀨': '瀬', '淸': '清', '靑': '青', '晴': '晴', '隆': '隆', '神': '神', '福': '福',
};
const VARIANT_RE = new RegExp(`[${Object.keys(VARIANT_CHARS).join('')}]`, 'gu');
export function nameVariantKey(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(VARIANT_RE, (c) => VARIANT_CHARS[c] || c)
    .replace(/[\s　･・.,\-]/g, '')
    .toLowerCase();
}

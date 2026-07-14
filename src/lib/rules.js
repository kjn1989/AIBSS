// ============================================================
// 大会・年代別ルールエンジン
// エディション(草野球/ブカツ/少年野球)ごとに異なる試合ルールを
// 「データ」として扱い、試合作成時に選択・調整して試合に保存する。
//
// rules = {
//   innings: 7,                      // 規定イニング数(上限)
//   mercy: [{ after: 5, diff: 7 }],  // コールド条件(after回以降にdiff点差) 複数可・空配列=なし
//   pitchLimit: { perGame: 70, warnAt: 60 } | null, // 投手の球数制限(1試合あたり)
//   timeLimitMin: 90 | null,         // 時間制限(分)。草野球で多い「90分・時間切れ後は新しい回に入らない」等
// }
//
// 方針:
// - ルールエンジンは「強制終了」しない。条件成立を検知して提案バナーを出すだけで、
//   記録の主導権は常にユーザーにある(練習試合で続行する等の自由を残す)。
// - プリセットの数値は代表的な例。連盟・大会により異なるため、必ず調整可能にする。
// - rules未設定(旧データ含む)の試合ではすべての判定が無効(null)になる。
// ============================================================

// ---- エディション別プリセット(代表例。大会要項に合わせて調整可) ----
export const RULE_PRESETS = [
  // 草野球は7回が上限で、90分等の時間制限付き(時間切れ後は新しい回に入らない→5回で終わることも多い)が主流
  {
    id: 'kusa7', label: '草野球 7回制・90分', edition: '草野球',
    rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: 90 },
  },
  {
    id: 'kusa7-120', label: '草野球 7回制・120分', edition: '草野球',
    rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: 120 },
  },
  {
    id: 'kusa7-nolimit', label: '草野球 7回制(時間無制限)', edition: '草野球',
    rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: null },
  },
  {
    // 社会人野球(企業・クラブ)の公式戦は9回制が主流。草野球エディションに含める。
    id: 'shakaijin9', label: '社会人・クラブ 9回制', edition: '草野球',
    rules: { innings: 9, mercy: [], pitchLimit: null, timeLimitMin: null },
  },
  {
    id: 'gakudo6', label: '学童(少年野球) 6回制・70球', edition: '少年野球',
    rules: { innings: 6, mercy: [{ after: 4, diff: 10 }, { after: 5, diff: 7 }], pitchLimit: { perGame: 70, warnAt: 60 }, timeLimitMin: null },
  },
  {
    id: 'chu7', label: '中学 7回制・100球', edition: 'ブカツ(中高大)',
    rules: { innings: 7, mercy: [{ after: 5, diff: 7 }], pitchLimit: { perGame: 100, warnAt: 85 }, timeLimitMin: null },
  },
  {
    id: 'koko9', label: '高校 9回制(地方大会コールド)', edition: 'ブカツ(中高大)',
    rules: { innings: 9, mercy: [{ after: 5, diff: 10 }, { after: 7, diff: 7 }], pitchLimit: null, timeLimitMin: null },
  },
  { id: 'daigaku9', label: '大学 9回制', edition: 'ブカツ(中高大)', rules: { innings: 9, mercy: [], pitchLimit: null, timeLimitMin: null } },
];

export function presetById(id) {
  return RULE_PRESETS.find((p) => p.id === id) || null;
}

export function defaultPresetIdForEdition(edition) {
  return { 草野球: 'kusa7', 少年野球: 'gakudo6', 'ブカツ(中高大)': 'chu7' }[edition] || 'kusa7';
}

// 記憶したプリセットは「同じエディションのプリセット」か「明示指定(custom/none)」の場合のみ
// 引き継ぎ、それ以外はエディションの既定に戻す。
// (例: 草野球の試合に、以前使った学童の球数制限が漏れて付くのを防ぐ)
export function initialPresetIdFor(lastId, edition) {
  if (!lastId) return defaultPresetIdForEdition(edition);
  if (lastId === 'custom' || lastId === 'none') return lastId;
  const p = presetById(lastId);
  if (p && p.edition === edition) return lastId;
  return defaultPresetIdForEdition(edition);
}

// ルール内容の1行説明(選択UI・確認表示用)
export function describeRules(rules) {
  if (!rules) return 'ルール管理なし(回数無制限・判定なし)';
  const parts = [`${rules.innings}回制`];
  if (rules.timeLimitMin) parts.push(`${rules.timeLimitMin}分時間制限`);
  for (const m of rules.mercy || []) parts.push(`${m.after}回${m.diff}点差コールド`);
  if (rules.pitchLimit?.perGame) parts.push(`球数${rules.pitchLimit.perGame}球制限`);
  return parts.join('・');
}

// ------------------------------------------------------------
// 試合終了条件の判定(純関数・描画時に呼ぶ)
// 戻り値: { type: 'regulation'|'xwin'|'mercy'|'tie', text } | null
//  - 強制はせず、ScoreTab側が提案バナーとして表示する
// ------------------------------------------------------------
export function gameEndCheck(game) {
  const rules = game.rules;
  if (!rules || game.status === 'finished') return null;
  const { innings } = rules;
  if (!innings) return null;

  const homeScore = game.isHome ? game.myScore : game.oppScore; // 後攻チームの得点
  const awayScore = game.isHome ? game.oppScore : game.myScore;
  const diff = Math.abs(game.myScore - game.oppScore);

  if (game.isTop) {
    // 表の開始時点 = 前の回の裏まで完了している
    const done = game.inning - 1; // 完了したイニング数
    if (done >= innings) {
      if (game.myScore !== game.oppScore) {
        const label = done > innings ? `延長${done}回` : `規定の${innings}回`;
        return { type: 'regulation', text: `${label}を終了しました。試合を終了できます。` };
      }
      return {
        type: 'tie',
        text: `${done}回を終了して同点です。引き分けで終了するか、延長戦を続けられます。`,
      };
    }
    // コールド判定(直前の回の終了時点)
    for (const m of rules.mercy || []) {
      if (done >= m.after && diff >= m.diff) {
        return {
          type: 'mercy',
          text: `${done}回終了時点で${diff}点差です。コールドゲームの条件(${m.after}回以降${m.diff}点差)を満たしています。`,
        };
      }
    }
  } else {
    // 裏の進行中(その回の表は完了済み)
    if (game.inning >= innings && homeScore > awayScore) {
      return {
        type: 'xwin',
        text: `後攻チームがリードしています。${game.inning}回裏は行わず(または途中で)試合を終了できます(X勝ち/サヨナラ)。`,
      };
    }
    // 後攻リードのコールドは表終了時点(=裏の間)でも判定できる
    for (const m of rules.mercy || []) {
      if (game.inning >= m.after && homeScore - awayScore >= m.diff) {
        return {
          type: 'mercy',
          text: `後攻チームが${homeScore - awayScore}点リードしています。コールドゲームの条件(${m.after}回以降${m.diff}点差)を満たしています。`,
        };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------
// 時間制限の判定(試合開始からの経過時間)
// 戻り値: { limit, elapsedMin } | null
// 草野球の慣例「時間切れ後は新しい回に入らない」を提案として表示するために使う。
// 旧データ(startedAt無し)では判定しない。
// ------------------------------------------------------------
export function timeLimitCheck(game, now = Date.now()) {
  const limit = game.rules?.timeLimitMin;
  if (!limit || !game.startedAt || game.status === 'finished') return null;
  const elapsedMin = Math.floor((now - game.startedAt) / 60000);
  if (elapsedMin < limit) return null;
  return { limit, elapsedMin };
}

// ------------------------------------------------------------
// 球数制限の判定(自チーム守備時の現投手が対象)
// 戻り値: { level: 'warn'|'over', pitches, limit } | null
// ------------------------------------------------------------
export function pitchLimitCheck(game) {
  const limit = game.rules?.pitchLimit;
  if (!limit?.perGame || !game.currentPitcherId || game.status === 'finished') return null;
  const pr = (game.pitchingRecords || []).find((r) => r.playerId === game.currentPitcherId);
  const pitches = pr?.pitches || 0;
  if (pitches >= limit.perGame) return { level: 'over', pitches, limit: limit.perGame };
  const warnAt = limit.warnAt ?? Math.max(1, limit.perGame - 10);
  if (pitches >= warnAt) return { level: 'warn', pitches, limit: limit.perGame };
  return null;
}

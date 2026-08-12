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
//   tiebreak: { fromInning: 8, runners: '2'|'12'|'23', order: 'cont'|'top' } | null,
//   fieldCount: 9,                   // 自チームが守りに就く人数(7..10)。9以外なら守備位置の警告を止める
//   allBat: { size: 12 } | null,     // 全員打ち(打順の人数)。守備に就かない打者を正常として扱う
// }
//
// タイブレーク・守備人数・全員打ちは「試合中に変わる」ことがある(人が帰って8人になる、
// 時間が押して延長はタイブレーク、途中から全員打ちにする)。そのため試合前に決めた
// rules を土台に、game.ruleChanges で「何回から何を変えたか」を積む形にしてある。
//
// game.ruleChanges = [{ id, at, fromInning, patch: { fieldCount: 8 }, text }]
//   - fromInning より前の回の記録には影響しない(遡って宣言し忘れを直すのにも使う)
//   - ある回に効いているルールは rulesAtInning(game, inning) で引く
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
    id: 'kusa7', label: '草野球 7回制・90分', en: 'Amateur 7-inn · 90 min', edition: '草野球',
    rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: 90 },
  },
  {
    id: 'kusa7-120', label: '草野球 7回制・120分', en: 'Amateur 7-inn · 120 min', edition: '草野球',
    rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: 120 },
  },
  {
    id: 'kusa7-nolimit', label: '草野球 7回制(時間無制限)', en: 'Amateur 7-inn (no time limit)', edition: '草野球',
    rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: null },
  },
  {
    // 社会人野球(企業・クラブ)の公式戦は9回制が主流。草野球エディションに含める。
    id: 'shakaijin9', label: '社会人・クラブ 9回制', en: 'Club/Corp 9-inn', edition: '草野球',
    rules: { innings: 9, mercy: [], pitchLimit: null, timeLimitMin: null },
  },
  {
    id: 'gakudo6', label: '学童(少年野球) 6回制・70球', en: 'Youth 6-inn · 70 pitches', edition: '少年野球',
    rules: { innings: 6, mercy: [{ after: 4, diff: 10 }, { after: 5, diff: 7 }], pitchLimit: { perGame: 70, warnAt: 60 }, timeLimitMin: null },
  },
  {
    id: 'chu7', label: '中学 7回制・100球', en: 'JH 7-inn · 100 pitches', edition: 'ブカツ(中高大)',
    rules: { innings: 7, mercy: [{ after: 5, diff: 7 }], pitchLimit: { perGame: 100, warnAt: 85 }, timeLimitMin: null },
  },
  {
    id: 'koko9', label: '高校 9回制(地方大会コールド)', en: 'HS 9-inn (regional mercy)', edition: 'ブカツ(中高大)',
    rules: { innings: 9, mercy: [{ after: 5, diff: 10 }, { after: 7, diff: 7 }], pitchLimit: null, timeLimitMin: null },
  },
  { id: 'daigaku9', label: '大学 9回制', en: 'Univ 9-inn', edition: 'ブカツ(中高大)', rules: { innings: 9, mercy: [], pitchLimit: null, timeLimitMin: null } },
];

export function presetById(id) {
  return RULE_PRESETS.find((p) => p.id === id) || null;
}

// ------------------------------------------------------------
// 試合中に変わるルール(タイブレーク・守備人数・全員打ち)
// ------------------------------------------------------------

// 守るのは最大10人(4外野まで)。11人以上を打順に入れるのは「全員打ち」の話。
export const FIELD_COUNT_MIN = 7;
export const FIELD_COUNT_MAX = 10;
export const ALL_BAT_MIN = 10;
export const ALL_BAT_MAX = 18;
// 大会によって置き方が違う。中学は満塁、一部アマチュアは1アウト満塁もある。
export const TIEBREAK_RUNNERS = ['2', '12', '23', '123'];
export const TIEBREAK_ORDERS = ['cont', 'top'];
export const TIEBREAK_OUTS = [0, 1];
export const DEFAULT_TIEBREAK = { runners: '12', order: 'cont', outs: 0 };
// 置く走者の人数(自責点から外す上限に使う)
export const runnersPlaced = (r) => String(r || '').length;

const LIVE_KEYS = ['tiebreak', 'fieldCount', 'allBat'];

// ある回に効いているルール。試合前に決めた rules に、fromInning <= inning の変更を順に重ねる。
export function rulesAtInning(game, inning) {
  const base = game?.rules || null;
  const changes = game?.ruleChanges || [];
  if (!changes.length) return base;
  const n = Number(inning) || 1;
  const out = { ...(base || {}) };
  for (const c of [...changes].sort((a, b) => (a.fromInning - b.fromInning) || (a.at - b.at))) {
    if (Number(c.fromInning) > n) continue;
    for (const k of LIVE_KEYS) if (k in (c.patch || {})) out[k] = c.patch[k];
  }
  return out;
}

// 試合の最後まで効いているルール(表示・既定値の初期化用)
export function currentRules(game) {
  const innings = (game?.ruleChanges || []).map((c) => Number(c.fromInning) || 1);
  return rulesAtInning(game, Math.max(Number(game?.inning) || 1, ...innings, 1));
}

// ------------------------------------------------------------
// タイブレークの自責点
//
// タイブレーク開始時に置かれている走者は、投手が打たれて出したのではないので、
// その走者が還っても自責点にはならない(失点にはなる)。
// 投手が自分で出した走者が還った分は、これまでどおり自責点になる。
//
// 記録から「置いた走者が還ったか」を追うことはできない。ただし走者は塁上の順に
// 還るので、その回に点が入れば置いた走者から先に還っているのがふつう。
// 置いた走者が塁上でアウトになった場合だけこの見立てが外れるので、
// 半回ごとに人が「置いた走者のうち何人還ったか」を上書きできるようにしてある。
// ------------------------------------------------------------
export const halfKeyOf = (inning, isTop) => `${Number(inning) || 0}${isTop ? 'T' : 'B'}`;

// その半回で置いた走者が何人還ったか。人が入れていれば その値、無ければ null(=見立てに任せる)
export function placedRunsScored(game, inning, isTop) {
  const v = (game?.tiebreakScored || {})[halfKeyOf(inning, isTop)];
  return Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : null;
}

// 全員打ちで宣言した打順の人数。宣言が無ければ9。
export function allBatSize(game, inning) {
  const n = Number(rulesAtInning(game, inning ?? game?.inning ?? 1)?.allBat?.size);
  return Number.isFinite(n) && n > 9 ? n : 9;
}

// 打順を何枠にするか。全員打ちでも「来ている人数」を超えては組めない。
// 18人と宣言していても12人しか来ていなければ12人打順になる。
export function lineupSlotsFor(game, attendeeCount) {
  const declared = allBatSize(game);
  const here = Number(attendeeCount) || 0;
  if (declared <= 9) return 9;
  return Math.max(9, Math.min(declared, here || declared));
}

// 守備人数。未指定(旧データ含む)は9人として扱う
export function fieldCountAt(game, inning) {
  const n = Number(rulesAtInning(game, inning)?.fieldCount);
  return Number.isFinite(n) && n > 0 ? n : 9;
}

// その回がタイブレークか
export function isTiebreakInning(game, inning) {
  const tb = rulesAtInning(game, inning)?.tiebreak;
  return !!tb && Number(inning) >= Number(tb.fromInning || 0);
}

// 変更内容を1行で。履歴表示に使う(保存時に text として焼き込む)
export function describeRulePatch(patch = {}, lang = 'ja') {
  const en = lang === 'en';
  const parts = [];
  if ('tiebreak' in patch) {
    const tb = patch.tiebreak;
    if (!tb) parts.push(en ? 'Tiebreak off' : 'タイブレークをやめた');
    else {
      // 「ノーアウト一・二塁」と続けて読めるよう、日本語では「走者」を付けない
      const r = {
        2: en ? 'runner on 2nd' : '二塁',
        12: en ? 'runners on 1st & 2nd' : '一・二塁',
        23: en ? 'runners on 2nd & 3rd' : '二・三塁',
        123: en ? 'bases loaded' : '満塁',
      }[tb.runners] || tb.runners;
      const outs = Number(tb.outs) === 1 ? (en ? '1 out' : 'ワンアウト') : (en ? 'no outs' : 'ノーアウト');
      const o = tb.order === 'top' ? (en ? 'order restarts' : 'その回の先頭から') : (en ? 'order continues' : '前の回の続き');
      parts.push(en ? `Tiebreak (${outs}, ${r}, ${o})` : `タイブレーク（${outs}${r}・${o}）`);
    }
  }
  if ('fieldCount' in patch) {
    parts.push(patch.fieldCount === 9
      ? (en ? 'Back to 9 fielders' : '守備を9人に戻した')
      : (en ? `${patch.fieldCount} fielders` : `守備 ${patch.fieldCount}人`));
  }
  if ('allBat' in patch) {
    parts.push(patch.allBat
      ? (en ? `Bat-around lineup of ${patch.allBat.size}` : `全員打ち ${patch.allBat.size}人打順`)
      : (en ? 'Bat-around off' : '全員打ちをやめた'));
  }
  return parts.join(en ? ' / ' : '／');
}

// 変更前後を比べて「変わった項目だけ」を取り出す。
// 変えていないのに保存したときに、同じ内容が履歴に積まれるのを防ぐ。
export function diffLiveRules(prev = {}, next = {}) {
  const patch = {};
  // 比べるためだけの並び。JSON.stringify はキーの順に左右されるので、順を固定して作る
  const norm = (k, v) => {
    if (k === 'fieldCount') return Number(v) || 9;
    if (!v) return '';
    if (k === 'tiebreak') return [v.fromInning, v.runners, v.order, Number(v.outs) || 0].join('|');
    return JSON.stringify(v);
  };
  for (const k of LIVE_KEYS) {
    if (norm(k, prev?.[k]) !== norm(k, next?.[k])) patch[k] = next?.[k] ?? (k === 'fieldCount' ? 9 : null);
  }
  return patch;
}

// プリセットの表示ラベル(言語別)。保存値(id/rules)は不変。
export function presetLabel(p, lang) {
  return lang === 'en' && p.en ? p.en : p.label;
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

// ルール内容の1行説明(選択UI・確認表示用)。lang='en'で英語表記。
export function describeRules(rules, lang = 'ja') {
  const en = lang === 'en';
  if (!rules) return en ? 'No rule tracking (unlimited innings, no checks)' : 'ルール管理なし(回数無制限・判定なし)';
  const parts = [en ? `${rules.innings}-inn` : `${rules.innings}回制`];
  if (rules.timeLimitMin) parts.push(en ? `${rules.timeLimitMin}-min limit` : `${rules.timeLimitMin}分時間制限`);
  for (const m of rules.mercy || []) parts.push(en ? `mercy ${m.diff}+ after ${m.after}` : `${m.after}回${m.diff}点差コールド`);
  if (rules.pitchLimit?.perGame) parts.push(en ? `${rules.pitchLimit.perGame}-pitch limit` : `球数${rules.pitchLimit.perGame}球制限`);
  if (rules.tiebreak) parts.push(en ? `tiebreak from ${rules.tiebreak.fromInning}` : `${rules.tiebreak.fromInning}回からタイブレーク`);
  if (rules.fieldCount && rules.fieldCount !== 9) parts.push(en ? `${rules.fieldCount} fielders` : `守備${rules.fieldCount}人`);
  if (rules.allBat) parts.push(en ? `bat-around ${rules.allBat.size}` : `全員打ち${rules.allBat.size}人`);
  return parts.join(en ? ' · ' : '・');
}

// ------------------------------------------------------------
// 試合終了条件の判定(純関数・描画時に呼ぶ)
// 戻り値: { type: 'regulation'|'xwin'|'mercy'|'tie', text } | null
//  - 強制はせず、ScoreTab側が提案バナーとして表示する
// ------------------------------------------------------------
export function gameEndCheck(game, lang = 'ja') {
  const en = lang === 'en';
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
        const label = en
          ? (done > innings ? `${done} extra innings` : `${innings} regulation innings`)
          : (done > innings ? `延長${done}回` : `規定の${innings}回`);
        return {
          type: 'regulation',
          text: en ? `${label} complete. You can finish the game.` : `${label}を終了しました。試合を終了できます。`,
        };
      }
      return {
        type: 'tie',
        text: en
          ? `Tied after ${done} innings. You can finish as a draw or play extra innings.`
          : `${done}回を終了して同点です。引き分けで終了するか、延長戦を続けられます。`,
      };
    }
    // コールド判定(直前の回の終了時点)
    for (const m of rules.mercy || []) {
      if (done >= m.after && diff >= m.diff) {
        return {
          type: 'mercy',
          text: en
            ? `A ${diff}-run gap after ${done} innings. Meets the mercy-rule condition (${m.diff}+ runs from inning ${m.after}).`
            : `${done}回終了時点で${diff}点差です。コールドゲームの条件(${m.after}回以降${m.diff}点差)を満たしています。`,
        };
      }
    }
  } else {
    // 裏の進行中(その回の表は完了済み)
    if (game.inning >= innings && homeScore > awayScore) {
      return {
        type: 'xwin',
        text: en
          ? `The home team is leading. You can end the game without playing the bottom of inning ${game.inning} (walk-off / X-win).`
          : `後攻チームがリードしています。${game.inning}回裏は行わず(または途中で)試合を終了できます(X勝ち/サヨナラ)。`,
      };
    }
    // 後攻リードのコールドは表終了時点(=裏の間)でも判定できる
    for (const m of rules.mercy || []) {
      if (game.inning >= m.after && homeScore - awayScore >= m.diff) {
        return {
          type: 'mercy',
          text: en
            ? `The home team leads by ${homeScore - awayScore}. Meets the mercy-rule condition (${m.diff}+ runs from inning ${m.after}).`
            : `後攻チームが${homeScore - awayScore}点リードしています。コールドゲームの条件(${m.after}回以降${m.diff}点差)を満たしています。`,
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

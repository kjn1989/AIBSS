// ============================================================
// データ設計: Player / Game / AtBat / Pitch / PlayLog / PitchingRecord
// ローカル保存(localStorage)と Firestore で同一スキーマを共有する。
// ============================================================

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- 打撃結果種別 ----
export const RESULTS = {
  // labelは初心者にも分かりやすい口語表記(スコア入力パッド・ログ・確認・編集で共通)。
  // shortはスコアシート/PDFの略号なので従来の野球公式表記を維持する。
  single: { label: 'ヒット', short: 'H', hit: true, bases: 1, ab: true, onBase: true },
  double: { label: 'ツーベース', short: '2B', hit: true, bases: 2, ab: true, onBase: true },
  triple: { label: 'スリーベース', short: '3B', hit: true, bases: 3, ab: true, onBase: true },
  hr: { label: 'ホームラン', short: 'HR', hit: true, bases: 4, ab: true, onBase: true },
  out: { label: '凡打(アウト)', short: 'OUT', hit: false, bases: 0, ab: true, onBase: false },
  bb: { label: '四球', short: 'BB', hit: false, bases: 0, ab: false, onBase: true },
  hbp: { label: '死球', short: 'HBP', hit: false, bases: 0, ab: false, onBase: true },
  so: { label: '三振', short: 'K', hit: false, bases: 0, ab: true, onBase: false },
  error: { label: 'エラー', short: 'E', hit: false, bases: 0, ab: true, onBase: true },
  sacBunt: { label: 'バント', short: 'SAC', hit: false, bases: 0, ab: false, onBase: false },
  sacFly: { label: '犠牲フライ', short: 'SF', hit: false, bases: 0, ab: false, onBase: false },
  interference: { label: '打撃妨害', short: 'IF', hit: false, bases: 0, ab: false, onBase: true },
  // 守備妨害(攻撃側の妨害): 打者/走者アウト。走塁妨害(守備側の妨害/オブストラクション): 出塁が認められる。
  fieldInterference: { label: '守備妨害', short: '守妨', hit: false, bases: 0, ab: true, onBase: false },
  obstruction: { label: '走塁妨害', short: '走妨', hit: false, bases: 0, ab: false, onBase: true },
};

// ---- 三振の内訳 ----
export const SO_TYPES = { swinging: '空振り三振', looking: '見逃し三振' };

// ---- 四球の内訳 ----
// 故意四球(敬遠)は独立した結果ではなく四球の内訳。公式記録でも与四球に数えたうえで、
// 別に故意四球として持つ。結果種別を増やすと打率・出塁率の分母を通る道が二重になるので、
// result は 'bb' のまま intentional フラグだけを足す。
export const IBB_LABEL = '敬遠';
export const isIntentionalBB = (p) => p?.result === 'bb' && !!p?.intentional;

// 打席結果の表示名(ログ・確認・修正で共通)。三振と四球は内訳で呼び名が変わる。
export function resultLabelOf(p) {
  if (!p) return '';
  if (p.result === 'so') return SO_TYPES[p.soType] || RESULTS.so.label;
  if (isIntentionalBB(p)) return IBB_LABEL;
  return RESULTS[p.result]?.label || p.result;
}

// ---- ファウルグラウンドを選べる結果 ----
// ファウルフライは凡打なので、打点をファウル側に置けないと記録できない。
// 一方でファウルの安打は無く、ファウルのバントは犠打ではなくストライクなので、
// これらはフェアゾーンだけに限る(押し間違いを図の側で防ぐ)。
export const FOUL_RESULTS = ['out', 'error', 'sacFly'];
export const allowsFoul = (result) => FOUL_RESULTS.includes(result);

// ---- 凡打の内訳 ----
export const OUT_TYPES = {
  ground: 'ゴロ',
  fly: 'フライ',
  liner: 'ライナー',
  dp: 'ダブルプレー',
  ifly: 'インフィールドフライ',
};

// インフィールドフライが宣告されうる場面か。
// 一二塁(または満塁)で2アウト未満のときだけ。打者は捕球されなくてもアウトで、
// 走者は自分の危険で進める。フライ扱いなので犠飛にはならない。
// バントの小飛球は対象外だが、そこは記録員の判断に委ねる(規則上も打球で分かれる)。
export function infieldFlyPossible(runners, outs) {
  const on = runners || {};
  return !!(on[1] && on[2]) && Number(outs) < 2;
}

// プレイ結果の分類(スコアシート・ログの色分け用。画面とPDFで同一のクラス名を使う)。
// hit=ヒット / outres=アウト / walk=四死球 / error=エラー / sac=犠打犠飛 / intf=妨害 / other=その他
export function resultCategory(result) {
  const r = RESULTS[result];
  if (!r) return 'other';
  if (r.hit) return 'hit';
  if (result === 'error') return 'error';
  if (result === 'bb' || result === 'hbp') return 'walk';
  if (result === 'sacBunt' || result === 'sacFly') return 'sac';
  if (result === 'interference' || result === 'obstruction' || result === 'fieldInterference') return 'intf';
  if (result === 'out' || result === 'so') return 'outres';
  return 'other';
}

// 1プレイでまとめて取ったアウト数の強調表記(2=ダブルプレー, 3=トリプルプレー)。
export function multiOutLabel(outsOnPlay) {
  if (outsOnPlay >= 3) return 'トリプルプレー';
  if (outsOnPlay === 2) return 'ダブルプレー';
  return null;
}

// 凡打の内訳ラベル。少年野球エディションでは親しみやすい表記に差し替える(併殺打→ゲッツー)。
export function outTypeLabel(outType, edition) {
  if (edition === '少年野球' && outType === 'dp') return 'ゲッツー';
  return OUT_TYPES[outType] || '';
}

// ---- 打球方向 ----
export const DIRECTIONS = {
  P: '投手', C: '捕手', '1B': '一塁', '2B': '二塁', '3B': '三塁',
  SS: '遊撃', LF: '左翼', CF: '中堅', RF: '右翼',
};

// ---- 打球方向 → その打球を処理した守備位置 ----
// 失策を記録するとき、既定の野手をここから決める。打った方向の野手が
// 捕って投げるのが普通なので、そこを初期値にして押す回数を減らす。
export const DIR_TO_POSITION = {
  P: '投', C: '捕', '1B': '一', '2B': '二', '3B': '三',
  SS: '遊', LF: '左', CF: '中', RF: '右',
};

// ---- 1つのプレイに付く失策 ----
// 記録規則では、安打かどうかは打球そのもので決まり、そのあと守備が乱れて
// 余分に進んだぶんは失策になる。つまり1つのプレイに安打と失策が同時に付く。
//   例) 右翼へのツーベース。右翼手の送球が逸れて打者走者が三塁へ。
//       → 打者は二塁打、右翼手に送球失策1
// result は1つしか持てないので、失策は別枠(payload.playError)で持つ。
export const ERROR_KINDS = ['field', 'throw'];

// 保存された失策を読み出す。位置も種類も無いものは失策として数えない
export function playErrorOf(payload) {
  const e = payload?.playError;
  if (!e || !e.pos) return null;
  if (!FIELD_POSITIONS.includes(e.pos)) return null;
  return {
    pos: e.pos,
    kind: ERROR_KINDS.includes(e.kind) ? e.kind : 'field',
    playerId: e.playerId || null,
  };
}

// ---- ファインプレー ----
// 失策の裏返し。どちらも「守備がふつうではなかった」の記録で、向きが逆なだけ。
// だから入力も同じ場所に置き、同じ形で持つ。
//
// これが無いと、守備の価値が片側しか残らない。守備側の勝利貢献・得点貢献は
// その打席を投げていた投手に全部付くので(contrib.js)、遊撃手が飛びついて
// 捕っても野手には何も残らなかった。失策だけ残って好守は残らない。
//
// アウトに限らない。打球を止めて進塁を防いだのも好守なので、
// 打球のあるプレイなら押せる。
export function finePlayOf(payload) {
  const f = payload?.finePlay;
  if (!f || !f.pos) return null;
  if (!FIELD_POSITIONS.includes(f.pos)) return null;
  return { pos: f.pos, playerId: f.playerId || null };
}

// ---- 守備位置 ----
// '打' = 全員打ちの打撃のみ(守備につかない打者)、'控' = ベンチ
export const POSITIONS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右', 'DH', '打', '控'];

// 選手に登録する守備位置。DH・打・控は「その試合での役割」であって
// 選手の属性ではないので、登録の対象からは外す。
export const FIELD_POSITIONS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];

// その選手がその位置を守れるか。'main'(いつもの位置) / 'sub'(任せられる) / null。
// AIスタメン提案は main を優先し、main だけで9枠が埋まらないときに sub を使う。
export function playablePosition(player, pos) {
  if (!player || !pos) return null;
  if (player.position === pos) return 'main';
  return (player.subPositions || []).includes(pos) ? 'sub' : null;
}

// サブの中での優先順位。subPositions の並びがそのまま順番(先頭がいちばん優先)。
// 0 が最優先、-1 はサブに入っていない。
// 「二塁のほうが三塁より任せやすい」という差を、順番だけで表せるようにしている。
export function subRank(player, pos) {
  const i = (player?.subPositions || []).indexOf(pos);
  return i;
}

// 名簿(または今日の参加メンバー)で、各守備位置を守れる人数。
// 「捕手が1人しかいない」を出すために main と sub を分けて数える。
export function positionCoverage(players = []) {
  const out = {};
  for (const pos of FIELD_POSITIONS) {
    let main = 0;
    let sub = 0;
    for (const p of players) {
      const k = playablePosition(p, pos);
      if (k === 'main') main += 1;
      else if (k === 'sub') sub += 1;
    }
    out[pos] = { main, sub, total: main + sub };
  }
  return out;
}

// 誰も守れない位置。ここが空でなければ、スタメンは組めない
export function uncoveredPositions(players = []) {
  const cov = positionCoverage(players);
  return FIELD_POSITIONS.filter((pos) => cov[pos].total === 0);
}

// 守備位置マークの英語表記(保存値は日本語のまま、表示だけ切り替える)。
const POSITION_EN = {
  投: 'P', 捕: 'C', 一: '1B', 二: '2B', 三: '3B', 遊: 'SS', 左: 'LF', 中: 'CF', 右: 'RF',
  DH: 'DH', 打: 'BAT', 控: 'BN',
};
export function positionLabel(pos, lang) {
  return lang === 'en' ? (POSITION_EN[pos] || pos) : pos;
}

// ---- 相手チームの選手記号(実名は入力せず A〜T の20人で管理) ----
export const OPP_LETTERS = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i));

// ============================================================
// ファクトリ関数(スキーマ定義を兼ねる)
// ============================================================

// 投打の左右。空文字=未設定(任意入力)。
export const HAND_OPTIONS = ['', 'R', 'L', 'S']; // R=右 / L=左 / S=両(スイッチ)
export const HAND_LABEL = { R: '右', L: '左', S: '両', '': '—' };

export function newPlayer(name, number = '', opts = {}) {
  return {
    id: uid(), name, number, createdAt: Date.now(),
    throws: opts.throws || '', // 投げる手: 'R'|'L'|'' (捕手左投げ等の稀少ケースも許容)
    bats: opts.bats || '',     // 打つ側: 'R'|'L'|'S'|''
    // 守備位置。position=主(いつもの位置・1つ) / subPositions=任せられる位置(複数)。
    // これが無いと、AIスタメン提案は「誰がどこを守れるか」を知らないまま
    // 9つの守備位置を埋めることになり、位置がばらばらになる。
    position: opts.position || '',
    subPositions: Array.isArray(opts.subPositions) ? [...opts.subPositions] : [],
    // AI選手名鑑(スカウト寸評)の保存内容。未確定の間は編集画面側のローカル状態のみで保持する。
    scoutTags: [], // { label, type }[]
    scoutCatchphrase: '',
    scoutReport: '',
    scoutPhoto: '', // 顔写真(256px JPEGのdataURL)。空なら頭文字を表示。
    // 卒業・退部でのアーカイブ。削除ではなく「名簿の前面から外す」だけで、記録は残る。
    // 在籍期間は出場した試合から導出するので保存しない(lib/year.js の tenureByPlayer)。
    // 入学年度。学年は「年度 − 入学年度 + 1」で導出する(学年を保存すると毎年書き換えが要る)。
    // ブカツ・少年野球でのみ使う。未設定なら学年は「未設定」扱い。
    entryYear: opts.entryYear ?? null,
    // チーム内の役割。'captain' | 'vice' | ''(なし)。全エディション共通。
    teamRole: '',
    archivedAt: null,   // アーカイブした日時 | null=現役
    archivedYear: null, // どの年度の終わりで抜けたか
    archiveNote: '',    // '卒業' | '退部' | '移籍' など(任意)
  };
}

// その試合に来ているメンバーだけを返す。
// 参加メンバーを記録していない試合(この項目より前のデータ)は、全員が来ていた扱い。
// 空配列は「1人も来ていない」ではなく「まだ決めていない」なので、これも全員扱いにする。
export function attendeesOf(game, players = []) {
  const ids = game && game.attendees;
  if (!Array.isArray(ids) || ids.length === 0) return players;
  const set = new Set(ids);
  return players.filter((p) => set.has(p.id));
}

// 直近の試合の参加メンバー。次の試合の既定値に使う。
// 顔ぶれは週ごとに大きく変わらないので、毎回まっさらから選ぶより
// 前回からの差分だけ直すほうが手数が少ない。
export function lastAttendees(games = []) {
  const rows = games
    .filter((g) => g && !String(g.id || '').startsWith('demo-') && Array.isArray(g.attendees) && g.attendees.length)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.startedAt || 0) - (a.startedAt || 0));
  return rows[0] ? [...rows[0].attendees] : null;
}

// 参加メンバーから打順と守備を組む。
//
// 登録順に 投捕一二三遊左中右 を機械的に当てていた頃は、誰がどこを守れるかを
// 見ていなかったので位置がばらばらになった。メインを優先し、メインで埋まらない
// 位置だけサブで埋める(AIスタメン提案と同じ順序)。
//
// 候補の少ない位置から先に決める。捕手が1人しかいないのに、その人を先に
// 別の位置へ入れてしまうと捕手が空くため。
// 戻り値: { lineup: [{ playerId, position }], unfilled: [位置] }
// max: 打順の枠数(全員打ちでは9より多い)
// benchPosition: 守備に付かなかった人の位置。全員打ちでは打つので '打'、ふつうは '控'
// 過去の試合からオーダーを引き継ぐ。
// DH制かどうかも一緒に持ってこないといけない。ここを揃えずに打順だけ写すと、
// DHのオーダーを読み込んだのに useDH は false のままになり、
// 「投」の候補が打者一覧(＝投手が一人も居ない)になって先発を選べなくなる。
// 戻り値: { selected, useDH, pitcherId }
export function lineupFromPast(game, availableIds = []) {
  const existing = new Set(availableIds);
  const selected = (game?.lineup || [])
    .filter((l) => existing.has(l.playerId))
    .sort((a, b) => a.order - b.order)
    .map((l) => ({ playerId: l.playerId, position: l.position || '' }));
  const useDH = selected.some((l) => l.position === 'DH');
  if (!useDH) return { selected, useDH, pitcherId: '' };
  // DH制の投手は打順の外に居る。打順に入ってしまった人を投手にはできない
  const inOrder = new Set(selected.map((l) => l.playerId));
  const past = game?.pitcherId || (game?.lineup || []).find((l) => l.position === '投')?.playerId || '';
  const ok = past && existing.has(past) && !inOrder.has(past);
  return { selected, useDH, pitcherId: ok ? past : '' };
}

export function autoLineupFrom(players = [], { max = 9, benchPosition = '控' } = {}) {
  const taken = new Set();
  const assigned = {}; // 位置 -> playerId
  const remaining = new Set(FIELD_POSITIONS);

  const candidates = (pos) => {
    const mains = [];
    const subs = [];
    for (const p of players) {
      if (taken.has(p.id)) continue;
      const k = playablePosition(p, pos);
      if (k === 'main') mains.push(p);
      else if (k === 'sub') subs.push(p);
    }
    // サブは、その位置を上位に置いている選手から先に使う。
    // 「二塁のほうが三塁より任せやすい」と登録した意図を活かす
    subs.sort((a, b) => subRank(a, pos) - subRank(b, pos));
    return { mains, subs };
  };

  while (remaining.size > 0) {
    // いちばん候補が少ない位置から決める(同数ならメインが少ないほうを先に)
    let pick = null;
    let pickScore = null;
    for (const pos of remaining) {
      const { mains, subs } = candidates(pos);
      const score = [mains.length + subs.length, mains.length];
      if (!pickScore || score[0] < pickScore[0] || (score[0] === pickScore[0] && score[1] < pickScore[1])) {
        pick = { pos, mains, subs };
        pickScore = score;
      }
    }
    remaining.delete(pick.pos);
    const who = pick.mains[0] || pick.subs[0] || null;
    if (who) { assigned[pick.pos] = who.id; taken.add(who.id); }
  }

  // 守れる人が居なかった位置。黙って別の人を入れず、空けたまま返す
  const unfilled = FIELD_POSITIONS.filter((pos) => !assigned[pos]);

  // 打順は名簿の並びのまま(打順の最適化はAIスタメン提案の仕事)。
  // 守備に付いた人を先に、余った人は控えとして後ろに置く。
  const lineup = [];
  for (const p of players) {
    const pos = FIELD_POSITIONS.find((x) => assigned[x] === p.id);
    if (pos) lineup.push({ playerId: p.id, position: pos });
  }
  for (const p of players) {
    if (lineup.length >= max) break;
    if (!taken.has(p.id)) lineup.push({ playerId: p.id, position: benchPosition });
  }
  return {
    lineup: lineup.slice(0, max).map((x, i) => ({ order: i + 1, ...x })),
    unfilled,
  };
}

// ---- エディション(利用シーン別のモード切り替え) ----
// AIスタメン提案・AI選手名鑑など一部AI機能は「草野球」エディション(=大人向け)限定。
// パワプロ風の際どい寸評等が未成年(ブカツ/少年野球)の文脈にそぐわないため。
// ※「草野球」エディションは社会人野球も包含する(いずれも大人・標準用語・AI機能ありで挙動が同一)。
//   内部の保存値は '草野球' のままとし、UI表示だけ editionLabel() で「草野球・社会人」にする
//   (データ移行不要・既存の判定/CSS/プリセットを一切変えないため)。
export const EDITIONS = ['草野球', 'ブカツ(中高大)', '少年野球'];
export const DEFAULT_EDITION = '草野球';

// エディションのUI表示ラベル。保存値は変えず表示のみ差し替える。
export const SCHOOL_TYPE_LABEL = { junior: '中学', high: '高校', university: '大学', elementary: '小学' };

export function editionLabel(edition, schoolType) {
  if (edition === '草野球') return '草野球・社会人';
  // ブカツは中高大が混ざる。どれで記録しているかはヘッダーに出しておく
  if (edition === 'ブカツ(中高大)' && SCHOOL_TYPE_LABEL[schoolType]) {
    return `ブカツ(${SCHOOL_TYPE_LABEL[schoolType]})`;
  }
  return edition || '草野球';
}

// 旧表記(初期リリースの「ブカツ(中-大)」)を現行表記へ正規化する。
// 保存済みデータ(settings.edition / チームレジストリ)の読み込み時に通すこと。
export function normalizeEdition(edition) {
  return edition === 'ブカツ(中-大)' ? 'ブカツ(中高大)' : edition;
}

// ---- 参加メンバー(マネージャー/応援/スタッフ等。試合には出ないが参加回数を記録する) ----
export const MEMBER_ROLES = ['マネージャー', 'コーチ', '応援', 'スタッフ', 'その他'];

// メンバー役割の英語表記(保存値は日本語のまま、表示だけ切替)。
const MEMBER_ROLE_EN = { マネージャー: 'Manager', コーチ: 'Coach', 応援: 'Support', スタッフ: 'Staff', その他: 'Other' };
export function memberRoleLabel(role, lang) {
  return lang === 'en' ? (MEMBER_ROLE_EN[role] || role) : role;
}

export function newMember(name, role = 'マネージャー') {
  return {
    id: uid(), name, role, participation: 0, createdAt: Date.now(),
    // 選手と同じく名鑑(スカウト寸評)を持てる
    scoutTags: [],
    scoutCatchphrase: '',
    scoutReport: '',
    scoutPhoto: '',
  };
}

export function newGame({ opponent = '', isHome = false, date = null, season = '', rules = null, allowReentry = false, attendees = null, scorerId = null, teamGap = 'even' } = {}) {
  return {
    id: uid(),
    date: date || new Date().toISOString().slice(0, 10),
    opponent,
    season, // シーズン/大会名(任意。集計フィルタに使用)
    isHome, // true=自チーム後攻
    // 試合ルール(lib/rules.js)。試合作成時のルールをスナップショットとして保持する。
    // null = ルール管理なし(旧データ含む。終了提案・球数警告などの判定は無効)
    rules,
    // リエントリー(一度退いた選手の再出場)を認める試合か。
    // 大会・年代によって扱いが違うので試合ごとに持つ。false のときだけ再出場を警告する。
    allowReentry,
    // その試合に来ているメンバー(選手ID の配列)。登録選手が全員来るとは限らない。
    // null = 未設定(この項目より前に作られた試合)。そのときは全員が来ていた扱いにする。
    attendees: Array.isArray(attendees) ? [...attendees] : null,
    // その試合の記録員(スコアラー)。流れタグは記録員の読みなので、
    // 誰が付けた試合かが分からないと読みの正答率を積み上げられない。
    // null = 未設定(この項目より前に作られた試合。集計から外れるだけで記録は壊れない)
    scorerId,
    // 相手との力の差(lib/teamGap.js)。'even' が既定で、そのときは何も変わらない。
    // 「10回やって何回勝てるか」で入れて、そこから得点期待値の倍率を逆に解く。
    // 流れチャートの出発点がこの設定そのものになる(30%なら30%から始まる)。
    teamGap,
    // 流れの区間ごとに、記録員が書き直した文 { 区間の先頭打席ID: 文 }。
    // 自動の下書きは記録からしか組めないので、見ていたことは記録員が書く
    flowNotes: {},
    startedAt: Date.now(), // 試合開始時刻(時間制限ルールの判定に使用)
    status: 'ongoing', // 'ongoing' | 'finished'
    inning: 1,
    isTop: true, // 表/裏
    outs: 0,
    // 走者: 各塁 null または { playerId(自チーム時) , label, pitcherId(責任投手/守備時) }
    runners: { 1: null, 2: null, 3: null },
    myScore: 0,
    oppScore: 0,
    // 打順: [{ order, playerId, position }] を9枠
    lineup: [],
    usedPlayerIds: [], // 出場済み
    retiredPlayerIds: [], // 一度退いた(再出場警告用)
    batterIndex: 0, // 次打者のlineup index
    currentPitcherId: null,
    // 相手チーム: 実名の代わりに A〜T の記号で管理する打順(9枠)。代打・代走・守備交代で入れ替え可能
    oppLineup: OPP_LETTERS.slice(0, 9).map((letter, i) => ({ order: i + 1, letter, position: '' })),
    oppUsedLetters: OPP_LETTERS.slice(0, 9), // 出場済み記号
    oppRetiredLetters: [], // 一度退いた記号(再出場警告用)
    oppBatterIndex: 0, // 次の相手打者のoppLineup index
    oppPitcherLetter: 'A', // 相手投手(記号ラベル)。先発は既定でA=初回から球数を確実にカウント
    // 相手投手の球数(記号ごと)。成績は追わないが球数だけはペース把握のため記録する。
    // { [letter]: { pitches, pitchesByInning: { "1": n, ... } } }
    oppPitchers: {},
    // 左右別スタッツ用: 相手投手・相手打者の投打(記号ごと)。任意。'R'|'L'|'S'
    oppPitcherHands: {}, // { [letter]: 'R'|'L' } 自軍打者の対左右投手splitに使う
    oppBatterHands: {},  // { [letter]: 'R'|'L'|'S' } 自軍投手の対左右打者splitに使う
    // 相手選手の名前(任意)。{ [letter]: '田中' }。未入力の記号は A/B/… のまま表示する。
    // 相手は毎試合変わるため選手マスタには入れず、この試合だけの情報として持つ。
    oppNames: {},
    // 相手選手の守備位置(任意)。{ [letter]: '投'|'捕'|… }。分かる範囲で入れられる。
    oppPositions: {},
    atBats: [], // AtBat[]
    playLogs: [], // PlayLog[]
    pitchingRecords: [], // PitchingRecord[]
    linescore: {}, // { [inning]: { my, opp } } 回ごとの得点(試合結果の線分表示用)
    // CSV取り込み(ボックススコア)の集計値。プレイ単位ではなく選手ごとの合計を保持し、
    // 成績集計エンジンが加算する。空欄項目は0扱い(まばらなデータも許容)。
    importedBatting: [], // [{ playerId, pa, ab, h, single, double, triple, hr, rbi, bb, hbp, so, sacBunt, sacFly, sb, runs, tb }]
    importedPitching: [], // [{ playerId, outsRecorded, runs, earnedRuns, hitsAllowed, walks, hitByPitch, strikeouts, pitches, abFaced, win, save, hold }]
    updatedAt: Date.now(),
  };
}

// AtBat: 打席。開始時スナップショットを必ず保持する。
export function newAtBat({ gameId, playerId, order, snapshot }) {
  return {
    id: uid(),
    gameId,
    playerId,
    order,
    // 結果(確定時に埋める)
    result: null, // RESULTS のキー
    outType: null, // OUT_TYPES のキー(凡打時)
    soType: null, // 三振の種類: 'swinging'(空振り) | 'looking'(見逃し)
    intentional: false, // 故意四球(敬遠)。result==='bb' のときだけ意味を持つ
    direction: null, // DIRECTIONS のキー
    rbi: 0,
    runsOnPlay: 0,
    // 投球(Pitch構造の配列): { type: 'ball'|'strike'|'foul'|'inplay', sub?, ts }
    pitches: [],
    pitchCount: 0,
    firstPitch: null, // 初球結果
    firstPitchHit: false, // 初球インプレーで安打
    // 打席開始時スナップショット(RISP/ADV%/クラッチ判定に必須)
    snapshot: snapshot || {
      runners: { 1: false, 2: false, 3: false },
      outs: 0,
      inning: 1,
      isTop: true,
      scoreDiff: 0, // 自チーム − 相手 (打席開始時)
    },
    advSuccess: null, // 走者あり凡打: 進塁打成功 true/false、対象外は null
    vsHand: null, // 対戦した相手投手の投げ手 'R'|'L'(左右別split用。未設定null)
    clutch: null, // 'first'|'tie'|'goahead'|'comeback'|null
    ts: Date.now(),
  };
}

// Pitch: 1球。AtBat.pitches に格納(同一スキーマでCSVにも展開)
// type: 'ball'|'strike'|'foul'|'inplay' / sub: ストライクの種別 'looking'(見逃し)|'swinging'(空振り)。任意。
export function newPitch(type, sub = null) {
  const p = { type, ts: Date.now() };
  if (sub) p.sub = sub;
  return p;
}

// PlayLog: 全プレイの時系列ログ
export function newPlayLog({ gameId, inning, isTop, kind, text, payload = {} }) {
  return { id: uid(), gameId, inning, isTop, kind, text, payload, ts: Date.now() };
}

// PitchingRecord: 投手成績(1試合1投手1レコード)
export function newPitchingRecord({ gameId, playerId, appearanceOrder }) {
  return {
    id: uid(),
    gameId,
    playerId,
    appearanceOrder,
    outsRecorded: 0, // 1/3回単位(アウト数)
    runs: 0, // 失点
    earnedRuns: 0, // 自責点(手動微調整可)
    hitsAllowed: 0, // 被安打
    walks: 0, // 与四球
    intentionalWalks: 0, // 与故意四球(与四球の内数)
    hitByPitch: 0, // 与死球
    strikeouts: 0, // 奪三振
    pitches: 0, // 投球数
    pitchesByInning: {}, // イニング別投球数 { "1": 12, "2": 15, ... }(ペース把握用)
    abFaced: 0, // 被打数(相手の打数: 被打率の分母)
    win: false,
    save: false,
    hold: false, // ホールド
    ts: Date.now(),
  };
}

// 投球回の表示 (アウト数 → "3.2" 形式)
export function formatIP(outs) {
  const full = Math.floor(outs / 3);
  const rem = outs % 3;
  return rem === 0 ? `${full}` : `${full}.${rem}`;
}

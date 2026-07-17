// ============================================================
// 軽量i18n(外部ライブラリ不使用)
// - MESSAGES[lang] のフラットなキー辞書を translate() で引く
// - キーはドット区切りの名前空間(tab.*, action.*, settings.* …)
// - {name} 形式のプレースホルダを params で差し込む
// - 未訳キーは ja にフォールバックし、それも無ければキー文字列を返す
//
// 相互アップデートの要:
//   ja と en は「同じキー集合」であることを scripts/check-i18n.mjs が保証する。
//   片方だけキーを足して壊れる事故を npm test で機械的に防ぐ。
// ============================================================

export const LANGS = ['ja', 'en'];
export const DEFAULT_LANG = 'ja';

export const MESSAGES = {
  ja: {
    // 下部タブ
    'tab.home': 'ホーム',
    'tab.score': 'スコア入力',
    'tab.order': 'オーダー',
    'tab.stats': '成績',
    'tab.result': '試合結果',
    'tab.settings': '設定',
    // 共通アクション
    'action.confirm': '確定',
    'action.cancel': 'キャンセル',
    'action.close': '閉じる',
    'action.add': '追加',
    'action.delete': '削除',
    'action.save': '保存',
    'action.back': '← 戻る',
    // 設定: 言語
    'settings.language': '言語',
    'settings.language.hint': 'アプリ全体の表示言語を切り替えます(記録済みのログはそのままの言語で残ります)。',

    // 打撃結果(結果パッド・凡打の種類・三振の種類のボタン表示用。
    // 保存済みプレイログの文言はRESULTS.label(model.js)のまま日本語固定 — 記録の正確さ優先)
    'result.single': 'ヒット',
    'result.double': 'ツーベース',
    'result.triple': 'スリーベース',
    'result.hr': 'ホームラン',
    'result.out': '凡打(アウト)',
    'result.so': '三振',
    'result.bb': '四球',
    'result.hbp': '死球',
    'result.error': 'エラー',
    'result.sacBunt': 'バント',
    'result.sacFly': '犠牲フライ',
    'result.interference': '打撃妨害',
    'result.fieldInterference': '守備妨害',
    'result.obstruction': '走塁妨害',
    'outType.ground': 'ゴロ',
    'outType.fly': 'フライ',
    'outType.liner': 'ライナー',
    'outType.dp': 'ダブルプレー',
    'soType.swinging': '空振り三振',
    'soType.looking': '見逃し三振',

    // 試合セットアップ(スコア入力タブ)
    'gamesetup.title': '新しい試合を開始',
    'gamesetup.opponent': '対戦相手',
    'gamesetup.opponent.placeholder': '対戦相手名',
    'gamesetup.season': 'シーズン/大会名(任意)',
    'gamesetup.season.placeholder': '例: 2026春季大会',
    'gamesetup.first': '先攻',
    'gamesetup.second': '後攻',
    'gamesetup.start': '試合開始',
    'gamesetup.resume.title': '進行中の試合を再開',
    'gamesetup.resume.vs': 'vs',
    'gamesetup.resume.button': '再開',
    'gamesetup.opponent.fallback': '対戦相手',

    // スコアボード
    'scoreboard.batting': '⚔️ 攻撃中',
    'scoreboard.fielding': '🧤 守備中',
    'scoreboard.extra': '延長',
    'scoreboard.top': '{n}回表',
    'scoreboard.bottom': '{n}回裏',
    'scoreboard.innings': '回制',
    'scoreboard.you': '自チーム',
    'scoreboard.opponent': '相手',

    // 投球カウンター
    'pitch.ball': 'ボール',
    'pitch.strike': 'ストライク',
    'pitch.foul': 'ファウル',
    'pitch.swinging': '空振り',
    'pitch.looking': '見逃し',
    'pitch.count.thisAtBat': 'この打席{n}球',
    'pitch.count.first': ' (初球:{label})',
    'pitch.nextStrikeSo': '次のストライクで三振',
    'pitch.nextBallBb': '次のボールで四球',
    'pitch.undo': '↩ 1球取り消し',

    // 打者/走者シート共通
    'sheet.nextBatter': '次の打者を選択',
    'sheet.pinchHitter': '🔄 代打を送る({name}に代えて)',

    // プレイ確定シート(PlaySheet)の見出し
    'playsheet.direction': '打球方向',
    'playsheet.soType': '三振の種類',
    'playsheet.outType': '凡打の種類',
    'playsheet.change': '変更',
    'playsheet.oppBatter': '相手打者: ',

    // 走者イベントシート(塁タップ)
    'base.1': '一塁',
    'base.2': '二塁',
    'base.3': '三塁',
    'base.4': '本塁',
    'runner.noRunner': '{base} (走者なし)',
    'runner.noRunnerHint': 'この塁に走者はいません。修正用に走者を手動配置できます。',
    'runner.place': '走者を置く(修正)',
    'runner.pinch': '🔄 代走を送る({name}に代えて)',
    'runner.courtesyToggle': '🏃 臨時代走({name}の代わりに走る・打順はそのまま)',
    'runner.courtesyHint': '臨時代走を選ぶと、この塁の走者だけが入れ替わります。{name}さんは打順に残り、次の打席で通常どおり出場(復帰)します。',
    'runner.oppPinch': '🔄 相手の代走を送る({name}に代えて)',
    'runner.sbSuccess': '盗塁成功{double} → {base}',
    'runner.sbDouble': '(重盗)',
    'runner.cs': '盗塁死',
    'runner.wp': '暴投(全走者進塁)',
    'runner.pb': '捕逸(全走者進塁)',
    'runner.pickoff': '牽制死',
    'runner.pickoffSafe': '牽制(セーフ)',
    'runner.advance': 'この走者が進塁',
    'runner.score': 'この走者が生還',
    'runner.remove': '走者を消す(修正)',
    'runner.fallback': '走者',
  },
  en: {
    'tab.home': 'Home',
    'tab.score': 'Score',
    'tab.order': 'Lineup',
    'tab.stats': 'Stats',
    'tab.result': 'Results',
    'tab.settings': 'Settings',
    'action.confirm': 'Confirm',
    'action.cancel': 'Cancel',
    'action.close': 'Close',
    'action.add': 'Add',
    'action.delete': 'Delete',
    'action.save': 'Save',
    'action.back': '← Back',
    'settings.language': 'Language',
    'settings.language.hint': 'Switch the display language of the whole app. Already-recorded logs stay in their original language.',

    'result.single': 'Hit',
    'result.double': 'Double',
    'result.triple': 'Triple',
    'result.hr': 'Home Run',
    'result.out': 'Out',
    'result.so': 'Strikeout',
    'result.bb': 'Walk',
    'result.hbp': 'HBP',
    'result.error': 'Error',
    'result.sacBunt': 'Bunt',
    'result.sacFly': 'Sac Fly',
    'result.interference': 'Batter Interf.',
    'result.fieldInterference': 'Fielder Interf.',
    'result.obstruction': 'Obstruction',
    'outType.ground': 'Ground Out',
    'outType.fly': 'Fly Out',
    'outType.liner': 'Line Out',
    'outType.dp': 'Double Play',
    'soType.swinging': 'Swinging K',
    'soType.looking': 'Looking K',

    'gamesetup.title': 'Start a New Game',
    'gamesetup.opponent': 'Opponent',
    'gamesetup.opponent.placeholder': 'Opponent name',
    'gamesetup.season': 'Season / Tournament (optional)',
    'gamesetup.season.placeholder': 'e.g. 2026 Spring League',
    'gamesetup.first': 'Away',
    'gamesetup.second': 'Home',
    'gamesetup.start': 'Start Game',
    'gamesetup.resume.title': 'Resume Ongoing Game',
    'gamesetup.resume.vs': 'vs',
    'gamesetup.resume.button': 'Resume',
    'gamesetup.opponent.fallback': 'Opponent',

    'scoreboard.batting': '⚔️ Batting',
    'scoreboard.fielding': '🧤 Fielding',
    'scoreboard.extra': 'Extra ',
    'scoreboard.top': 'Top {n}',
    'scoreboard.bottom': 'Bot {n}',
    'scoreboard.innings': ' innings',
    'scoreboard.you': 'You',
    'scoreboard.opponent': 'Opponent',

    'pitch.ball': 'Ball',
    'pitch.strike': 'Strike',
    'pitch.foul': 'Foul',
    'pitch.swinging': 'Swing',
    'pitch.looking': 'Look',
    'pitch.count.thisAtBat': '{n} pitches this AB',
    'pitch.count.first': ' (1st: {label})',
    'pitch.nextStrikeSo': 'Next strike = K',
    'pitch.nextBallBb': 'Next ball = BB',
    'pitch.undo': '↩ Undo last pitch',

    'sheet.nextBatter': 'Select Next Batter',
    'sheet.pinchHitter': '🔄 Pinch hit (for {name})',

    'playsheet.direction': 'Batted Ball Direction',
    'playsheet.soType': 'Strikeout Type',
    'playsheet.outType': 'Out Type',
    'playsheet.change': 'Change',
    'playsheet.oppBatter': 'Opp. Batter: ',

    'base.1': '1st',
    'base.2': '2nd',
    'base.3': '3rd',
    'base.4': 'Home',
    'runner.noRunner': '{base} (no runner)',
    'runner.noRunnerHint': 'No runner on this base. You can manually place one to correct the record.',
    'runner.place': 'Place Runner (correction)',
    'runner.pinch': '🔄 Pinch run (for {name})',
    'runner.courtesyToggle': '🏃 Courtesy runner (for {name}, lineup unchanged)',
    'runner.courtesyHint': 'Choosing a courtesy runner swaps only the runner on base. {name} stays in the lineup and bats normally next time.',
    'runner.oppPinch': '🔄 Opp. pinch run (for {name})',
    'runner.sbSuccess': 'Stolen Base{double} → {base}',
    'runner.sbDouble': ' (double steal)',
    'runner.cs': 'Caught Stealing',
    'runner.wp': 'Wild Pitch (all advance)',
    'runner.pb': 'Passed Ball (all advance)',
    'runner.pickoff': 'Picked Off',
    'runner.pickoffSafe': 'Pickoff (safe)',
    'runner.advance': 'This runner advances',
    'runner.score': 'This runner scores',
    'runner.remove': 'Remove Runner (correction)',
    'runner.fallback': 'Runner',
  },
};

// 純関数の翻訳。React非依存なので任意の場所から呼べる。
export function translate(lang, key, params) {
  const table = MESSAGES[lang] || MESSAGES[DEFAULT_LANG];
  let s = table[key];
  if (s == null) s = MESSAGES[DEFAULT_LANG][key];
  if (s == null) return key; // 未定義キーはキー名をそのまま出す(開発時に気づける)
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

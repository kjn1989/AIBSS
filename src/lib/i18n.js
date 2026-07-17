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

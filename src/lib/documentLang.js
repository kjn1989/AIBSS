// 文書そのものの言語表示(<html lang> / タイトル / manifest)。
//
// index.html は静的なので、何もしないと日本語のまま英語のユーザーに配られる。
// ここが効くのは画面の中ではなく、その外側:
//   <html lang> … スクリーンリーダーの読み上げと、ブラウザの翻訳提案が見る
//   <title>     … タブの名前、共有したときのリンク名
//   manifest    … ホーム画面に追加したときのアプリ名
//
// 起動時(main.jsx)と、言語を切り替えた瞬間(App.jsx)の両方から呼ぶ。
// 起動時だけだと、切り替えても次に開くまでタブの名前が古いままになる。
export const TITLES = {
  ja: 'AI-BASE DIAMOND — AI野球スコア＆成績',
  en: 'AI-BASE DIAMOND — Baseball Score & Stats',
};

export function applyDocumentLang(lang) {
  const en = lang === 'en';
  document.documentElement.lang = en ? 'en' : 'ja';
  document.title = en ? TITLES.en : TITLES.ja;
  // manifest は静的なファイルなので言語ごとに1本ずつ持ち、link を差し替える
  const mf = document.querySelector('link[rel="manifest"]');
  if (mf) mf.setAttribute('href', en ? './manifest.en.webmanifest' : './manifest.webmanifest');
}

// 起動時用: ストアの初期化より前に要るので、保存済みJSONから直接読む
export function langFromStorage(key) {
  try {
    const raw = key ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw)?.settings?.lang || 'ja') : 'ja';
  } catch {
    return 'ja'; // 壊れていても既定で続ける
  }
}

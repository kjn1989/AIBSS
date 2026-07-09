// ============================================================
// AI-BSS公式クラウド(運営ホスト型Firebase)の接続設定
// 全ユーザー共通の「公式」Firebaseプロジェクトへの接続情報。
// FirebaseのWebアプリconfigは公開されても安全な値(権限はfirestore.rulesが強制する)。
//
// 設定の優先順位:
//   1. localStorage 'bbscorer.officialConfig' … 検証・エミュレータ用の一時上書き
//   2. ビルド時env VITE_AIBSS_OFFICIAL_CONFIG … Vercelの環境変数にJSON文字列で設定(本番推奨)
//   3. 下の FILE_CONFIG … リポジトリに直接貼る場合
// いずれも無ければ公式クラウド機能は「準備中」表示になる(ローカル/旧同期はそのまま動く)。
// セットアップ手順: docs/firebase-setup.md
// ============================================================

// AI-BSS公式クラウドの本番接続情報(公開可: アクセス制御はfirestore.rulesがサーバ側で強制)
const FILE_CONFIG = {
  apiKey: 'AIzaSyBX16jLR0M_y2ZCyp6742Mt9ITOKOHjP0w',
  authDomain: 'aibss-55619.firebaseapp.com',
  projectId: 'aibss-55619',
  storageBucket: 'aibss-55619.firebasestorage.app',
  messagingSenderId: '118549046137',
  appId: '1:118549046137:web:101c3e18bbcb13968145a8',
};

export function getOfficialConfig() {
  try {
    const ls = localStorage.getItem('bbscorer.officialConfig');
    if (ls) return JSON.parse(ls);
  } catch {
    /* 破損時は無視して次へ */
  }
  try {
    const env = import.meta.env.VITE_AIBSS_OFFICIAL_CONFIG;
    if (env) return JSON.parse(env);
  } catch {
    /* JSONとして不正なら無視 */
  }
  return FILE_CONFIG;
}

export function officialAvailable() {
  const cfg = getOfficialConfig();
  return !!(cfg && cfg.apiKey && cfg.projectId);
}

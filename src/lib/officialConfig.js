// ============================================================
// AI-BSS公式クラウド(Supabase)の接続設定
// 全ユーザー共通の「公式」Supabaseプロジェクトへの接続情報。
// URLとanonキーは公開されても安全な値(権限はRLS: supabase/schema.sql が強制する)。
// Supabase無料プランはカード登録が不要なため、従量課金が構造的に発生しない。
//
// 設定の優先順位:
//   1. localStorage 'bbscorer.officialConfig' … 検証用の一時上書き
//   2. ビルド時env VITE_AIBSS_OFFICIAL_CONFIG … VercelにJSON文字列で設定する場合
//   3. 下の FILE_CONFIG … リポジトリに直接貼る場合(推奨)
// いずれも無ければ公式クラウド機能は「準備中」表示になる(ローカル/旧同期はそのまま動く)。
// セットアップ手順: docs/supabase-setup.md
// ============================================================

const FILE_CONFIG = null;
// 例:
// const FILE_CONFIG = {
//   url: 'https://xxxx.supabase.co',
//   anonKey: 'eyJhbGciOi...',
// };

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
  return !!(cfg && cfg.url && cfg.anonKey);
}

# AI-BASE公式クラウド セットアップ手順(運営者向け・Supabase版)

AI-BASE公式クラウドは、運営者が1つ持つSupabaseプロジェクトを全チームで共用する仕組みです。
権限は `supabase/schema.sql` のRLS(行レベルセキュリティ)がサーバ側で強制します。

**Supabaseを選んだ理由**: 無料プランは**クレジットカード登録自体が不要**なため、
従量課金が構造的に発生しません(上限到達時はサービスが止まるだけで請求は発生しない)。
無料枠: DB 500MB / 月間アクティブユーザー5万人 / 東京リージョン選択可。

## 1. Supabaseプロジェクトを作成

1. https://supabase.com → Start your project → GitHubアカウントかメールでサインアップ
2. New project → Name: `aibss` / Database Password: 「Generate a password」でOK /
   Region: **Northeast Asia (Tokyo)** → Create new project(Freeプランのまま)

## 2. スキーマとRLSを設定

1. 左メニュー **SQL Editor** → New query
2. リポジトリの `supabase/schema.sql` の中身を**全文貼り付け** → **Run**
   (テーブル・権限ポリシー・リアルタイム配信設定がまとめて作られます)

## 3. 認証設定(確認メールをオフに)

1. 左メニュー **Authentication** → **Sign In / Providers**(または Settings)
2. **Email** プロバイダの設定で「**Confirm email**」を**オフ**にして保存
   (オンのままだと新規登録時にメール確認が必要になり、Supabase既定のメール送信は
   頻度制限が厳しいため、オフ推奨。パスワード方式なのでメール送信自体が不要になる)

## 4. アプリに接続情報を設定

1. 左メニュー **Settings(歯車) → API** から以下の2つを取得:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** キー(公開されても安全。権限はRLSが強制)
2. `src/lib/officialConfig.js` の `FILE_CONFIG = null` を書き換えてpush:
   ```js
   const FILE_CONFIG = {
     url: 'https://xxxx.supabase.co',
     anonKey: 'eyJhbGciOi...',
   };
   ```
   (またはVercelの環境変数 `VITE_AIBSS_OFFICIAL_CONFIG` に同内容の1行JSON)

## 5. 動作確認

1. アプリの設定タブ → 「☁️ AI-BASE公式クラウド」がログインUIに変わる
2. メール+パスワードでログイン(初回は自動登録) → 「このチームをクラウドに登録」
3. 「記録係を招待」で招待リンクを発行 → 別端末/別アカウントで開いて参加
4. 片方でスコア入力 → もう片方に反映されれば完了

## 運用メモ

- **権限**: 管理者(owner)=全部+メンバー管理 / 記録係(scorer)=入力可 / 観戦(viewer)=閲覧のみ
- **招待リンク**: 14日で失効。ownerのみ発行可能
- **休眠**: 無料プランは1週間アクセスが無いとプロジェクトが一時停止する
  (ダッシュボードの「Restore/Resume」で再開)。**休止中はDNSごと消える**ため、
  アプリ側は「Load failed」(接続不可)になる点に注意。
  対策として `.github/workflows/supabase-keepalive.yml` が毎日1回RESTへ
  軽量pingを送り、休止を自動的に防いでいる(GitHub Actions無料枠内)。
  ※GitHubの仕様でリポジトリに60日間更新が無いとスケジュール実行が
  自動停止するため、その際はActionsタブから再有効化する。
- **メール確認**: 確認メールは使わない運用(手順3でオフ推奨)。加えて
  `auth.users` へのBEFORE INSERTトリガ `auto_confirm_email_trigger` で新規ユーザーを
  自動的に確認済みにしている。これによりメール到達に依存せず登録できる。
- **パスワード復旧(メール送信を使わない前提)**:
  - チームメイト(記録係・観戦)が忘れた場合は、別メールで登録し直して招待リンクを
    再度開けば再参加できる(データはチームに紐づくため消えない)。
  - 管理者本人や、どうしても同じアカウントを復旧したい場合は、SupabaseのSQL Editorで
    パスワードを再設定する:
    ```sql
    create extension if not exists pgcrypto with schema extensions;
    update auth.users
    set encrypted_password = extensions.crypt('新しいパスワード', extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now())
    where email = 'user@example.com';
    ```
- **旧方式**(自前Firebase+チームコード)は「上級者向け」として併存。公式クラウド接続中は使われない
- **検証**: `e2e/stage12-official.mjs` はUI状態の確認。フル同期フローの検証は実プロジェクトで
  手動確認(手順5)を行う

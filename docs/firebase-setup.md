# AI-BSS公式クラウド セットアップ手順(運営者向け)

AI-BSS公式クラウドは、運営者が1つ持つFirebaseプロジェクトを全チームで共用する仕組みです。
権限は `firestore.rules`(リポジトリ同梱)がサーバ側で強制します。
所要時間: 約10〜15分。無料枠(Sparkプラン)で開始でき、数百チーム規模まで概ね無料で運用できます。

## 1. Firebaseプロジェクトを作成

1. https://console.firebase.google.com/ → 「プロジェクトを追加」
2. プロジェクト名: `aibss` など(何でも可)。Googleアナリティクスは不要(オフでよい)

## 2. Webアプリを登録して接続情報を取得

1. プロジェクトの概要 → Webアイコン(`</>`) → アプリのニックネーム `aibss-web` で登録
2. 表示される `firebaseConfig` の値を控える(**apiKey / authDomain / projectId / appId** があれば十分)
   - この値は公開されても安全です(アクセス制御はセキュリティルールが行う)

## 3. Authentication(ログイン)を有効化

1. 構築 → Authentication → 始める
2. 「ログイン方法」タブで以下を有効化:
   - **Google** … プロジェクトのサポートメールを選んで有効化
   - **メール/パスワード** … 有効化し、その中の「**メールリンク(パスワードなしでログイン)**」もオンにする
3. 「設定」タブ → 承認済みドメイン に `aibss.vercel.app` を追加(localhostは最初から入っている)

## 4. Firestoreを作成してルールを設定

1. 構築 → Firestore Database → 「データベースの作成」
   - ロケーション: `asia-northeast1`(東京) 推奨
   - **本番環境モード**で開始
2. 「ルール」タブに、リポジトリの `firestore.rules` の内容を**全文コピペ**して「公開」

## 5. アプリに接続情報を設定

どちらか片方でOK(推奨はA):

**A. Vercelの環境変数(推奨)**
1. Vercel → プロジェクト → Settings → Environment Variables
2. Name: `VITE_AIBSS_OFFICIAL_CONFIG`
   Value: 手順2のconfigを**1行のJSON**で:
   ```
   {"apiKey":"AIza...","authDomain":"aibss-xxxx.firebaseapp.com","projectId":"aibss-xxxx","appId":"1:1234:web:abcd"}
   ```
3. Redeploy(Deployments → 最新 → Redeploy)

**B. リポジトリに直接記載**
`src/lib/officialConfig.js` の `FILE_CONFIG = null` を config オブジェクトに書き換えてpush。

## 6. 動作確認

1. アプリの 設定タブ → 「☁️ AI-BSS公式クラウド」が「準備中」からログインUIに変わる
2. Googleでログイン → 「このチームをクラウドに登録」
3. 「記録係を招待」で招待リンクを発行 → 別端末/別アカウントで開いて参加
4. 片方でスコア入力 → もう片方に反映されれば完了

## 運用メモ

- **無料枠(Spark)**: ストレージ1GiB・読取5万/日・書込2万/日。超えそうになったらBlaze(従量)へアップグレード
- **権限**: 管理者(owner)=全部+メンバー管理 / 記録係(scorer)=入力可 / 観戦(viewer)=閲覧のみ
- **招待リンク**: 14日で失効。漏れても期限切れ後は無効。必要ならFirestoreコンソールで `invites` から削除可能
- **旧方式**(自前Firebase+チームコード)は「上級者向け」として併存。公式クラウド接続中のチームでは使われない
- **ローカル検証**: `npx firebase-tools emulators:start` + localStorageに
  `bbscorer.officialConfig = {"apiKey":"demo","authDomain":"localhost","projectId":"demo-aibss","appId":"demo","emulator":true}`
  を設定するとエミュレータに接続する(e2e/stage12-official.mjs 参照)

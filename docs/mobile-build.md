# AI-BASE DIAMOND — iOS/Androidアプリ化ガイド(Capacitor)

このリポジトリは [Capacitor](https://capacitorjs.com/) で iOS/Android のネイティブラッパーに対応済みです。
`android/` `ios/` ディレクトリに実際のネイティブプロジェクトが生成・コミットされています。

**この開発環境(Linux・Xcodeなし・Android SDKなし)でできたのはここまでです。**
実機ビルド・実機テスト・ストア申請は、Mac(iOS用)またはAndroid Studio導入済み環境(Android用)が必要で、
その先の作業はお手元の環境で行っていただく必要があります。以下、何が済んでいて何が残っているかを正直に書きます。

## 済んでいること

- `@capacitor/core` `@capacitor/cli` `@capacitor/ios` `@capacitor/android` 導入
- `@capacitor/app`(戻るボタン)`@capacitor/status-bar`(ステータスバー)`@capacitor/splash-screen`(起動画面)導入・配線済み
- `capacitor.config.json` 作成(webDir=dist、ダーク基調のステータスバー/スプラッシュ設定)
- `npx cap add ios` / `npx cap add android` でネイティブプロジェクト生成済み(`ios/` `android/` にコミット)
- `src/lib/nativeBridge.js`: ネイティブ実行時のみ動く薄いブリッジ層
  - 起動時にステータスバー色・スプラッシュ非表示を制御(Web版では何もしない)
  - Androidの物理/ジェスチャー「戻る」: ホーム以外のタブならホームへ、ホームなら最小化(誤操作でアプリごと終了しない)
- `npm run cap:sync` / `cap:open:ios` / `cap:open:android` スクリプト追加
- 既存のPWA/Web版は無改造で動作(全テスト green。ネイティブ判定は`Capacitor.isNativePlatform()`でガードしているため、Web版では常にno-op)

## 必ず確認・変更が必要なこと

### 1. `appId` はプレースホルダです

`capacitor.config.json` の `"appId": "app.aibss.diamond"` は仮の値です。App Store Connect / Google Play Console
に登録する正式なBundle ID(逆ドメイン形式、例: `com.yourcompany.aibase`)に**必ず**差し替えてください。
一度ストアに登録すると変更できないため、最初に確定させる必要があります。

変更後は `npx cap sync` を再実行してください。

### 2. アイコン・スプラッシュ画像

現状のPWAアイコン(192px/512px)はストア申請に必要な全サイズを満たしていません。
Mac側で以下を実行し、`public/brand/icon-lockup-1024.png`(高視認性ロゴの1024px版、既に生成済み)を元に
各サイズを自動生成してください:

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#0d1117' --splashBackgroundColor '#0d1117'
```

### 3. 音声入力(Web Speech API)はネイティブWebViewでは動きません — 重要

これがこのアプリのCapacitor化における**最大の技術的注意点**です。

- 現在の音声入力は `window.SpeechRecognition` / `window.webkitSpeechRecognition`(Web Speech API)に依存しています。
- これは **iOS の WKWebView / Android の System WebView(＝Capacitorアプリの中身)では利用できません**。
  Web Speech APIはSafari/Chromeという「フルブラウザ」だけが公開している機能で、埋め込みWebViewには公開されないためです。
- **アプリは壊れません**。`src/lib/speech.js` の `speechAvailable()` が `false` を返すため、既存のフォールバック
  (`src/components/VoiceControl.jsx` の「またはテキストで実況を入力」)に自動で切り替わります。
- ただし「手放しで音声入力」という目玉機能が、ネイティブアプリ版では**事実上使えなくなります**。

**対応するには**(Phase 3として別途着手を推奨):
`@capacitor-community/speech-recognition` のようなネイティブブリッジプラグイン(iOS: `SFSpeechRecognizer` /
Android: `SpeechRecognizer` を呼ぶ)を導入し、`lib/speech.js` の `createRecognizer()` をネイティブ実行時は
そちらに差し替える。既存の `createContinuousRecognizer`(常時リスニング)や確認フローはそのまま使い回せる設計に
なっているため、差し替えコスト自体は限定的です。

### 4. データ保存について(朗報)

これまでのレビューで指摘していた「iOS SafariのITPによるストレージ自動削除」リスクは、**ネイティブアプリ化そのもの
で解消されます**。ITPはSafari(ブラウザ)上のWebストレージが対象で、CapacitorアプリのWKWebViewはアプリの
サンドボックス領域を使うため対象外です。追加対応は不要です。

## ビルド手順(お手元の環境で)

### iOS(要: Mac + Xcode + CocoaPods)

```bash
npm run cap:open:ios
```

Xcodeが開くので:
1. `ios/App` の Signing & Capabilities で開発チーム(Apple Developer アカウント)を設定
2. Bundle Identifier が `capacitor.config.json` の appId と一致していることを確認
3. 実機/シミュレータで ▶ 実行

### Android(要: Android Studio)

```bash
npm run cap:open:android
```

Android Studioが開くので、Gradle同期後に実機/エミュレータで実行してください。

## ストア申請前に確認すべきこと(前回レビューの再掲)

- **プライバシーポリシーURL**: 両ストアで必須。Supabase(email等)・Geminiキー(ユーザー自身が入力)の扱いを明記
- **App Privacy申告(iOS)**: Supabaseに保存するデータ項目(email、チームデータ)を正確に申告
- **少年野球エディションを「子供向け」カテゴリに登録しない**: 登録すると審査基準が大幅に厳しくなる
- **iOS 4.2(Minimum Functionality)対策**: 「ただのWebラッパー」と判定されると却下されるリスクがある。
  ネイティブの戻るボタン制御(実装済み)に加え、ネイティブ音声認識(§3)やカメラ統合など、Web版に無い
  ネイティブならではの機能を用意できると審査上有利
- **開発者アカウント**: Apple Developer Program(年間$99)/ Google Play Developer(初回$25)が別途必要
- **Gemini BYOK**: 一般配布時はユーザー自身のAPIキー入力が障壁になりやすい。有料プラン等で運営側キー経由の
  AIプロキシを用意する設計(`docs/monetization-and-backend-design.md`)と合わせて検討を

## ディレクトリ構成の補足

- `android/` `ios/`: ネイティブプロジェクト本体。Web版のビルド成果物(`dist/`)は `npm run cap:sync` の
  たびに `android/app/src/main/assets/public` / `ios/App/App/public` へ上書きコピーされるので、
  Web側のソースを直接編集してsyncし直せばアプリ側にも反映される(ネイティブ側のソース自体は編集不要)。
- ネイティブプロジェクトの `.gitignore` は Capacitor テンプレート標準のもの(ビルド生成物のみ除外)。

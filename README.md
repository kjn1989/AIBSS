# ⚾ 野球 音声実況＆直感タップUIスコアラー

野球チームの仲間がスマホ(iPhone/Android)のブラウザで使う、
**音声実況＋タップ入力のスコアラーPWA** です。
ストア配布は不要 — URLを配って各自がブラウザで開き、「ホーム画面に追加」して使います。

- **React SPA**(状態管理はuseReducer + Contextのみ)・ダークモードUI・片手操作前提
- **PWA**: ホーム画面追加・オフラインでも基本操作が完全動作(localStorage自動保存)
- **クラウド共有(任意)**: Firebase Firestoreでチーム全員がリアルタイム同期。未設定ならローカルのみで完全動作
- **音声実況**: Web Speech API(ja-JP) + ルールベース曖昧解釈エンジン(+任意でLLM API連携)
- **CSV出力**: 全成績・全プレイログをダウンロード / LINE等へ共有(スプレッドシート貼り付け対応)

---

## セットアップ・起動

必要環境: Node.js 18+

```bash
cd baseball-scorer
npm install        # react / react-dom / firebase / vite / @vitejs/plugin-react
npm run dev        # 開発サーバー http://localhost:5173
npm run build      # 本番ビルド → dist/
npm run preview    # ビルド済みの確認 http://localhost:4173
```

スマホ実機で開発版を試す場合: `npx vite --host` でLAN内のIPからアクセス。
**音声認識(マイク)はHTTPSまたはlocalhostでのみ動作**します。実機ではデプロイ先のHTTPS URLで使ってください。

## デプロイ(いずれか1つでOK)

### A. Vercel(最速・おすすめ)
```bash
npm i -g vercel
cd baseball-scorer
vercel          # 初回は質問に答える。Framework: Vite / Output: dist
vercel --prod   # 本番URL発行 → このURLをチームに配る
```

### B. Netlify
```bash
npm i -g netlify-cli
cd baseball-scorer
npm run build
netlify deploy --prod --dir=dist
```

### C. Firebase Hosting(Firestoreと同一プロジェクトにまとめたい場合)
```bash
npm i -g firebase-tools
firebase login
cd baseball-scorer
firebase init hosting   # public: dist / SPA: Yes
npm run build
firebase deploy --only hosting
```

デプロイ後、スマホで開いて共有メニューから **「ホーム画面に追加」** すればアプリとして起動します。

---

## クラウド共有(Firebase Firestore)の設定 — 任意

1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクト作成
2. 「Firestore Database」を作成(本番モードで作成し、下記ルールを設定)
3. プロジェクト設定 → マイアプリ → Webアプリ追加 → `firebaseConfig` をコピー
4. アプリの ⚙️設定 → 「クラウド共有」に config を貼り付け、チーム共通の**チームコード**(合言葉)を入力 → 共有を開始
5. チーム全員が同じ config + チームコードを入力すれば、試合データがリアルタイム同期されます

Firestoreセキュリティルールの例(チームコードを知っている人のみ読み書き可能な最小構成):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /teams/{teamCode}/{document=**} {
      allow read, write: if true;  // 簡易運用: チームコードが実質の合言葉
    }
  }
}
```

> 本格運用ではFirebase Authentication(匿名認証等)の追加を推奨します。
> データ構造: `teams/{チームコード}/games/{gameId}` と `teams/{チームコード}/players/{playerId}`。
> ローカル(localStorage)とFirestoreは**完全に同一のスキーマ**で、updatedAtによるLast-Write-Winsで同期します。

## 音声入力のLLM拡張 — 任意

⚙️設定 → 「音声入力の設定」でLLM解釈をONにし、Anthropic APIキーを入力すると、
オフラインエンジンの信頼度が低い発話だけLLM(claude-haiku)に構造化解釈を依頼します。
**未設定でもオフラインのルールエンジンだけで完全動作**します。

---

## ファイル構成

```
baseball-scorer/
├── index.html                 # PWAメタタグ・エントリ
├── package.json
├── vite.config.js             # firebaseを別チャンクに分割
├── public/
│   ├── manifest.webmanifest   # PWAマニフェスト
│   ├── sw.js                  # Service Worker(オフラインキャッシュ)
│   └── icon-*.png             # アイコン
├── src/
│   ├── main.jsx               # エントリ + SW登録
│   ├── App.jsx                # タブ構成(ホーム/スコア入力/オーダー/成績/投手 + 設定)
│   ├── styles.css             # ダークモードUI一式
│   ├── state/
│   │   └── store.jsx          # useReducer+Context。全ゲームロジック・Undo履歴・永続化
│   ├── lib/
│   │   ├── model.js           # データ設計: Player/Game/AtBat/Pitch/PlayLog/PitchingRecord
│   │   ├── stats.js           # タイトル系13種 + 10大メトリクス集計エンジン
│   │   ├── plays.js           # 進塁提案・打者到達先・進塁打自動判定
│   │   ├── voiceParser.js     # ルールベース発話解釈(同義語辞書+バイグラム曖昧一致)
│   │   ├── speech.js          # Web Speech API(ja-JP)ラッパー
│   │   ├── llm.js             # Anthropic API連携(任意拡張)
│   │   ├── cloud.js           # Firestore接続(設定画面のconfigで動的初期化)
│   │   ├── csv.js             # CSV生成・ダウンロード・Web Share
│   │   └── demo.js            # デモデータ生成
│   └── components/
│       ├── HomeTab.jsx        # タイトルランキング(大カード)
│       ├── ScoreTab.jsx       # スコア入力 + Undoバー
│       ├── OrderTab.jsx       # オーダー・代打代走・再出場警告
│       ├── StatsTab.jsx       # 10大メトリクス詳細ランキング
│       ├── PitchingTab.jsx    # 登板・継投・自責点調整・勝/S
│       ├── SettingsTab.jsx    # 選手登録・クラウド・CSV・LLM設定
│       ├── VoiceControl.jsx   # 音声実況FAB+確認カード
│       ├── CloudSync.jsx      # Firestore双方向同期(ヘッドレス)
│       ├── PlaySheet.jsx      # プレイ確定シート(進塁編集・自責点帰属)
│       ├── PitchCounter.jsx   # B/S/Fカウンター
│       ├── Diamond.jsx        # 走者ダイヤモンド
│       ├── RunnerEventSheet.jsx # 盗塁/暴投/捕逸/牽制死
│       ├── ResultPad.jsx      # 打撃結果12種パッド
│       ├── Scoreboard.jsx     # スコアボード
│       ├── GameScopeToggle.jsx  # 試合単位/シーズン通算トグル
│       └── Sheet.jsx          # 汎用ボトムシート
└── e2e/                       # Playwrightスモークテスト(各段階の動作確認)
```

## データ設計(ローカル/Firestore共通スキーマ)

- **Player** `{ id, name, number, createdAt }`
- **Game** `{ id, date, opponent, isHome, status, inning, isTop, outs, runners{1,2,3}, myScore, oppScore, lineup[], usedPlayerIds[], retiredPlayerIds[], batterIndex, currentPitcherId, atBats[], playLogs[], pitchingRecords[], updatedAt }`
- **AtBat** `{ id, gameId, playerId, order, result, outType, direction, rbi, runsOnPlay, pitches[], pitchCount, firstPitch, firstPitchHit, snapshot{ runners, outs, inning, isTop, scoreDiff }, advSuccess, clutch, ts }`
  — **打席開始時スナップショット**を必ず保持し、RISP・進塁打・クラッチ判定に使用
- **Pitch** `{ type: 'ball'|'strike'|'foul'|'inplay', ts }` (AtBat.pitchesに格納)
- **PlayLog** `{ id, gameId, inning, isTop, kind, text, payload, ts }`
- **PitchingRecord** `{ id, gameId, playerId, appearanceOrder, outsRecorded, runs, earnedRuns, hitsAllowed, walks, hitByPitch, strikeouts, pitches, win, save }`
- 走者は `{ playerId, pitcherId }` を持ち、**継投を跨いだ走者の自責点帰属**を管理

## スタッツ定義

**ホーム(タイトル系・同数同順位)** — 打者: 安打/打点/得点/本塁打/二塁打/三塁打/盗塁/四死球/塁打、投手: 勝利/奪三振/セーブ/ホールド/投球回

**成績タブ(10大メトリクス・分母0は「-」)**
1. 打率 = 安打÷打数(打数 = 打席−四死球−犠打−犠飛−打撃妨害)
2. 得点圏打率 = 走者二塁or三塁時の安打÷該当打数(スナップショットから判定)
3. OPS = OBP + SLG(OBP=(安打+四球+死球)÷(打数+四球+死球+犠飛)、SLG=塁打÷打数)
4. 進塁打成功率 = 走者あり凡打で走者を進めた数÷走者あり凡打総数
5. PPA = 総投球数÷打席数
6. クラッチ打数 = 先制・同点・逆転・勝ち越し打の合計(打席開始時点差+打点から自動判定)
7. 初球安打率 = 初球打ち安打÷初球打ち打席数
8. 防御率(7回換算) = 自責点÷投球回×7
9. WHIP = (被安打+与四死球)÷投球回
10. K/BB = 奪三振÷与四球(与四球0時は奪三振数+「(与四球0)」注記)

**追加メトリクス** — 打者: 出塁率(OBP)、投手: 被打率(=被安打÷被打数)・ホールド・セーブ。
被打数は守備入力時の相手打者の結果から自動集計(投手タブの詳細調整で手動修正も可)。

---

## 各段階の動作確認手順

ビルドは各段階のコミットで `npm run build` が通ることを確認済み。
e2e/ のスモークテストは `npm run preview` を起動した状態で `node e2e/<file>.mjs` で実行できます。

**第1段階(骨組み)**: ⚙️設定→「デモデータを投入」→ ホームに打者9種+投手4種のタイトルカードが表示され、「試合単位/シーズン通算」トグルが機能する。

**第2段階(タップ入力)**: 設定で選手登録 → スコア入力で試合開始 → 打順自動セット → B/Sをタップ(カウント表示・初球記録) → 「単打」→方向→確定 → ダイヤモンドに走者表示。塁タップで盗塁等。3アウトで自動チェンジ。

**第3段階(スタッツ)**: デモデータ投入 → 成績タブで10メトリクスのチップを切り替え、ランキングが表示される。防御率/WHIPは昇順、K/BBは与四球0で注記表示。

**第4段階(オーダー・投手)**: オーダータブで打順確定 → 「交代」から代打/代走(退いた選手には⚠️警告のみ)。投手タブで先発→継投 → 継投後に残した走者が生還すると確定シートに「自責点の帰属(前投手/現投手)」ダイアログが出る。自責点はステッパーで微調整可能。

**第5段階(音声)**: スコア入力の🎙ボタン →「センター深くに抜けた単打」等を発話(またはテキスト入力) → 大きな確認カードに候補上位3件 → 1タップ確定 or「修正して確定」。

**第6段階(共有・出力・Undo)**: 何か入力すると左下にUndoバー(1タップ取り消し)。⚙️設定→CSV出力で打者成績/投手成績/プレイログ/打席詳細をDL・共有。クラウド共有はconfig+チームコード入力で開始。

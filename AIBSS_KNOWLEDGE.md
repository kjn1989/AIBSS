# AIBSS_KNOWLEDGE.md — AI-BSS 引き継ぎドキュメント

> 別のAIセッション/開発者がこのプロジェクトを引き継ぐための知識集約。
> 最終更新: 2026-07-10(Supabase版公式クラウド移植直後)

---

## 1. プロジェクト概要

**AI-BSS(アイブス / AI Baseball Score & Stats)** は、日本のアマチュア野球チーム向けの
ブラウザベース(PWA)スコア記録・成績管理アプリ。https://aibss.vercel.app で稼働。
リポジトリは `kjn1989/AIBSS`、`main` へのpushでVercelが自動デプロイする。

- **想定ユーザー**: 草野球チーム、部活(中学・高校・大学)、少年野球の監督・マネージャー・記録係・保護者
- **ビジョン**: 全国のアマチュア野球チームのデータ利活用を底上げし、野球を楽しむ人を増やす
- **エディション制**: 単一コードベースで「草野球 / ブカツ(中高大) / 少年野球」の3エディションを
  チーム設定で切替。UIテーマ色(青/緑/オレンジ)、ルールプリセット、AI機能の可否が連動する
- **基本ワークフロー**: 設定タブで選手登録 → スコア入力タブで試合開始(ルールプリセット選択)→
  打順セット → 1球単位 or 結果だけをタップ/音声で記録 → 試合終了 → 成績タブでランキング・
  個人ページ閲覧 → ハイライト画像/AI新聞/CSVで共有
- **オフラインファースト**: データは端末のlocalStorageが主で、クラウド同期は任意のオプション。
  グラウンドの電波が悪くても完全動作する、が絶対の設計原則

## 2. スコア記録の仕様

### 打撃結果の種別(`src/lib/model.js` の `RESULTS`)
| キー | 表示 | 安打 | 打数(AB)算入 | 出塁 |
|---|---|---|---|---|
| single/double/triple/hr | 単打/二塁打/三塁打/本塁打 | ○ | ○ | ○ |
| out | 凡打(内訳: ゴロ/フライ/ライナー/併殺打=OUT_TYPES) | × | ○ | × |
| so | 三振(内訳: 空振り/見逃し=SO_TYPES) | × | ○ | × |
| error | 失策出塁 | × | ○ | ○ |
| bb / hbp | 四球 / 死球 | × | × | ○ |
| sacBunt / sacFly | 犠打 / 犠飛 | × | × | × |
| interference | 打撃妨害 | × | × | ○ |

- **打球方向**(`DIRECTIONS`): P/C/1B/2B/3B/SS/LF/CF/RF(スプレーチャートに使用)
- **投球**: 1球ずつ `ball / strike / foul / inplay` をタップ記録(任意)。カウントが
  4ボール/3ストライク相当に達すると四球/三振の確認カードが自動で出る(振り逃げ対応あり:
  三振でも打者を一塁に置ける)。タップ漏れがあっても確定時に最低球数を自動補完
  (`ensureMinimumPitches`: 四球は4球、三振は3球。ファウルは2ストライク分まで有効)
- **走者**: ダイヤモンド上の塁をタップして盗塁/盗塁死/暴投/捕逸/牽制死や進塁を記録。
  打席確定時は `moves: [{from: 1|2|3, to: 2|3|4|'out'}]` で走者移動をまとめて適用
  (4=生還)。3塁走者から順に処理する
- **交代**: 代打・代走・守備交代・投手交代・再出場警告(公式ルールでは再出場不可の注意表示のみで記録は継続可能)
- **相手チーム**: 実名を入力せず記号 **A〜T**(20人)で打順管理。相手打者の結果も同じ
  ResultPadで記録し、自チーム投手の成績(被安打・奪三振・失点・自責点)に反映される。
  継投を跨ぐ失点は「責任投手ダイアログ」で帰属先を選ぶ
- **音声入力**: 「中堅に単打」「四球」「盗塁成功」等の日本語実況をオフラインのルールエンジン
  (`src/lib/voiceParser.js`)が解釈し、信頼度付きの確認カードを表示→タップで確定。
  低信頼時のみ任意でAnthropic APIによるLLM解釈を併用できる(設定でON+APIキー)
- **事後修正**: 過去プレイの結果種別・方向・打点の編集/削除、回別スコアの手動増減(±)、
  投手成績の微調整、Undo(直近50操作のスナップショット)
- **打席スナップショット**: 全打席が開始時状態 `{runners(1/2/3の有無), outs, inning, isTop, scoreDiff}`
  を保持する。RISP・進塁打・クラッチ判定はこのスナップショットが根拠

### 試合ルールエンジン(`src/lib/rules.js`)
- `rules = { innings, mercy: [{after, diff}], pitchLimit: {perGame, warnAt}|null, timeLimitMin|null }`
- エディション別プリセット(草野球7回90分/120分/無制限、学童6回70球、中学7回100球、
  高校9回地方大会コールド、大学9回)+カスタム。**数値は代表例**であり大会要項に合わせて調整可能とする
- **強制終了しない**のが思想: 規定回数終了/X勝ち・サヨナラ/コールド成立/時間切れ
  (草野球の「時間切れ後は新しい回に入らない」慣例)を検知して**提案バナー**を出すだけ。
  記録の主導権は常にユーザー。球数制限は守備時に現投手の球数で警告表示
- 旧データ(rules無し)では全判定が無効(null)になり互換動作

## 3. スタッツ定義(全計算式・`src/lib/stats.js`)

集計は「対象試合の配列 `games` を渡して選手別に合算」する方式。**通算/シーズン(大会)/
試合単位の切替は呼び出し側が games を絞るだけ**(集計エンジンは期間を知らない)。
分母0の指標は `null` を返し、UIで「-」表示(0.000と区別する)。

### 打者(battingMetrics)
- 打席 PA / 打数 AB(AB = RESULTSの `ab: true` のみ加算)
- **打率 BA = H ÷ AB**
- **得点圏打率 RISP = (打席開始時に走者2塁or3塁だった打席の安打) ÷ (同打席の打数)**
- **出塁率 OBP = (H + BB + HBP) ÷ (AB + BB + HBP + 犠飛)**
- **長打率 SLG = 塁打 TB ÷ AB**(TB = 単打1+二塁打2+三塁打3+本塁打4)
- **OPS = OBP + SLG**(どちらかがnullならnull)
- **進塁打成功率 = 進塁打成功 ÷ 進塁打機会**(機会 = 走者ありの凡打(三振除く)。
  成功 = そのプレイで走者が進塁or生還。確定時に手動上書き可)
- **PPA(球/打席) = 総投球数 ÷ PA**
- **クラッチ打数** = 先制打+同点打+逆転打+勝ち越し打の合計(カウント)。判定は打席開始時
  点差×その打席の打点: 負けていて打点後にプラス=逆転 / ゼロ=同点、同点から勝ち越し
  (0-0からは先制)。打点0はクラッチにならない
- **初球安打率 = 初球インプレー安打 ÷ 初球インプレー打席**
- 得点・盗塁は打席レコードではなく**PlayLog(kind: 'run'/'sb')から集計**する(打席外の事象のため)

### 投手(pitchingMetrics)
- 投球回は内部的に**アウト数(outsRecorded)**で保持。表示は `4.2 = 4回2/3`(formatIP)
- **防御率(7回換算) ERA7 = (自責点 ÷ (outsRecorded/3)) × 7** ← 草野球の7回制に合わせ
  9ではなく**7倍**が既定(プロ野球定義と異なる点に注意)
- **WHIP = (被安打 + 与四球 + 与死球) ÷ 投球回** ← 与死球を含める実装(MLB定義は四球のみ)
- **K/BB = 奪三振 ÷ 与四球**。与四球0のときは null とせず「`{奪三振数} (与四球0)`」表示、
  ソートは奪三振数を使う
- **被打率 = 被安打 ÷ 被打数(abFaced)**
- 勝利/セーブ/ホールドは手動付与(勝・Sは1試合1人、Hは複数可)

### タイトル(ホーム画面の👑カード)
打者: 安打王/打点王/得点王/本塁打王/二塁打王/三塁打王/盗塁王/選球眼王(BB+HBP)/塁打王。
投手: 最多勝/奪三振王/セーブ王/ホールド王/イニング王。**同数は同順位で全員表示**。

### CSV取り込み(importedBatting/importedPitching)
過去試合のボックススコア合計値を選手別に保持し、集計時に加算する(プレイ単位の記録なし)。
単打が空欄なら `H−2B−3B−HR`、塁打が空欄なら再計算で補完。空欄は0扱い。

## 4. データモデル

### 永続化(localStorage+IndexedDBミラー)
- チームレジストリ: キー `bbscorer.profiles.v1` = `{ profiles: [{id, name, edition, officialTeamId?, createdAt}], activeId }`
- チームごとのデータ: キー `bbscorer.v1.profile.{id}`(旧単一チーム時代のキー `bbscorer.v1` は
  初回起動時に最初のプロフィールへ自動移行し、ロールバック用に残置)
- 保存対象(PERSIST_KEYS): `players, members, games, currentGameId, settings, demoLoaded`
- IndexedDB(DB名 `aibss`/ストア `kv`)に同じJSONをミラー保存。起動時にlocalStorageが
  消えていたらIDBから復旧(`src/lib/durableStore.js`)。iOSの自動削除対策で
  `navigator.storage.persist()` も要求
- 検証用上書き: `bbscorer.officialConfig`(公式クラウド接続情報)

### 主要スキーマ(ファクトリは `src/lib/model.js`)
```
Player  { id, name, number, createdAt, scoutTags[], scoutCatchphrase, scoutReport, scoutPhoto(dataURL) }
Member  { id, name, role(マネージャー等), participation(回数), scout系同上 }  ← 参加メンバー(試合に出ない人)
Game    { id, date(YYYY-MM-DD), opponent, season, isHome, status(ongoing|finished),
          inning, isTop, outs, runners{1,2,3}, myScore, oppScore,
          lineup[{order,playerId,position}], usedPlayerIds[], retiredPlayerIds[], batterIndex,
          currentPitcherId, oppLineup[{order,letter,position}], opp系各種,
          atBats[], playLogs[], pitchingRecords[], linescore{回:{my,opp}},
          importedBatting[], importedPitching[], rules|null, startedAt, updatedAt }
AtBat   { id, playerId, order, result, outType, soType, direction, rbi, runsOnPlay,
          pitches[{type,ts}], pitchCount, firstPitch, firstPitchHit,
          snapshot{runners,outs,inning,isTop,scoreDiff}, advSuccess, clutch, ts }
PlayLog { id, inning, isTop, kind(atbat|defense|run|sb|runner|sub|pitcher|change|...), text, payload }
PitchingRecord { id, playerId, appearanceOrder, outsRecorded, runs, earnedRuns, hitsAllowed,
          walks, hitByPitch, strikeouts, pitches, abFaced, win, save, hold }
```

### 入出力形式
- **バックアップJSON**: `{ app: 'aibss-baseball-scorer'(旧互換で維持), version: 1, exportedAt,
  players, members, games, currentGameId, settings, demoLoaded }` — ファイル名 `aibss-backup_日付.json`
- **取り込みCSV**(`src/lib/importCsv.js`): セクション形式。`[GAME]`(日付/自チーム/相手/先攻後攻/
  大会/試合メモ)、`[LINESCORE]`(ヘッダ行の数字ラベルで列→回をマップ。「合計」等の非数値列は無視)、
  `[BATTERS]`(名前,背番号,守備位置,打席,打数,安打,二塁打,三塁打,本塁打,打点,四球,死球,三振,犠打,盗塁,得点,メモ)、
  `[PITCHERS]`(名前,投球回,失点,自責点,被安打,与四球,与死球,奪三振,投球数,勝,セーブ,ホールド,メモ)。
  守備位置は数字1〜9/漢字1字/漢字フル/カタカナの表記ゆれを吸収。投球回 `4.2`=4回2/3。
  **必ずUTF-8 BOM付きでDL**(共通の `downloadCSV()` を使う。素のBlobだとExcelが文字化け)。
  `#`行はコメント。「例)」で始まる名前はスキップ。取り込み確認画面で全項目を手修正できる
- **出力CSV**: 打者成績/投手成績/プレイログ/打席詳細(投球シーケンス `B/S/F/X` 文字列付き)

### 公式クラウド(Supabase・`supabase/schema.sql`)
テーブル: `teams(id,name,edition,owner_uid,plan,created_at)` /
`team_members(team_id,uid,role[owner|scorer|viewer],name,email,invite,joined_at)` /
`invites(token,team_id,role,created_by,expires_at)` /
`team_games|team_players|team_crew(team_id,id,data jsonb,updated_at)` —
**dataカラムにlocalStorageと同一形のJSONを丸ごと格納**(移行最小・RLS単純の方針)。
RLSはsecurity definer関数 `member_role(team_id)` で再帰なく判定。招待は `get_invite(token)` RPCのみで
取得可能(テーブルselectはowner限定=トークン列挙防止)。Realtimeはpostgres_changesでRLS適用配信。

## 5. アーキテクチャ

React 18(関数コンポーネント+hooks)+ Vite + 素のCSS(`src/styles.css`、CSS変数でテーマ。
Tailwind不使用)。状態管理は**React標準のuseReducer+Contextのみ**(`src/state/store.jsx`)。

### 主要ファイル
- `src/main.jsx` — 起動順序が重要: 旧データIDB復旧 → チームレジストリ確定(ensureRegistry) →
  アクティブプロフィールのIDB復旧 → mount → persistent storage要求。`?watch=1` は観戦専用ページ
- `src/state/store.jsx` — 全リデューサ(CONFIRM_PLAY が心臓部: 投球確定・走者適用・得点/自責点・
  AtBat/PlayLog生成・チェンジ処理まで一手に担う)。UNDOは試合の深いコピーを履歴スタックに積む方式
- `src/lib/model.js` — スキーマ定義兼ファクトリ、EDITIONS、normalizeEdition(旧表記の移行)
- `src/lib/stats.js` — 集計エンジン(§3)
- `src/lib/rules.js` — ルールエンジン(§2)。純関数で、描画時に判定するだけ(reducerに手を入れない)
- `src/lib/profiles.js` — 複数チームのローカルプロフィール管理(切替はpersist→reload方式)
- `src/lib/durableStore.js` — IndexedDBミラーによるデータ消失対策
- `src/lib/officialCloud.js` + `officialConfig.js` — 公式クラウド(Supabase)の認証/チーム/招待/同期
- `src/lib/cloud.js` — 旧方式(ユーザー自前のFirebase config+チームコード)。上級者向けに併存
- `src/components/CloudSync.jsx` — ヘッドレス同期。公式(officialTeamId)優先、無ければ旧方式。
  受信=MERGE_REMOTE(試合はupdatedAtの新しい方=Last-Write-Wins、選手/参加メンバーはidマージ)、
  送信=800msデバウンスで差分push(送信済みJSON/updatedAtをrefにキャッシュしてループ防止)
- `src/lib/gemini.js` — Gemini連携(モデルは廃止に強い `gemini-flash-latest` エイリアス+
  `thinkingConfig:{thinkingBudget:0}` 必須)。AI選手名鑑/AIスタメン/AI新聞/CSV補完
- `src/lib/voiceParser.js` + `llm.js` — 音声実況の解釈(オフライン規則+任意LLM補助)
- 画面: ScoreTab(入力)/OrderTab/StatsTab(+MemberSection)/HomeTab/ResultTab/SettingsTab、
  PlayerView(個人ページ)/ScoutCard(名鑑)/HeadCoachView(AIスタメン)/ImportCsvView/
  ScoreSheetView(印刷)/NewspaperView/HighlightSheet/WatchView(観戦)
- `e2e/stage1〜12*.mjs` — playwright-coreによる回帰テスト(§8)

### 処理の流れ(1打席)
PitchCounterのタップ → `ADD_PITCH`(pendingバッファ+守備時は投手球数加算) →
結果選択(ResultPad/音声/自動検知) → PlaySheetで走者・打点確認 → `CONFIRM_PLAY` →
走者移動適用・得点/linescore/自責点・AtBat+PlayLog生成・3アウトでチェンジ → 永続化(150msデバウンス)
→ CloudSyncが差分push。

## 6. 設計判断の記録(なぜそうしたか)

- **状態管理にライブラリを使わない**: 依存を最小にし、localStorageと同一形のプレーンJSONを
  そのまま永続化・同期スキーマに使うため。Firestore/Supabaseにも同じ形で入れる(スキーマ一元化)
- **同期はLast-Write-Wins(試合単位)**: 楽観的CRDT等は過剰。1試合を同時編集する記録係は実質1人で、
  観戦者は読むだけという運用実態に合わせた
- **相手チームは記号A〜T**: 相手選手の個人情報を保持しない(プライバシー)+入力コスト削減。
  相手個人成績は追わない割り切り
- **ルールエンジンは「提案のみ」**: 現場の記録は例外だらけ(練習試合の続行等)。自動終了は
  データを壊すリスクの方が大きい
- **エディションは単一エンジン+フラグ切替**(別アプリ2〜3本は不採用): ソロ開発で複数ストア
  申請・保守は持続不可能。機能の大半(入力/音声/統計)は共通。`settings.edition` が
  テーマ・ルールプリセット・AI機能可否に波及する
- **AIスタメン・AI選手名鑑・(将来の)スタメン最適化は草野球限定**: パワプロ風の際どい寸評が
  未成年・部活の文脈に不適切なため。エディションでUIごと非表示
- **AI補完(CSV)は「元データを絶対に上書きしない」**: 空欄のみ埋める。メモの具体的記述と
  線スコアの整合性だけを根拠にし、創作を明示的に禁止するプロンプト
- **名称の変遷**: AIBSS → AI-BASE(アイベース)にリブランド → 「AI Base」系の既存サービス多数と
  判明 → **AI-BSS(アイブス)** で確定(造語で被りゼロ、URL aibss.vercel.appと一致、J-ABSとも区別)。
  ロゴ(ホームベース型五角形ゴールド+AI青+回路風塁線、完全自作SVG)は名称非依存で継続。
  **視覚素材はすべて自作**(他アプリの意匠を参照しない)が標準ルール
- **公式クラウドはFirebase→Supabaseへ移行**: 実装・検証까지Firebaseで完了していたが、
  新規プロジェクトのFirestoreが課金アカウント必須と判明。Google Cloudには支出のハードキャップが
  無く、運営者の「従量課金は絶対不可」の方針と両立しないため、**カード登録自体が不要な**
  Supabase無料プランに全面移植(公開APIを揃えたのでUI変更は最小)。Firebase版の実装と
  エミュレータ検証(11項目)はgit履歴 `a3eab58` 参照
- **選手アカウント/キャリアパスポートは不採用**(運営者判断): アカウントを持つのはチーム運営者
  (owner/scorer/viewer)のみ。選手はチームが持つデータ
- **検討して捨てた案**: 手書きスコアブックのVision OCR直読み(手書きダイヤモンド記法の解釈が
  不安定→CSVテンプレート+メモのAI補完方式に転換)/Firebaseエミュレータ相当のSupabaseローカル
  検証(Docker無し環境のため、UI状態テスト+実プロジェクト手動確認に切替)

## 7. ハマりどころと解決策

- **Gemini**: `gemini-1.5-flash` は完全廃止済み → バージョン固定せず `gemini-flash-latest` を使う。
  さらに `thinkingConfig: { thinkingBudget: 0 }` を入れないと内部思考がトークンを食い潰して
  本文が空になる(finishReason: MAX_TOKENS)
- **CSVのExcel文字化け**: UTF-8 BOM(﻿)必須。ダウンロード経路を必ず共通の `downloadCSV()` に
  通すこと(過去に独自Blob生成で文字化け事故)
- **線スコアの二重計上**: 列を先頭から回番号とみなすと「合計」列を余分な回として加算してしまう。
  ヘッダ行の数字ラベルで列→回をマップし非数値列を無視する実装になっている
- **[GAME]のキー判定順**: 「自チームは先攻か後攻」が「自チーム」の正規表現に先に一致して
  チーム名を上書きするバグがあった。**先攻/後攻の判定をチーム名より先に**置くこと
- **設定のマージ**: 保存データ読み込みで `{...init, ...saved}` とするとsettingsが丸ごと置換され、
  後から追加した設定キーが欠落する。**settingsは必ず既定値とマージ**する(StoreProviderの初期化参照)
- **e2eセレクタ**: `button:has-text("追加")` のような曖昧セレクタはUI追加で壊れる。
  カードで修飾する(`.card:has(h2:has-text("選手登録")) button:has-text("追加")`)
- **Playwrightの `networkidle`**: Firestore/Supabase Realtimeの常時接続があると永遠に来ない。
  同期系の画面では `waitUntil: 'load'` を使う
- **iOSのボトムシート**: `.main` のスクロールコンテキスト内だとタブバー下に潜る →
  `createPortal` でbody直下に描画+表示中は背景スクロールをロック(Sheet.jsx)
- **iOS/SafariのlocalStorage自動削除**: IndexedDBミラー+起動時復旧+`storage.persist()`+
  バックアップ促し(7日で警告)の四段構え
- **Firebaseの落とし穴(2026年時点)**: 新規プロジェクトのFirestore作成はSpark(無料)プランでは
  不可(リージョン問わず課金アカウント必須)。Blazeにハードキャップは無い
- **サンドボックスの癖**: `pkill` が終了コード144を返し `&&` 連結を切る(コマンドを分ける)。
  playwright-coreのimportはリポジトリ直下から実行(node_modules解決)。`vite preview --port 4173` は
  nohup+disownで起動し、curlで200を確認してからテストを回す

## 8. 使い方

### 開発
```
npm install
npm run dev            # 開発サーバ
npx vite build         # 本番ビルド(コミット前に必ず通す)
npx vite preview --port 4173   # e2e用プレビュー
node e2e/stage1-skeleton.mjs   # 各回帰テスト(stage1〜12を全部回すのが習慣)
node scripts/gen-icons.mjs     # ロゴSVGからPWAアイコン再生成
```
- 開発フロー: 機能実装 → 使い捨てのplaywright検証スクリプトで動作確認(確認後削除) →
  **全stageの回帰** → コミット(日本語・なぜを書く) → `main` へpush(=本番デプロイ)
- Vercel: `main` 直結。PWAのSWキャッシュ名は `public/sw.js` の `CACHE`(大きい資産変更時にbump)

### ユーザー操作の典型例
1. 設定タブ: チーム名・エディション・選手登録(またはデモデータ投入で試用)
2. スコア入力タブ: 対戦相手・先攻後攻・ルールプリセット選択 → 試合開始 → 打順自動セット可
3. 記録: 打者カードの下の投球ボタン(B/S/F)→結果パッド→確認シート。または🎤音声
4. 成績タブ: 指標ボタンでランキング切替、選手名タップで個人ページ(名鑑・スプレー・推移)
5. ホームタブ: タイトルカード、CSV取り込み(テンプレDL→記入→アップロード→確認・修正→取り込み)
6. AI機能(任意): 設定タブでGemini APIキーを入れると名鑑寸評/AIスタメン(草野球のみ)/AI新聞/CSV補完が有効化

### 公式クラウド(運営者)
`docs/supabase-setup.md` 参照。要点: Supabase無料プロジェクト作成(東京可)→ SQL Editorで
`supabase/schema.sql` 実行 → Authの「Confirm email」をオフ → Project URLとanonキーを
`src/lib/officialConfig.js` の `FILE_CONFIG` へ → push。ユーザーはメール+パスワードでログインし、
「チームをクラウドに登録」→招待リンク(?ct=トークン)で記録係/観戦を追加。

## 9. 未完了の課題・今後やりたいこと

### 直近(ブロック中/待ち)
- **Supabase実プロジェクトの接続**: 運営者がプロジェクト作成中。URL+anonキーが来たら
  `officialConfig.js` に設定し、docs手順5の実機フロー確認(登録→招待→参加→双方向同期)を行う
- **観戦(viewer)ロールのUI制御**: RLSで書き込みは拒否されるが、UI側はまだ入力可能に見える
  (pushが失敗してエラー表示になる)。viewer時は入力UIを隠す/観戦ページへ誘導する制御が未実装
- 公式クラウドの**マジックリンクは補助扱い**(Supabase既定SMTPの頻度制限)。本格運用時は
  カスタムSMTP設定を検討

### ロードマップ(運営者と合意済みの構想)
- **投手の累積球数管理**(次の有力候補): 現在の球数警告は1試合単位。学童「1日70球」等の
  日/週単位の累積・登板間隔管理を、既存の全試合データから実装できる。少年野球の看板機能になる
- **③確定的スタメン最適化(草野球限定)**: 現行のGemini任せのAIスタメンを、打席データからの
  wOBA風指標+得点期待値シミュレーションによる再現性ある提案に置き換える
- **④プライバシー・法務**: 利用規約/プライバシーポリシー/保護者同意(少年野球)の草案と同意フロー
- **対戦ネットワーク**: 両チームがAI-BSSなら1試合1記録で共有(相手A〜T記号の制約が解ける)
- **大会運営モード**/**卒団・引退アルバム自動生成**/**匿名ベンチマーク**(同年代平均との比較)
- **収益化(¥980チーム買い切り)**: 設計資産が `docs/monetization-and-backend-design.md` と
  `supabase/migrations/0001_init.sql` + `supabase/functions/revenuecat-webhook` にある(未接続)。
  要点: `teams.is_premium` はRevenueCat webhook(service_role)のみが更新/ストア掲載には
  Capacitorでのネイティブ化が別途必要。**今回の公式クラウド(schema.sql)とは別系統の設計**なので、
  統合時に invites方式(現行) と join_team(code)方式(旧設計) の整合を取ること
- タイブレーク走者自動配置、時間制限の残り時間表示、WatchViewの公式クラウド統合 など

### 既知の割り切り
- Supabase同期にオフライン書き込みキューは無い(オフライン時はローカル保存のみ、
  復帰後の変更やリロードで追い付く)。Firestore版はSDKのオフラインキューがあった
- 守備指標(UZR等)は現行データでは計算不能(座標データが無い)。AI分析は攻撃系に限定するのが誠実
- 無料Supabaseは1週間無アクセスで休眠(ダッシュボードから復帰)

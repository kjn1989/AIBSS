# AIBSS 収益化・バックエンド設計（実装準備版）

> 位置づけ: これは「7/8以降にSonnetが実配線するための設計資産」。
> 現行アプリ（Vite PWA + localStorage + 任意Firestore）は一切変更していない。
> `supabase/` 配下のSQL/Edge Functionと `src/lib/entitlement.js` はまだアプリに未接続。

---

## 1. 販売モデルの要点

- **980円・買い切り（非消耗アイテム / non-consumable）**
- **チーム単位ライセンス**: 代表者が1回購入 → `teams.is_premium = true` → 同チームの全メンバーが恒久的にプレミアム機能を利用可
- 権限の真実は常に **サーバー側の `teams.is_premium` 1箇所**。クライアントのフラグは信用しない

### 正直な制約（設計前提として必ず認識すること）
1. **クライアント完結のペイウォールは必ず破られる。** 980円の草野球ツールにコピー対策を作り込むのは過剰投資。「is_premiumは課金webhookだけが立てる」の一線だけ守れば十分。
2. **ストア掲載にはネイティブ化（Capacitor）が別工程で必須。** 今のPWA単体ではStoreKit/Play Billingが使えない。これは7/8以降の大きな一本の作業。
3. **UZR等の守備指標は現行データで計算不能**（座標・リーグ平均が要る）。AI分析は攻撃特化が誠実な範囲。

---

## 2. データベーススキーマ（Supabase / Postgres）

実SQLは `supabase/migrations/0001_init.sql`。要旨：

| テーブル | 役割 | キモ |
|---|---|---|
| `teams` | チーム＋課金ステータス | `is_premium` はトリガでユーザー更新を拒否。webhook(service_role)だけが更新 |
| `team_members` | 所属＋role(admin/member) | 参加は `join_team(code)` RPC経由のみ。直接insert不可 |
| `players` | ロースター（チーム共有） | 現行の選手スキーマ＋`scout_*`（AI名鑑）をそのまま移行 |
| `games` | 1試合=1行、`data jsonb` | 現行localStorageのGame形状を丸ごと格納 → 移行が最小・RLSが単純 |

### 権限（RLS）の設計思想
- 全テーブルRLS有効。閲覧/CRUDは「自分の所属チームのもの」だけ（`my_team_ids()` SECURITY DEFINERで再帰回避）
- `teams` の rename等はadminのみ
- **`is_premium` 系カラムはトリガ `guard_premium_columns()` でユーザー更新を全拒否。** `current_user = 'service_role'`（webhook）のみバイパス ← ペイウォールの生命線
- 招待コードはテーブル直読みさせず、`join_team()` RPCでのみ照合（コード列挙を防止）

### 課金 → 権限の伝播（RevenueCat）
1. 購入時、クライアントで **`Purchases.logIn(team_id)`** して RevenueCatの `app_user_id = team_id` に束ねる
2. 購入/復元/返金 → RevenueCat webhook → Supabase Edge Function（署名/認証ヘッダ検証）
3. Edge Functionが service_role で `teams.is_premium` を更新
4. 各メンバーのアプリは自チーム行の `is_premium` を **1回readするだけ**（RLSで許可）→ 全員に伝播

---

## 3. 自動運用チェックリスト（保守を最小化）

- [ ] 課金状態の検証・更新は **RevenueCat + webhook 1本**に丸投げ（自前の課金サーバーコードを持たない）
- [ ] バックエンドの可動部は **Edge Function 1つだけ**。失敗はテーブルにログ＋メール通知
- [ ] メンバー管理は **招待コード + `join_team` RPC で完全自己完結**（手動対応ゼロ）
- [ ] 不具合報告は **設定タブ内のGoogleフォームリンク**へ誘導。FAQも同タブに用意
- [ ] データ保護: 既存のJSONエクスポート（ユーザー側バックアップ）＋ Supabase PITR
- [ ] `config` テーブル1行（`min_supported_version` / お知らせ文）をアプリ起動時にread → **再デプロイなしで告知・弱いkill-switch**
- [ ] 収益モニタ: RevenueCatダッシュボード。`pg_cron` 週次で「新規チーム数・購入数」を自分にメール

---

## 4. Apple / Google 審査向けの実装提案

### 必須対応（欠けると確実にリジェクト）
- **「購入を復元」ボタン**（非消耗アイテムはApple必須）→ 設定タブに設置
- **アカウント削除導線**（アカウントを持つならApple必須）
- **プライバシーポリシー** URL ＋ データ収集のNutrition Label
- **IAP経由の課金**（3.1.1）: デジタル機能の解錠を外部Web決済に逃がさない。チームライセンスは非消耗アイテムとして正当

### チームライセンスの正当性
「1人購入 → 別Apple IDのメンバーも利用」は **SaaSのシート/サイトライセンスと同型で許可される**。
購入者の端末がレシート検証 → バックエンドがチームに権限付与 → 他メンバーはログインで享受。
Appleが見るのは「購入者が自分の端末で復元できること」。チーム内共有は自社ロジックの範疇。

### 無料版の設計（審査＆コンバージョン両面で重要）
- 無料版が「有料への広告」にならないよう、**現行の実用機能（スコア入力・基本成績・音声）は無料で開放**（今のアプリは既に単体で有用 → 好条件）
- 有料ロック対象は `PREMIUM_FEATURES`（`src/lib/entitlement.js`）: 詳細スタッツ / AI名鑑 / AIヘッドコーチ

---

## 5. 実行順序（今 vs 7/8以降）

**今（設計資産として完成済み・本ドキュメント群）**
- スキーマ・RLS・premiumガード・招待RPC（`0001_init.sql`）
- RevenueCat webhook（`revenuecat-webhook/index.ts`）
- 権限判定の雛形（`entitlement.js`）＋セットアップ手順（`supabase/README.md`）

**7/8以降（Sonnetが実配線・要反復テスト）**
1. Supabaseプロジェクト作成 → migration適用 → auth有効化
2. アプリに `@supabase/supabase-js` 導入、匿名/メールログイン、team作成/参加UI
3. localStorage → Supabase 同期層（現行storeの購読で送信）
4. Capacitorでネイティブ化 → RevenueCat SDK → IAP商品 `team_premium` 登録
5. ペイウォールUI（`isFeatureUnlocked` で各機能をゲート）
6. 「購入を復元」「アカウント削除」実装 → 両ストア審査提出

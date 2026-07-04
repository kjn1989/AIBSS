// ============================================================
// RevenueCat → Supabase Webhook (Edge Function / Deno)
//   teams.is_premium を更新する唯一の経路。
//   購入時にクライアントで Purchases.logIn(team_id) し、
//   RevenueCat の app_user_id = team_id に束ねておく前提。
// ★ 未配線の設計資産。`supabase functions deploy revenuecat-webhook` で後日展開。
//   環境変数: RC_WEBHOOK_AUTH / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RC_AUTH = Deno.env.get('RC_WEBHOOK_AUTH')!;               // RevenueCat側で設定するAuthorizationヘッダ値
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // RLS/トリガをバイパスする権限
const ENTITLEMENT = 'premium';

// 課金の付与/剥奪イベント分類
const GRANT = ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'TRANSFER'];
const REVOKE = ['REFUND', 'EXPIRATION'];

Deno.serve(async (req) => {
  // 1) 認証(RevenueCatダッシュボードで設定した固定ヘッダ)
  if (req.headers.get('authorization') !== RC_AUTH) {
    return new Response('unauthorized', { status: 401 });
  }

  // 2) イベント取り出し
  let ev: Record<string, unknown>;
  try {
    ev = ((await req.json()) as { event?: Record<string, unknown> }).event ?? {};
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const teamId = ev.app_user_id as string | undefined;
  const type = ev.type as string | undefined;
  if (!teamId || !type) return new Response('missing app_user_id/type', { status: 400 });

  const store = ev.store === 'APP_STORE' ? 'ios' : ev.store === 'PLAY_STORE' ? 'android' : 'manual';
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // 3) teams.is_premium を更新(service_roleなのでトリガのガードをバイパス)
  if (GRANT.includes(type)) {
    const { error } = await supa.from('teams').update({
      is_premium: true,
      premium_source: store,
      premium_purchased_at: new Date().toISOString(),
      rc_entitlement: ENTITLEMENT,
    }).eq('id', teamId);
    if (error) return new Response(`db error: ${error.message}`, { status: 500 });
  } else if (REVOKE.includes(type)) {
    const { error } = await supa.from('teams').update({ is_premium: false }).eq('id', teamId);
    if (error) return new Response(`db error: ${error.message}`, { status: 500 });
  }
  // それ以外(TEST等)はno-op

  return new Response('ok', { status: 200 });
});

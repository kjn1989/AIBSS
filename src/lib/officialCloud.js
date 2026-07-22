// ============================================================
// AI-BASE公式クラウド(Supabase)
//  - 認証: メール+パスワード(確認メール不要設定を推奨) / マジックリンク(任意)
//  - チーム管理: teams + team_members(権限: owner/scorer/viewer) + invites(招待トークン)
//  - 同期: team_games|team_players|team_crew を初回全取得+Realtime購読、push=upsert
// アクセス制御はサーバ側のRLS(supabase/schema.sql)が強制する。
// Supabaseを選んだ理由: 無料プランはカード登録不要で、上限到達時は停止するだけ
// (従量課金が構造的に発生しない)。旧方式(自前Firebase / lib/cloud.js)とは独立して併存。
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { getOfficialConfig, officialAvailable } from './officialConfig.js';
import { uid as newId } from './model.js';

export { officialAvailable };

let client = null;

function ensureClient() {
  if (client) return client;
  const cfg = getOfficialConfig();
  if (!cfg?.url || !cfg?.anonKey) return null;
  client = createClient(cfg.url, cfg.anonKey);
  return client;
}

// Supabaseのuserをアプリ内の共通形( uid / email / displayName )へ
function toUser(u) {
  if (!u) return null;
  return { uid: u.id, email: u.email || '', displayName: u.user_metadata?.name || u.email || '名無し' };
}

// fetch自体が失敗(サーバー未到達)かどうか。WebKitは"Load failed"、Chromeは"Failed to fetch"を投げる。
// supabase-jsはネットワーク失敗を AuthRetryableFetchError(status:0) として返すことが多い。
function isNetworkError(error) {
  const m = error?.message || String(error || '');
  return (
    error?.name === 'AuthRetryableFetchError'
    || error?.status === 0
    || /load failed|failed to fetch|networkerror|network request failed|fetch failed|typeerror/i.test(m)
  );
}

function jpAuthError(error) {
  const m = error?.message || String(error);
  // 通信不達は認証エラーより先に判定(生の"Load failed"を出さない)
  if (isNetworkError(error)) {
    return 'クラウドに接続できませんでした。通信環境をご確認のうえ、少し待って再度お試しください。'
      + '(サーバーが一時休止中の場合、初回アクセスから復帰まで数十秒かかることがあります)';
  }
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスまたはパスワードが違います';
  if (/Password should be at least/i.test(m)) return 'パスワードは6文字以上にしてください';
  if (/rate limit/i.test(m)) return '試行回数が多すぎます。しばらく待ってから再度お試しください';
  if (/already registered/i.test(m)) return 'このメールアドレスは登録済みです(パスワードが違う可能性)';
  return m;
}

// ---------------- 認証 ----------------
export function watchAuth(cb) {
  const sb = ensureClient();
  if (!sb) return () => {};
  const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
    cb(toUser(session?.user || null));
  });
  return () => subscription.unsubscribe();
}

export function currentUserAsync() {
  const sb = ensureClient();
  if (!sb) return Promise.resolve(null);
  return sb.auth.getSession().then(({ data }) => toUser(data?.session?.user || null));
}

// ログイン。未登録なら自動で新規登録も試す(確認メール設定がONの場合はメール確認を促す)
export async function loginWithPassword(email, password) {
  const sb = ensureClient();
  if (!sb) throw new Error('公式クラウドは未設定です');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!error) return;
  if (/Invalid login credentials/i.test(error.message)) {
    const { data, error: e2 } = await sb.auth.signUp({ email, password });
    if (e2) throw new Error(jpAuthError(e2));
    if (!data.session) {
      // 確認メール設定がONでも、DB側でauto-confirm(トリガ)している場合は即ログインできる。
      // 一度だけsign inを試し、成功すればメール確認なしで完了。失敗時のみメール案内を出す。
      const { error: e3 } = await sb.auth.signInWithPassword({ email, password });
      if (!e3) return;
      throw new Error('確認メールを送信しました。メール内のリンクを開いてから、もう一度ログインしてください。');
    }
    return; // 新規登録+即ログイン成功
  }
  throw new Error(jpAuthError(error));
}

// マジックリンク(パスワード不要)。Supabase既定のメール送信は頻度制限があるため補助扱い
export async function sendLoginLink(email) {
  const sb = ensureClient();
  if (!sb) throw new Error('公式クラウドは未設定です');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw new Error(jpAuthError(error));
}

export async function logout() {
  const sb = ensureClient();
  if (sb) await sb.auth.signOut();
}

// ---------------- チーム管理 ----------------
async function requireUser() {
  const u = await currentUserAsync();
  if (!u) throw new Error('ログインしてください');
  return u;
}

export async function createCloudTeam({ name, edition }) {
  const sb = ensureClient();
  if (!sb) throw new Error('公式クラウドは未設定です');
  const u = await requireUser();
  const teamId = newId();
  const { error: e1 } = await sb.from('teams').insert({
    id: teamId, name, edition, owner_uid: u.uid, plan: 'free', created_at: Date.now(),
  });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.from('team_members').insert({
    team_id: teamId, uid: u.uid, role: 'owner', name: u.displayName, email: u.email, joined_at: Date.now(),
  });
  if (e2) throw new Error(e2.message);
  return teamId;
}

// 招待トークンを発行(URLに埋め込む。トークンを知っていること自体が参加権)
export async function createInvite(teamId, role = 'scorer') {
  const sb = ensureClient();
  if (!sb) throw new Error('公式クラウドは未設定です');
  const u = await requireUser();
  const token = newId() + newId();
  const { error } = await sb.from('invites').insert({
    token, team_id: teamId, role,
    created_by: u.uid, created_at: Date.now(),
    expires_at: Date.now() + 14 * 86400000, // 14日で失効
  });
  if (error) throw new Error(error.message);
  return token;
}

export function inviteUrl(token) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('ct', token);
  return url.toString();
}

export async function joinByInvite(token) {
  const sb = ensureClient();
  if (!sb) throw new Error('公式クラウドは未設定です');
  const u = await requireUser();
  const { data, error } = await sb.rpc('get_invite', { tok: token });
  if (error) throw new Error(error.message);
  const inv = data?.[0];
  if (!inv) throw new Error('招待が見つかりません(削除済み・URL誤りの可能性)');
  if (inv.expires_at < Date.now()) throw new Error('招待の有効期限が切れています');
  const { error: e2 } = await sb.from('team_members').insert({
    team_id: inv.team_id, uid: u.uid, role: inv.role,
    name: u.displayName, email: u.email, invite: token, joined_at: Date.now(),
  });
  // 既に参加済み(重複キー)はエラーにしない
  if (e2 && !/duplicate key/i.test(e2.message)) throw new Error(e2.message);
  return { teamId: inv.team_id, role: inv.role, name: inv.team_name, edition: inv.team_edition };
}

export async function listMyTeams() {
  const sb = ensureClient();
  if (!sb) return [];
  const u = await currentUserAsync();
  if (!u) return [];
  const { data, error } = await sb
    .from('team_members')
    .select('team_id, role, teams(name, edition)')
    .eq('uid', u.uid);
  if (error) return [];
  return (data || []).map((r) => ({ teamId: r.team_id, role: r.role, teamName: r.teams?.name || 'チーム' }));
}

export async function listMembers(teamId) {
  const sb = ensureClient();
  if (!sb) return [];
  const { data, error } = await sb.from('team_members').select('*').eq('team_id', teamId).order('joined_at');
  if (error) return [];
  return data || [];
}

export async function setMemberRole(teamId, uid, role) {
  const sb = ensureClient();
  const { error } = await sb.from('team_members').update({ role }).eq('team_id', teamId).eq('uid', uid);
  if (error) throw new Error(error.message);
}

export async function removeMember(teamId, uid) {
  const sb = ensureClient();
  const { error } = await sb.from('team_members').delete().eq('team_id', teamId).eq('uid', uid);
  if (error) throw new Error(error.message);
}

// ---------------- 同期接続(lib/cloud.jsのconnectCloudと同じ呼び出し形) ----------------
// undefinedはjsonbに入らないため除去(JSON往復でスキーマ同一性も担保)
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function connectOfficial({ teamId, onGames, onPlayers, onCrew, onStatus }) {
  const sb = ensureClient();
  if (!sb || !teamId) {
    onStatus?.('error');
    return null;
  }
  onStatus?.('connecting');

  const load = async (table, cb) => {
    const { data, error } = await sb.from(table).select('data').eq('team_id', teamId);
    if (error) throw error;
    cb?.((data || []).map((r) => r.data));
  };
  Promise.all([load('team_games', onGames), load('team_players', onPlayers), load('team_crew', onCrew)])
    .then(() => onStatus?.('on'))
    .catch(() => onStatus?.('error'));

  const onRow = (cb) => (payload) => {
    const row = payload.new;
    if (row?.data) cb?.([row.data]);
  };
  const channel = sb
    .channel(`team-${teamId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_games', filter: `team_id=eq.${teamId}` }, onRow(onGames))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players', filter: `team_id=eq.${teamId}` }, onRow(onPlayers))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_crew', filter: `team_id=eq.${teamId}` }, onRow(onCrew))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('on');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error');
    });

  const push = (table) => async (obj) => {
    const { error } = await sb.from(table).upsert({
      team_id: teamId, id: obj.id, data: sanitize(obj), updated_at: obj.updatedAt || 0,
    });
    if (error) throw error;
  };
  return {
    teamId,
    pushGame: push('team_games'),
    pushPlayer: push('team_players'),
    pushCrew: push('team_crew'),
    teardown() {
      sb.removeChannel(channel);
    },
  };
}

-- ============================================================
-- AI-BSS公式クラウド(Supabase) スキーマ + RLS(行レベルセキュリティ)
-- SupabaseダッシュボードのSQL Editorにこのファイルの中身を全文貼り付けて Run する。
--
-- 権限モデル: team_members.role で制御
--   owner  … 全部+メンバー管理・チーム設定
--   scorer … スコア入力・選手/参加メンバー編集
--   viewer … 閲覧のみ
-- 参加は invites(推測不能トークン+有効期限) 経由のみ。
-- ============================================================

-- ---- テーブル ----
create table if not exists public.teams (
  id text primary key,
  name text not null,
  edition text not null default '草野球',
  owner_uid uuid not null references auth.users(id),
  plan text not null default 'free',
  created_at bigint not null
);

create table if not exists public.team_members (
  team_id text not null references public.teams(id) on delete cascade,
  uid uuid not null references auth.users(id),
  role text not null check (role in ('owner','scorer','viewer')),
  name text not null default '',
  email text not null default '',
  invite text,
  joined_at bigint not null,
  primary key (team_id, uid)
);

create table if not exists public.invites (
  token text primary key,
  team_id text not null references public.teams(id) on delete cascade,
  role text not null check (role in ('owner','scorer','viewer')),
  created_by uuid not null,
  created_at bigint not null,
  expires_at bigint not null
);

-- 試合・選手・参加メンバーはアプリのJSONスキーマをそのままdata列に保持(localStorageと同一形)
create table if not exists public.team_games (
  team_id text not null references public.teams(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at bigint not null default 0,
  primary key (team_id, id)
);
create table if not exists public.team_players (
  team_id text not null references public.teams(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at bigint not null default 0,
  primary key (team_id, id)
);
create table if not exists public.team_crew (
  team_id text not null references public.teams(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at bigint not null default 0,
  primary key (team_id, id)
);

-- ---- ヘルパー関数(security definer: RLSの再帰を避けて権限を判定) ----
create or replace function public.member_role(t text)
returns text language sql security definer stable
set search_path = public
as $$
  select role from public.team_members where team_id = t and uid = auth.uid()
$$;

-- チーム作成者本人か(team_membersのowner行を作る最初のinsert時、まだ自分がmembersに
-- 居ないためteamsテーブルへの素の参照はRLSでブロックされる。security definerで迂回する)
create or replace function public.is_team_owner(t text)
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists(select 1 from public.teams where id = t and owner_uid = auth.uid())
$$;

-- 招待トークンの検証(insertポリシー内から呼ぶ。invitesのRLSを迂回して判定)
create or replace function public.invite_valid(tok text, t text, r text)
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists(
    select 1 from public.invites i
    where i.token = tok and i.team_id = t and i.role = r
      and i.expires_at > (extract(epoch from now()) * 1000)::bigint
  )
$$;

-- 招待の取得(トークンを知っていること自体が参加権。一覧取得は不可のままRPCで1件だけ返す)
create or replace function public.get_invite(tok text)
returns table(team_id text, role text, expires_at bigint, team_name text, team_edition text)
language sql security definer stable
set search_path = public
as $$
  select i.team_id, i.role, i.expires_at, t.name, t.edition
  from public.invites i join public.teams t on t.id = i.team_id
  where i.token = tok
$$;

-- ---- RLS有効化 ----
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.invites enable row level security;
alter table public.team_games enable row level security;
alter table public.team_players enable row level security;
alter table public.team_crew enable row level security;

-- ---- ポリシー: teams ----
create policy teams_select on public.teams for select
  using (public.member_role(id) is not null);
create policy teams_insert on public.teams for insert
  with check (owner_uid = auth.uid());
create policy teams_update on public.teams for update
  using (public.member_role(id) = 'owner');
-- 削除は owner のみ(関連する試合/選手/メンバー/招待はFKのON DELETE CASCADEで一緒に消える)
create policy teams_delete on public.teams for delete
  using (public.member_role(id) = 'owner');

-- ---- ポリシー: team_members ----
create policy members_select on public.team_members for select
  using (public.member_role(team_id) is not null);
-- 参加(自分の行のみ): a)チーム作成者がownerとして b)有効な招待トークン付き
create policy members_insert on public.team_members for insert
  with check (
    uid = auth.uid() and (
      (role = 'owner' and public.is_team_owner(team_id))
      or public.invite_valid(invite, team_id, role)
    )
  );
create policy members_update on public.team_members for update
  using (public.member_role(team_id) = 'owner');
create policy members_delete on public.team_members for delete
  using (public.member_role(team_id) = 'owner' or uid = auth.uid());

-- ---- ポリシー: invites (取得はget_invite RPC経由のみ。一覧はownerだけ) ----
create policy invites_select on public.invites for select
  using (public.member_role(team_id) = 'owner');
create policy invites_insert on public.invites for insert
  with check (public.member_role(team_id) = 'owner' and created_by = auth.uid());
create policy invites_delete on public.invites for delete
  using (public.member_role(team_id) = 'owner');

-- ---- ポリシー: 試合・選手・参加メンバー(閲覧=メンバー全員 / 書込=owner・scorer) ----
create policy games_select on public.team_games for select
  using (public.member_role(team_id) is not null);
create policy games_write on public.team_games for insert
  with check (public.member_role(team_id) in ('owner','scorer'));
create policy games_update on public.team_games for update
  using (public.member_role(team_id) in ('owner','scorer'));
create policy games_delete on public.team_games for delete
  using (public.member_role(team_id) in ('owner','scorer'));

create policy players_select on public.team_players for select
  using (public.member_role(team_id) is not null);
create policy players_write on public.team_players for insert
  with check (public.member_role(team_id) in ('owner','scorer'));
create policy players_update on public.team_players for update
  using (public.member_role(team_id) in ('owner','scorer'));
create policy players_delete on public.team_players for delete
  using (public.member_role(team_id) in ('owner','scorer'));

create policy crew_select on public.team_crew for select
  using (public.member_role(team_id) is not null);
create policy crew_write on public.team_crew for insert
  with check (public.member_role(team_id) in ('owner','scorer'));
create policy crew_update on public.team_crew for update
  using (public.member_role(team_id) in ('owner','scorer'));
create policy crew_delete on public.team_crew for delete
  using (public.member_role(team_id) in ('owner','scorer'));

-- ---- アカウント削除(App Store 5.1.1(v) / Google Play のデータ削除要件) ----
--
-- アカウントを作れるアプリは、アプリの中からアカウントそのものを消せなければ
-- 審査を通らない。「無効化」や「問い合わせフォーム」では要件を満たさない。
--
-- auth.users はクライアントのキー(anon)からは触れないので、SECURITY DEFINER の
-- RPC を1本立てて、その中だけで消す。消す順番が重要:
--   1. 自分がownerのチーム … teams を消せば team_members / invites / team_games /
--      team_players / team_crew は on delete cascade で全部消える
--   2. 他人のチームへの参加 … 自分のmembers行だけ抜ける(チーム本体は残す)
--   3. auth.users の自分の行
-- teams.owner_uid と team_members.uid は auth.users を cascade なしで参照している
-- ため、1と2を先に済ませないと3が外部キー違反で失敗する。
--
-- 呼べるのはログイン中の本人だけ(auth.uid()で自分の行しか触らない)。引数を取らない
-- ので、他人のIDを渡して消すことはできない。
create or replace function public.delete_my_account()
returns void language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  delete from public.teams where owner_uid = me;
  delete from public.team_members where uid = me;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---- リアルタイム配信(RLS適用のうえで変更をpush) ----
alter table public.team_games replica identity full;
alter table public.team_players replica identity full;
alter table public.team_crew replica identity full;
alter publication supabase_realtime add table public.team_games;
alter publication supabase_realtime add table public.team_players;
alter publication supabase_realtime add table public.team_crew;

-- ============================================================
-- ライブ観戦リンク(ログイン不要・読み取り専用)
--
-- SupabaseダッシュボードのSQL Editorに、このファイルの中身を全文貼り付けて Run する。
-- 何度実行しても安全(既存のテーブル・データは変更しない)。
--
-- 仕組み:
--   ・チームごとに1つ、推測できない長いトークンを作る(live_shares)
--   ・トークンを知っている人は、ログインなしで「そのチームの試合のスコアと打席」だけ読める
--   ・読めるのは live_view() という関数の戻り値だけ。テーブルは直接読めないまま
--     (RLSは変えない)。返すのは試合のJSONと、選手の名前・背番号のみ
--     (スカウト寸評・写真・メール・メンバー情報は返さない)
--   ・リンクを作る/止められるのは、そのチームの owner / scorer だけ
--   ・止める(revoke)と、そのリンクはすぐ使えなくなる
-- ============================================================

create table if not exists public.live_shares (
  token text primary key,
  team_id text not null unique references public.teams(id) on delete cascade,
  created_by uuid not null,
  created_at bigint not null
);
-- テーブルは誰からも直接読み書きできない(ポリシーを1つも作らない)。関数だけが触る
alter table public.live_shares enable row level security;

-- リンクを作る(すでにあればそれを返す)。owner / scorer のみ
create or replace function public.live_share_create(p_team text)
returns text language plpgsql security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if coalesce(public.member_role(p_team), '') not in ('owner', 'scorer') then
    raise exception 'not allowed';
  end if;
  select token into v_token from public.live_shares where team_id = p_team;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.live_shares (token, team_id, created_by, created_at)
    values (v_token, p_team, auth.uid(), (extract(epoch from now()) * 1000)::bigint);
  end if;
  return v_token;
end;
$$;

-- いまのリンクを返す(無ければ null)。チームのメンバーなら誰でも
create or replace function public.live_share_get(p_team text)
returns text language plpgsql security definer stable
set search_path = public
as $$
declare
  v_token text;
begin
  if public.member_role(p_team) is null then
    return null;
  end if;
  select token into v_token from public.live_shares where team_id = p_team;
  return v_token;
end;
$$;

-- リンクを止める。owner / scorer のみ(作り直せば新しいリンクになる)
create or replace function public.live_share_revoke(p_team text)
returns void language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(public.member_role(p_team), '') not in ('owner', 'scorer') then
    raise exception 'not allowed';
  end if;
  delete from public.live_shares where team_id = p_team;
end;
$$;

-- 観戦ページが読む関数。ログイン不要(anon可)。
--   p_game  : 見たい試合のid。null なら「進行中の最新」、無ければ「いちばん新しい試合」
--   p_last  : 手元にある試合のid
--   p_since : 手元にある試合の updated_at
-- 手元と同じ試合で更新が無ければ、試合本体と選手は返さない(通信量を減らす。数秒おきに呼ばれる)
create or replace function public.live_view(p_token text, p_game text default null, p_last text default null, p_since bigint default 0)
returns jsonb language plpgsql security definer stable
set search_path = public
as $$
declare
  v_team text;
  v_name text;
  v_edition text;
  v_gid text;
  v_upd bigint;
  v_data jsonb;
  v_list jsonb;
  v_players jsonb;
  v_send boolean;
begin
  select s.team_id, t.name, t.edition into v_team, v_name, v_edition
  from public.live_shares s join public.teams t on t.id = s.team_id
  where s.token = p_token;
  if v_team is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  -- 試合の一覧(新しい順に最大20件。削除済みとデモは除く)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'date', g.data->>'date', 'opponent', g.data->>'opponent', 'status', g.data->>'status',
    'myScore', g.data->'myScore', 'oppScore', g.data->'oppScore', 'isHome', g.data->'isHome',
    'inning', g.data->'inning', 'isTop', g.data->'isTop', 'updatedAt', g.updated_at
  ) order by g.updated_at desc), '[]'::jsonb)
  into v_list
  from (
    select * from public.team_games
    where team_id = v_team and coalesce(data->>'deleted', '') <> 'true' and id not like 'demo-%'
    order by updated_at desc limit 20
  ) g;

  select g.id, g.updated_at, g.data into v_gid, v_upd, v_data
  from public.team_games g
  where g.team_id = v_team and coalesce(g.data->>'deleted', '') <> 'true' and g.id not like 'demo-%'
    and (p_game is null or g.id = p_game)
  order by (case when p_game is null and g.data->>'status' = 'ongoing' then 0 else 1 end), g.updated_at desc
  limit 1;

  v_send := v_gid is not null and (v_gid is distinct from p_last or v_upd > coalesce(p_since, 0));
  if v_send then
    -- 名前と背番号だけ(スカウト寸評・写真などは返さない)
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.data->>'name', 'number', p.data->>'number')), '[]'::jsonb)
    into v_players
    from public.team_players p
    where p.team_id = v_team and coalesce(p.data->>'deleted', '') <> 'true';
  end if;

  return jsonb_build_object(
    'teamName', v_name, 'edition', v_edition, 'list', v_list,
    'gameId', v_gid, 'updatedAt', v_upd,
    'game', case when v_send then v_data else null end,
    'players', case when v_send then v_players else null end
  );
end;
$$;

revoke all on function public.live_share_create(text) from public, anon;
revoke all on function public.live_share_get(text) from public, anon;
revoke all on function public.live_share_revoke(text) from public, anon;
grant execute on function public.live_share_create(text) to authenticated;
grant execute on function public.live_share_get(text) to authenticated;
grant execute on function public.live_share_revoke(text) to authenticated;

revoke all on function public.live_view(text, text, text, bigint) from public;
grant execute on function public.live_view(text, text, text, bigint) to anon, authenticated;


-- ============================================================
-- ライブ観戦: 「いま◯人が観戦中」と応援スタンプ
--
-- SupabaseダッシュボードのSQL Editorに、このファイルの中身を全文貼り付けて Run する。
-- 先に live_share.sql を流してあること。何度実行しても安全。
--
-- 仕組み:
--   ・観戦ページは数秒おきに live_presence() を呼ぶ。そのとき「見ています」を記録する。
--     直近20秒に記録があった端末の数が「観戦中の人数」
--     (記録するのはブラウザごとの使い捨ての番号だけ。名前・メール・場所は持たない)
--   ・応援スタンプは live_cheer() で送る。文章は送れない(決まったスタンプの名前だけ)。
--     スタンプは「そのとき最新の打席」に付き、打席ごとの盛り上がりとして残る
--   ・送りすぎ防止: 1端末あたり1分に30回まで
--   ・記録係(チームのメンバー)は team_live_stats() で人数とスタンプを見る
--   ・テーブルは誰からも直接読み書きできない(ポリシーを作らない)。関数だけが触る
-- ============================================================

create table if not exists public.live_viewers (
  token text not null,
  viewer text not null,
  game_id text,
  seen bigint not null,
  primary key (token, viewer)
);
alter table public.live_viewers enable row level security;

create table if not exists public.live_cheers (
  id bigserial primary key,
  team_id text not null references public.teams(id) on delete cascade,
  game_id text not null,
  log_id text,
  stamp text not null,
  viewer text not null,
  at bigint not null
);
create index if not exists live_cheers_game on public.live_cheers (team_id, game_id, at);
alter table public.live_cheers enable row level security;

create or replace function public.live_now() returns bigint language sql stable
as $$ select (extract(epoch from now()) * 1000)::bigint $$;

-- 人数とスタンプの集計(観戦ページと記録係で同じ形を返す)
--   viewers : 直近20秒に見ていた端末の数
--   cheers  : 打席(log_id)ごと・スタンプごとの数
--   recent  : p_since より後に押されたスタンプ(画面に流す。最大50件)
--   total   : この試合のスタンプの合計
create or replace function public.live_cheer_summary(p_team text, p_token text, p_game text, p_since bigint)
returns jsonb language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'viewers', (select count(*) from public.live_viewers v
                where v.token = p_token and v.seen > public.live_now() - 20000
                  and (p_game is null or v.game_id is null or v.game_id = p_game)),
    'cheers', coalesce((select jsonb_agg(jsonb_build_object('log', c.log_id, 'stamp', c.stamp, 'n', c.n))
                from (select log_id, stamp, count(*) as n from public.live_cheers
                      where team_id = p_team and game_id = p_game group by log_id, stamp) c), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('stamp', r.stamp, 'at', r.at, 'viewer', r.viewer) order by r.at)
                from (select stamp, at, viewer from public.live_cheers
                      where team_id = p_team and game_id = p_game and at > coalesce(p_since, 0)
                      order by at desc limit 50) r), '[]'::jsonb),
    'total', (select count(*) from public.live_cheers where team_id = p_team and game_id = p_game),
    'now', public.live_now()
  )
$$;

-- 観戦ページが数秒おきに呼ぶ。「見ています」を記録して、人数とスタンプを返す。ログイン不要
create or replace function public.live_presence(p_token text, p_viewer text, p_game text, p_since bigint default 0)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_team text;
begin
  select team_id into v_team from public.live_shares where token = p_token;
  if v_team is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if p_viewer is not null and length(p_viewer) between 8 and 64 then
    insert into public.live_viewers (token, viewer, game_id, seen)
    values (p_token, p_viewer, p_game, public.live_now())
    on conflict (token, viewer) do update set seen = excluded.seen, game_id = excluded.game_id;
  end if;
  -- 1時間以上来ていない端末は消す(表が膨らまないように)
  delete from public.live_viewers where token = p_token and seen < public.live_now() - 3600000;
  if p_game is null then
    return jsonb_build_object('viewers', 0, 'cheers', '[]'::jsonb, 'recent', '[]'::jsonb, 'total', 0);
  end if;
  return public.live_cheer_summary(v_team, p_token, p_game, p_since);
end;
$$;

-- 応援スタンプを送る。ログイン不要。決まったスタンプだけ、1端末1分30回まで
create or replace function public.live_cheer(p_token text, p_viewer text, p_game text, p_log text, p_stamp text)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_team text;
  v_recent int;
begin
  select team_id into v_team from public.live_shares where token = p_token;
  if v_team is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if p_stamp not in ('clap', 'fire', 'ball', 'muscle', 'wow') then
    return jsonb_build_object('error', 'bad_stamp');
  end if;
  if p_viewer is null or length(p_viewer) not between 8 and 64 or p_game is null then
    return jsonb_build_object('error', 'bad_request');
  end if;
  -- その試合がこのチームのものか(他チームの試合にスタンプを付けさせない)
  if not exists (select 1 from public.team_games where team_id = v_team and id = p_game) then
    return jsonb_build_object('error', 'bad_request');
  end if;
  select count(*) into v_recent from public.live_cheers
  where team_id = v_team and viewer = p_viewer and at > public.live_now() - 60000;
  if v_recent >= 30 then
    return jsonb_build_object('error', 'too_many');
  end if;
  insert into public.live_cheers (team_id, game_id, log_id, stamp, viewer, at)
  values (v_team, p_game, left(p_log, 64), p_stamp, p_viewer, public.live_now());
  return jsonb_build_object('ok', true);
end;
$$;

-- 記録係(チームのメンバー)が見る。人数とスタンプ
create or replace function public.team_live_stats(p_team text, p_game text, p_since bigint default 0)
returns jsonb language plpgsql security definer stable
set search_path = public
as $$
declare
  v_token text;
begin
  if public.member_role(p_team) is null then
    raise exception 'not allowed';
  end if;
  select token into v_token from public.live_shares where team_id = p_team;
  return public.live_cheer_summary(p_team, v_token, p_game, p_since);
end;
$$;

revoke all on function public.live_cheer_summary(text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.live_presence(text, text, text, bigint) from public;
revoke all on function public.live_cheer(text, text, text, text, text) from public;
revoke all on function public.team_live_stats(text, text, bigint) from public, anon;
grant execute on function public.live_presence(text, text, text, bigint) to anon, authenticated;
grant execute on function public.live_cheer(text, text, text, text, text) to anon, authenticated;
grant execute on function public.team_live_stats(text, text, bigint) to authenticated;

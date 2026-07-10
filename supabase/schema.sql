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
-- delete: 無し(誤削除防止)

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

-- ---- リアルタイム配信(RLS適用のうえで変更をpush) ----
alter table public.team_games replica identity full;
alter table public.team_players replica identity full;
alter table public.team_crew replica identity full;
alter publication supabase_realtime add table public.team_games;
alter publication supabase_realtime add table public.team_players;
alter publication supabase_realtime add table public.team_crew;

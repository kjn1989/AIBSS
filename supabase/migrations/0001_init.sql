-- ============================================================
-- AIBSS backend schema : teams / members / roster / games
--   + RLS + premium entitlement guard + invite RPC
-- 前提: Supabase (Postgres + auth schema)。
-- ★ 未配線の設計資産。7/8以降にSupabaseプロジェクトへ適用する。
-- ★ 一部(current_user='service_role'判定等)はSupabaseの実挙動で要検証。
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ teams
create table public.teams (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  invite_code          text not null unique
                         default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by           uuid references auth.users(id) on delete set null,
  is_premium           boolean not null default false,   -- ★ ユーザーからは更新不可(下のトリガでガード)
  premium_source       text,                             -- 'ios' | 'android' | 'manual'
  premium_purchased_at timestamptz,
  rc_entitlement       text,                             -- RevenueCat entitlement id
  created_at           timestamptz not null default now()
);

-- ------------------------------------------------------------ team_members
create table public.team_members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members(user_id);

-- ------------------------------------------------------------ players (roster, team共有)
create table public.players (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams(id) on delete cascade,
  name              text not null,
  number            text default '',
  scout_tags        jsonb default '[]'::jsonb,
  scout_catchphrase text default '',
  scout_report      text default '',
  created_at        timestamptz not null default now()
);
create index players_team_idx on public.players(team_id);

-- ------------------------------------------------------------ games (1試合=1 JSONB)
create table public.games (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  date       date,
  opponent   text,
  season     text,
  status     text default 'ongoing',
  data       jsonb not null,               -- 現行localStorageのGame全体
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index games_team_idx on public.games(team_id);

-- ------------------------------------------------------------ config (再デプロイ不要の告知/kill-switch)
create table public.config (
  id                    int primary key default 1,
  min_supported_version text default '1.0.0',
  announcement          text default '',
  updated_at            timestamptz not null default now()
);
insert into public.config (id) values (1) on conflict do nothing;

-- ============================================================
-- RLS
-- ============================================================
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.players      enable row level security;
alter table public.games        enable row level security;
alter table public.config       enable row level security;

-- 所属チーム集合(SECURITY DEFINER でRLS再帰を回避)
create or replace function public.my_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid()
$$;

create or replace function public.my_admin_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid() and role = 'admin'
$$;

-- teams: 所属チームを閲覧 / rename等はadminのみ
create policy teams_select on public.teams for select
  using (id in (select public.my_team_ids()));
create policy teams_update on public.teams for update
  using (id in (select public.my_admin_team_ids()))
  with check (id in (select public.my_admin_team_ids()));

-- ★ premium系カラムはユーザー更新を全拒否。webhook(service_role)のみバイパス。
create or replace function public.guard_premium_columns()
returns trigger language plpgsql as $$
begin
  if current_user = 'service_role' then
    return new;  -- 課金webhookはバイパス
  end if;
  if (new.is_premium           is distinct from old.is_premium)
  or (new.premium_source       is distinct from old.premium_source)
  or (new.premium_purchased_at is distinct from old.premium_purchased_at)
  or (new.rc_entitlement       is distinct from old.rc_entitlement) then
    raise exception 'premium columns are managed by the billing webhook only';
  end if;
  return new;
end $$;
create trigger trg_guard_premium before update on public.teams
  for each row execute function public.guard_premium_columns();

-- team_members: 自分の行 / adminは同チーム全員
create policy tm_select_self on public.team_members for select
  using (user_id = auth.uid());
create policy tm_select_admin on public.team_members for select
  using (team_id in (select public.my_admin_team_ids()));

-- players / games: 所属チームのものをCRUD
create policy players_all on public.players for all
  using (team_id in (select public.my_team_ids()))
  with check (team_id in (select public.my_team_ids()));
create policy games_all on public.games for all
  using (team_id in (select public.my_team_ids()))
  with check (team_id in (select public.my_team_ids()));

-- config: 全員read-only
create policy config_select on public.config for select using (true);

-- ============================================================
-- RPC: チーム作成 / 招待参加
-- ============================================================
create or replace function public.create_team(team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  insert into public.teams(name, created_by) values (team_name, auth.uid()) returning id into tid;
  insert into public.team_members(team_id, user_id, role) values (tid, auth.uid(), 'admin');
  return tid;
end $$;

create or replace function public.join_team(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select id into tid from public.teams where invite_code = upper(code);
  if tid is null then raise exception 'invalid invite code'; end if;
  insert into public.team_members(team_id, user_id, role)
    values (tid, auth.uid(), 'member')
    on conflict (team_id, user_id) do nothing;
  return tid;
end $$;

grant execute on function public.create_team(text) to authenticated;
grant execute on function public.join_team(text)  to authenticated;

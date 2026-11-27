-- ============================================================
-- ライブ観戦: 「いま◯人が観戦中」と応援スタンプ(応援コイン)
--
-- SupabaseダッシュボードのSQL Editorに、このファイルの中身を全文貼り付けて Run する。
-- 先に live_share.sql を流してあること。何度実行しても安全(前の版を流してあっても上書きでよい)。
--
-- 仕組み:
--   ・観戦ページは数秒おきに live_presence() を呼ぶ。そのとき「見ています」を記録する。
--     直近20秒に記録があった端末の数が「観戦中の人数」
--     (記録するのはブラウザごとの使い捨ての番号だけ。名前・メール・場所は持たない)
--   ・応援スタンプは live_cheer() で送る。文章は送れない(決まったスタンプの名前だけ)。
--     スタンプは「そのとき最新のプレー」と「そのプレーの選手」に付く
--   ・投げ銭の代わりの「応援コイン」: 観戦者は1試合ごとに50コインを持っていて、
--     🔥(1) ⚾(3) 🏆(10) はコインを使って選手に贈る。👏 と 😱 は無料で何度でも押せる。
--     お金は一切動かない(アプリの中だけの点数)
--   ・記録係(チームのメンバー)は team_live_stats() で人数とスタンプを、
--     team_cheer_totals() で選手ごとの通算の応援コインを見る(推定年俸のボーナスに使う)
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
alter table public.live_cheers add column if not exists player_id text;
alter table public.live_cheers add column if not exists coins int not null default 0;
create index if not exists live_cheers_game on public.live_cheers (team_id, game_id, at);
create index if not exists live_cheers_viewer on public.live_cheers (team_id, game_id, viewer);
alter table public.live_cheers enable row level security;

create or replace function public.live_now() returns bigint language sql stable
as $$ select (extract(epoch from now()) * 1000)::bigint $$;

-- スタンプのコイン(無料は0)。ここに無いスタンプは送れない
create or replace function public.live_stamp_cost(p_stamp text) returns int language sql immutable
as $$ select case p_stamp when 'clap' then 0 when 'wow' then 0 when 'fire' then 1 when 'ball' then 3 when 'mvp' then 10 else null end $$;

-- 1試合で観戦者1人が持つ応援コイン
create or replace function public.live_wallet_size() returns int language sql immutable as $$ select 50 $$;

-- 人数とスタンプの集計(観戦ページと記録係で同じ形を返す)
--   viewers : 直近20秒に見ていた端末の数
--   cheers  : プレー(log_id)ごと・スタンプごとの数
--   players : 選手ごとの応援コインとスタンプの数(この試合)
--   recent  : p_since より後に押されたスタンプ(画面に流す。最大50件)
--   total   : この試合のスタンプの合計
--   wallet  : p_viewer の残りコイン(観戦ページだけ)
create or replace function public.live_cheer_summary(p_team text, p_token text, p_game text, p_since bigint, p_viewer text default null)
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
    'players', coalesce((select jsonb_agg(jsonb_build_object('player', x.player_id, 'coins', x.coins, 'n', x.n) order by x.coins desc, x.n desc)
                from (select player_id, sum(coins) as coins, count(*) as n from public.live_cheers
                      where team_id = p_team and game_id = p_game and player_id is not null group by player_id) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('stamp', r.stamp, 'at', r.at, 'viewer', r.viewer, 'player', r.player_id) order by r.at)
                from (select stamp, at, viewer, player_id from public.live_cheers
                      where team_id = p_team and game_id = p_game and at > coalesce(p_since, 0)
                      order by at desc limit 50) r), '[]'::jsonb),
    'total', (select count(*) from public.live_cheers where team_id = p_team and game_id = p_game),
    'wallet', case when p_viewer is null then null else public.live_wallet_size() - coalesce((
                select sum(coins) from public.live_cheers where team_id = p_team and game_id = p_game and viewer = p_viewer), 0) end,
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
    return jsonb_build_object('viewers', 0, 'cheers', '[]'::jsonb, 'players', '[]'::jsonb, 'recent', '[]'::jsonb, 'total', 0);
  end if;
  return public.live_cheer_summary(v_team, p_token, p_game, p_since, p_viewer);
end;
$$;

-- 前の版(引数5つ)は消す
drop function if exists public.live_cheer(text, text, text, text, text);

-- 応援スタンプを送る。ログイン不要。決まったスタンプだけ。
-- 無料のスタンプは何度でも。コインのスタンプは、その試合の残りコインの範囲で
create or replace function public.live_cheer(p_token text, p_viewer text, p_game text, p_log text, p_stamp text, p_player text default null)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_team text;
  v_cost int;
  v_spent int;
begin
  select team_id into v_team from public.live_shares where token = p_token;
  if v_team is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  v_cost := public.live_stamp_cost(p_stamp);
  if v_cost is null then
    return jsonb_build_object('error', 'bad_stamp');
  end if;
  if p_viewer is null or length(p_viewer) not between 8 and 64 or p_game is null then
    return jsonb_build_object('error', 'bad_request');
  end if;
  -- その試合がこのチームのものか(他チームの試合にスタンプを付けさせない)
  if not exists (select 1 from public.team_games where team_id = v_team and id = p_game) then
    return jsonb_build_object('error', 'bad_request');
  end if;
  if v_cost > 0 then
    select coalesce(sum(coins), 0) into v_spent from public.live_cheers
    where team_id = v_team and game_id = p_game and viewer = p_viewer;
    if v_spent + v_cost > public.live_wallet_size() then
      return jsonb_build_object('error', 'no_coins', 'wallet', public.live_wallet_size() - v_spent);
    end if;
  end if;
  insert into public.live_cheers (team_id, game_id, log_id, stamp, viewer, at, player_id, coins)
  values (v_team, p_game, left(p_log, 64), p_stamp, p_viewer, public.live_now(), left(p_player, 64), v_cost);
  return jsonb_build_object('ok', true, 'wallet', public.live_wallet_size() - coalesce(v_spent, 0) - v_cost);
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
  return public.live_cheer_summary(p_team, v_token, p_game, p_since, null);
end;
$$;

-- 選手ごとの通算の応援コイン(推定年俸のボーナスに使う)。チームのメンバーだけ
create or replace function public.team_cheer_totals(p_team text)
returns jsonb language plpgsql security definer stable
set search_path = public
as $$
begin
  if public.member_role(p_team) is null then
    raise exception 'not allowed';
  end if;
  return coalesce((select jsonb_object_agg(player_id, coins)
    from (select player_id, sum(coins) as coins from public.live_cheers
          where team_id = p_team and player_id is not null group by player_id) x), '{}'::jsonb);
end;
$$;

-- 前の版の5引数の集計関数は消す
drop function if exists public.live_cheer_summary(text, text, text, bigint);

revoke all on function public.live_cheer_summary(text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.live_presence(text, text, text, bigint) from public;
revoke all on function public.live_cheer(text, text, text, text, text, text) from public;
revoke all on function public.team_live_stats(text, text, bigint) from public, anon;
revoke all on function public.team_cheer_totals(text) from public, anon;
grant execute on function public.live_presence(text, text, text, bigint) to anon, authenticated;
grant execute on function public.live_cheer(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.team_live_stats(text, text, bigint) to authenticated;
grant execute on function public.team_cheer_totals(text) to authenticated;

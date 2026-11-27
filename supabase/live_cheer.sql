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

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

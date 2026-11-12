-- Radar de Creativos — esquema de base de datos (Supabase / Postgres)
-- Pegar entero en Supabase > SQL Editor > Run.

create extension if not exists pgcrypto;

-- ---------- Equipo (quién puede entrar) ----------
create table if not exists team_members (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Clientes ----------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rubro text,
  drive_folder_url text,
  created_at timestamptz not null default now()
);

-- ---------- Búsquedas ----------
create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  rubro text not null,
  keywords text[] not null default '{}',
  countries text[] not null default '{AR}',
  media_type text not null default 'all',          -- all | video | image
  max_per_query int not null default 50,
  status text not null default 'pending',          -- pending | running | done | error
  error text,
  total_found int not null default 0,
  recurring boolean not null default false,        -- se vuelve a correr cada semana
  last_run_at timestamptz,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

-- ---------- Anuncios ----------
create table if not exists ads (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'meta',
  ad_archive_id text not null,
  page_name text,
  page_url text,
  body text,
  title text,
  cta text,
  link_url text,
  format text,                                     -- video | image | carousel
  media jsonb not null default '[]',               -- [{type, url, thumb}]
  countries text[] not null default '{}',
  publisher_platforms text[] not null default '{}',
  start_date date,
  end_date date,
  is_active boolean,
  snapshot_url text,
  -- análisis con IA (opcional)
  relevant boolean,
  angle text,
  hook text,
  ai_summary text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (platform, ad_archive_id)
);

create or replace view ads_view as
  select a.*,
    greatest(0, coalesce(a.end_date, current_date) - a.start_date) as days_active
  from ads a;

create table if not exists search_results (
  search_id uuid references searches(id) on delete cascade,
  ad_id uuid references ads(id) on delete cascade,
  query text,
  primary key (search_id, ad_id)
);

-- ---------- Biblioteca: favoritos / guardados por cliente ----------
create table if not exists saves (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references ads(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,  -- null = favorito general
  note text,
  saved_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create unique index if not exists saves_unique on saves (ad_id, client_id) nulls not distinct;

-- ---------- Pedidos de piezas ----------
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null default substr(md5(gen_random_uuid()::text), 1, 10),
  client_id uuid references clients(id) on delete set null,
  title text not null,
  objective text,
  notes text,
  artifact_url text,
  drive_url text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table if not exists pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  ad_id uuid references ads(id) on delete set null,
  position int not null default 0,
  piece_name text,
  format text,          -- Reel 9:16, Story 9:16, Feed 4:5, Carrusel...
  angle text,
  script text,          -- guion sugerido
  notes text
);

-- ---------- Seguridad (RLS): solo el equipo lee y escribe ----------
do $$
declare t text;
begin
  foreach t in array array['team_members','clients','searches','ads','search_results','saves','pedidos','pedido_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
    execute format('create policy team_all on %I for all to authenticated using (is_team()) with check (is_team())', t);
  end loop;
end $$;

-- La vista respeta los permisos de quien consulta
alter view ads_view set (security_invoker = true);

-- ---------- Link público del pedido (para el cliente, sin login) ----------
create or replace function get_pedido(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'title', p.title,
    'objective', p.objective,
    'notes', p.notes,
    'created_at', p.created_at,
    'client', c.name,
    'items', coalesce((
      select json_agg(json_build_object(
        'position', i.position, 'piece_name', i.piece_name, 'format', i.format,
        'angle', i.angle, 'script', i.script, 'notes', i.notes,
        'ref', json_build_object(
          'page_name', a.page_name, 'body', a.body, 'format', a.format,
          'media', a.media, 'snapshot_url', a.snapshot_url,
          'days_active', greatest(0, coalesce(a.end_date, current_date) - a.start_date)
        )
      ) order by i.position)
      from pedido_items i left join ads a on a.id = i.ad_id
      where i.pedido_id = p.id
    ), '[]'::json)
  )
  from pedidos p left join clients c on c.id = p.client_id
  where p.slug = p_slug;
$$;
grant execute on function get_pedido(text) to anon, authenticated;

-- ---------- Vistas de ayuda para filtrar la biblioteca ----------
create or replace view search_ads as
  select sr.search_id, v.* from search_results sr join ads_view v on v.id = sr.ad_id;
alter view search_ads set (security_invoker = true);

create or replace view saved_ads as
  select s.client_id as saved_client_id, s.note as saved_note, v.* from saves s join ads_view v on v.id = s.ad_id;
alter view saved_ads set (security_invoker = true);

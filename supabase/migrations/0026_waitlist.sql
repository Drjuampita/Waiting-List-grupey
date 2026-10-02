-- 0026_waitlist.sql — Preregistro (lista de espera) de la landing grupey.com.
-- Esquema propio, NO expuesto por la API REST de Supabase. Solo se escribe a través
-- de waitlist.pre_register(), que únicamente puede ejecutar el rol waitlist_writer.

create schema if not exists waitlist;
revoke all on schema waitlist from public;

create table if not exists waitlist.signups (
  id                uuid primary key default gen_random_uuid(),
  email             text not null check (char_length(email) between 3 and 254),
  email_normalized  text not null check (char_length(email_normalized) between 3 and 254),
  status            text not null default 'active'  check (status in ('active', 'unsubscribed')),
  source            text not null default 'landing' check (source in ('landing', 'import', 'manual')),
  form              text check (form in ('hero', 'cierre')),
  utm_source        text check (char_length(utm_source)   <= 200),
  utm_medium        text check (char_length(utm_medium)   <= 200),
  utm_campaign      text check (char_length(utm_campaign) <= 200),
  utm_content       text check (char_length(utm_content)  <= 200),
  utm_term          text check (char_length(utm_term)     <= 200),
  ref               text check (char_length(ref)          <= 100),
  referrer_host     text check (char_length(referrer_host) <= 253),
  landing_path      text check (landing_path like '/%' and char_length(landing_path) <= 500),
  privacy_version   text not null check (char_length(privacy_version) <= 40),
  consented_at      timestamptz not null default now(),
  -- Siempre false en el MVP: no hay casilla de marketing; el único propósito es avisar del lanzamiento.
  marketing_consent boolean not null default false,
  attempts          integer not null default 1 check (attempts >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_attempt_at   timestamptz not null default now(),
  constraint signups_email_normalized_key unique (email_normalized)
);

create index if not exists signups_created_at_idx on waitlist.signups (created_at);

-- RLS activo y SIN políticas a propósito: fuera del dueño, nadie lee ni escribe filas.
alter table waitlist.signups enable row level security;

create or replace function waitlist.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists signups_touch_updated_at on waitlist.signups;
create trigger signups_touch_updated_at
  before update on waitlist.signups
  for each row execute function waitlist.touch_updated_at();

-- Única puerta de escritura. Atómica: un solo INSERT … ON CONFLICT.
-- Devuelve true si creó el registro (solo para logs; la API nunca lo expone).
create or replace function waitlist.pre_register(
  p_email text, p_email_normalized text, p_form text,
  p_utm_source text, p_utm_medium text, p_utm_campaign text, p_utm_content text, p_utm_term text,
  p_ref text, p_referrer_host text, p_landing_path text, p_privacy_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  insert into waitlist.signups as s (
    email, email_normalized, form,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    ref, referrer_host, landing_path, privacy_version
  ) values (
    p_email, p_email_normalized, p_form,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term,
    p_ref, p_referrer_host, p_landing_path, p_privacy_version
  )
  on conflict (email_normalized) do update set
    attempts        = s.attempts + 1,
    last_attempt_at = now(),
    -- Manda el primer contacto: email, form, UTMs, ref, referrer y landing_path NO se tocan.
    -- Solo si se había dado de baja vuelve a 'active', con consentimiento nuevo.
    status          = 'active',
    consented_at    = case when s.status = 'unsubscribed' then now() else s.consented_at end,
    privacy_version = case when s.status = 'unsubscribed' then excluded.privacy_version else s.privacy_version end
  returning (s.xmax = 0) into v_inserted;

  return v_inserted;
end
$$;

revoke all on function waitlist.touch_updated_at() from public;
revoke all on function waitlist.pre_register(text, text, text, text, text, text, text, text, text, text, text, text) from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'waitlist_writer') then
    create role waitlist_writer nologin noinherit;
  end if;
end
$$;
-- LOGIN y contraseña se activan a mano, UNA vez por ambiente (README de landing/):
--   alter role waitlist_writer with login password '<32+ caracteres aleatorios>';
alter role waitlist_writer set statement_timeout = '4s';
alter role waitlist_writer connection limit 20;

grant usage on schema waitlist to waitlist_writer;
grant execute on function waitlist.pre_register(text, text, text, text, text, text, text, text, text, text, text, text)
  to waitlist_writer;

-- Defensa extra en Supabase: los roles de la API no tienen nada en este esquema.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema waitlist from %I', r);
      execute format('revoke all on all tables in schema waitlist from %I', r);
      execute format('revoke all on all functions in schema waitlist from %I', r);
    end if;
  end loop;
end
$$;

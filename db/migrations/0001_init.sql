-- Pollen — initial multi-tenant schema
--
-- Isolation model
--   * Every tenant-owned table carries workspace_id and has row-level security.
--   * The app connects as `pollen_app` (NOBYPASSRLS). Each request runs inside a
--     transaction that sets `app.workspace_id` (and `app.platform_admin` for the
--     admin console), so a query that forgets a WHERE clause still only sees one
--     tenant's rows.
--   * Supabase's `anon` / `authenticated` roles get no grants and no policies, so
--     the auto-generated REST API exposes nothing.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ─── Request context helpers ────────────────────────────────────────────────
create or replace function app_ws() returns uuid
  language sql stable as
$$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

create or replace function app_is_admin() returns boolean
  language sql stable as
$$ select coalesce(current_setting('app.platform_admin', true), '') = 'on' $$;

create or replace function touch_updated_at() returns trigger
  language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

-- ─── Platform (global) tables ───────────────────────────────────────────────
create table users (
  id                 uuid primary key default gen_random_uuid(),
  email              citext not null unique,
  name               text not null,
  password_hash      text not null,
  is_platform_admin  boolean not null default false,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now()
);

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  name        text not null,
  industry    text,
  website     text,
  timezone    text not null default 'Asia/Kolkata',
  plan        text not null default 'starter' check (plan in ('trial','starter','growth','scale')),
  status      text not null default 'active'  check (status in ('active','suspended')),
  is_demo     boolean not null default false,
  notes       text,                       -- internal, sales-led account notes
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger workspaces_touch before update on workspaces for each row execute function touch_updated_at();

create table memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','admin','member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user_idx on memberships(user_id);

create table audit_log (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action        text not null,
  target        text,
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index audit_log_ws_idx on audit_log(workspace_id, created_at desc);

-- ─── Tenant tables ──────────────────────────────────────────────────────────
-- workspace_id defaults from the request context so inserts can't forget it.

create table contacts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null default app_ws() references workspaces(id) on delete cascade,
  email            citext not null,
  first_name       text,
  last_name        text,
  phone            text,
  status           text not null default 'subscribed'
                   check (status in ('subscribed','unsubscribed','bounced','complained')),
  source           text not null default 'manual',   -- manual | import | api | form
  tags             text[] not null default '{}',
  attributes       jsonb not null default '{}',       -- free-form custom fields
  last_engaged_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, email)
);
create index contacts_ws_status_idx on contacts(workspace_id, status);
create index contacts_tags_idx on contacts using gin(tags);
create trigger contacts_touch before update on contacts for each row execute function touch_updated_at();

create table lists (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default app_ws() references workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now()
);

create table list_members (
  list_id      uuid not null references lists(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  workspace_id uuid not null default app_ws() references workspaces(id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (list_id, contact_id)
);
create index list_members_contact_idx on list_members(contact_id);

create table segments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default app_ws() references workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  rules        jsonb not null,     -- validated rule tree, see lib/segments.ts
  ai_prompt    text,               -- the plain-English request, if AI-built
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger segments_touch before update on segments for each row execute function touch_updated_at();

create table brand_kits (
  workspace_id  uuid primary key default app_ws() references workspaces(id) on delete cascade,
  display_name  text,
  logo_url      text,
  primary_color text not null default '#2f6f4f',
  accent_color  text not null default '#f2c14e',
  website       text,
  address       text,              -- physical address, required in email footers
  footer_text   text,
  voice         jsonb,             -- AI-extracted brand voice profile
  updated_at    timestamptz not null default now()
);
create trigger brand_kits_touch before update on brand_kits for each row execute function touch_updated_at();

-- BYOK: provider secrets are encrypted in the app (AES-256-GCM) before they
-- ever reach the database; only the last 4 characters are stored in clear.
create table ai_credentials (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default app_ws() references workspaces(id) on delete cascade,
  provider      text not null check (provider in ('openai','anthropic','google')),
  key_encrypted text not null,
  key_last4     text not null,
  quality_model text not null,
  fast_model    text not null,
  is_default    boolean not null default false,
  last_ok_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table sender_identities (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null default app_ws() references workspaces(id) on delete cascade,
  provider         text not null check (provider in ('ses','smtp')),
  from_name        text not null,
  from_email       citext not null,
  reply_to         citext,
  config_encrypted text not null,   -- provider credentials (encrypted JSON)
  is_default       boolean not null default false,
  last_ok_at       timestamptz,
  created_at       timestamptz not null default now()
);

create table campaigns (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null default app_ws() references workspaces(id) on delete cascade,
  name               text not null,
  subject            text not null default '',
  preview_text       text,
  blocks             jsonb not null default '[]',   -- editable content, see lib/email/blocks.ts
  brief              text,                          -- what the user asked the AI for
  status            text not null default 'draft'
                     check (status in ('draft','sending','sent','failed')),
  audience           jsonb not null default '{"type":"all"}',  -- {type: all|list|segment, id?}
  sender_identity_id uuid references sender_identities(id) on delete set null,
  quality            jsonb,         -- last AI scorecard
  recipients         int not null default 0,
  sent_count         int not null default 0,
  failed_count       int not null default 0,
  sent_at            timestamptz,
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index campaigns_ws_idx on campaigns(workspace_id, created_at desc);
create trigger campaigns_touch before update on campaigns for each row execute function touch_updated_at();

create table email_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null default app_ws() references workspaces(id) on delete cascade,
  campaign_id  uuid references campaigns(id) on delete cascade,
  contact_id   uuid references contacts(id) on delete cascade,
  type         text not null check (type in ('sent','failed','open','click','unsubscribe','bounce','complaint')),
  meta         jsonb not null default '{}',
  occurred_at  timestamptz not null default now()
);
create index email_events_campaign_idx on email_events(campaign_id, type);
create index email_events_ws_time_idx on email_events(workspace_id, occurred_at desc);
-- One open / one unsubscribe per contact per campaign keeps counts honest.
create unique index email_events_once_idx on email_events(campaign_id, contact_id, type)
  where type in ('sent','open','unsubscribe');

-- Every AI call is metered here: cost visibility per tenant + quality tracking.
create table ai_runs (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null default app_ws() references workspaces(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  feature       text not null,       -- brand_voice | compose | critique | revise | segment | rewrite | subjects
  provider      text not null,
  model         text not null,
  status        text not null check (status in ('ok','error')),
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  quality_score numeric(4,1),
  error         text,
  created_at    timestamptz not null default now()
);
create index ai_runs_ws_time_idx on ai_runs(workspace_id, created_at desc);

-- ─── Roles, grants, row-level security ──────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'pollen_app') then
    create role pollen_app login nobypassrls;
  end if;
end $$;

grant usage on schema public to pollen_app;
grant select, insert, update, delete on all tables in schema public to pollen_app;
grant usage, select on all sequences in schema public to pollen_app;
grant execute on function app_ws(), app_is_admin() to pollen_app;

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Global tables: reachable only by the app role (authorization happens in app code).
do $$
declare t text;
begin
  foreach t in array array['users','workspaces','memberships','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy app_all on %I to pollen_app using (true) with check (true)', t);
  end loop;
end $$;

-- Tenant tables: one workspace at a time, unless in the platform admin console.
do $$
declare t text;
begin
  foreach t in array array['contacts','lists','list_members','segments','brand_kits',
                           'ai_credentials','sender_identities','campaigns','email_events','ai_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I to pollen_app
                      using (workspace_id = app_ws() or app_is_admin())
                      with check (workspace_id = app_ws() or app_is_admin())$p$, t);
  end loop;
end $$;

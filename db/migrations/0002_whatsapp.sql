-- Pollen — WhatsApp (official Cloud API, BYOK per tenant)
--
-- Each workspace connects its own Meta WhatsApp Business number: it stores its
-- own phone_number_id, WABA id, permanent access token and app secret (tokens
-- encrypted in the app). Pollen sends via the Graph API and receives inbound
-- messages on a per-tenant webhook (/api/wa/webhook/<workspace_id>).

-- One WhatsApp connection per workspace.
create table wa_credentials (
  workspace_id     uuid primary key default app_ws() references workspaces(id) on delete cascade,
  phone_number_id  text not null,
  waba_id          text,
  display_phone    text,                 -- e.g. +91 98xxxxxx, filled on test/connect
  token_encrypted  text not null,        -- permanent access token
  secret_encrypted text,                 -- Meta app secret, for webhook signature checks
  verify_token     text not null,        -- we generate this; tenant pastes it into Meta
  graph_version    text not null default 'v22.0',
  auto_reply       jsonb not null default '{"mode":"off"}',  -- off | away | ai  (+ text)
  last_ok_at       timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger wa_credentials_touch before update on wa_credentials for each row execute function touch_updated_at();

-- A thread with one WhatsApp user (identified by their E.164 phone).
create table wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null default app_ws() references workspaces(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  wa_phone        text not null,          -- the customer's number (digits, E.164 without +)
  name            text,                   -- WhatsApp profile name
  last_message_at timestamptz,
  last_inbound_at timestamptz,            -- drives the 24h free-form messaging window
  unread          int not null default 0,
  status          text not null default 'open' check (status in ('open','closed')),
  created_at      timestamptz not null default now(),
  unique (workspace_id, wa_phone)
);
create index wa_conversations_ws_idx on wa_conversations(workspace_id, last_message_at desc nulls last);
create index wa_conversations_contact_idx on wa_conversations(contact_id);

create table wa_messages (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null default app_ws() references workspaces(id) on delete cascade,
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  direction    text not null check (direction in ('in','out')),
  wa_message_id text,                     -- Meta's wamid, for status matching
  type         text not null default 'text',  -- text | template | image | ...
  body         text,                      -- rendered text we show in the thread
  template_name text,
  status       text,                      -- queued | sent | delivered | read | failed (out only)
  error        text,
  meta         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index wa_messages_conversation_idx on wa_messages(conversation_id, created_at);
create unique index wa_messages_wamid_idx on wa_messages(workspace_id, wa_message_id) where wa_message_id is not null;

-- A template broadcast to a list/segment (approved template + variable mapping).
create table wa_broadcasts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default app_ws() references workspaces(id) on delete cascade,
  name          text not null,
  template_name text not null,
  language      text not null default 'en',
  variables     jsonb not null default '[]',  -- ordered body {{n}} mappings: merge tags / literals
  audience      jsonb not null default '{"type":"all"}',
  status        text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  recipients    int not null default 0,
  sent_count    int not null default 0,
  failed_count  int not null default 0,
  sent_at       timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index wa_broadcasts_ws_idx on wa_broadcasts(workspace_id, created_at desc);

-- ─── Grants + RLS (same pattern as 0001) ────────────────────────────────────
grant select, insert, update, delete on all tables in schema public to pollen_app;
grant usage, select on all sequences in schema public to pollen_app;
revoke all on wa_credentials, wa_conversations, wa_messages, wa_broadcasts from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['wa_credentials','wa_conversations','wa_messages','wa_broadcasts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I to pollen_app
                      using (workspace_id = app_ws() or app_is_admin())
                      with check (workspace_id = app_ws() or app_is_admin())$p$, t);
  end loop;
end $$;

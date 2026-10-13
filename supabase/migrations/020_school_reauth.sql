-- 020_school_reauth.sql — in-app school re-authentication support.
--
-- 1. Adds 'auth_error' to crew_school_links.sync_status. The sync worker sets
--    this when the school rejects the saved credentials (SECURITY.md §4.3).
--    The web app surfaces it as "needs attention" and offers the re-auth form.
-- 2. Creates crew_credential_pending: validated-but-not-yet-applied school
--    credentials. The web re-auth form tests credentials against the school
--    portal; on success the ENCRYPTED pair lands here (AES-256-GCM, same
--    envelope as calendar tokens). A privileged process moves them into the
--    Secure Vault and marks the row processed. The web app can never read
--    the plaintext back.

-- 1. Widen the sync_status check to include auth_error.
alter table public.crew_school_links
  drop constraint if exists crew_school_links_sync_status_check;

alter table public.crew_school_links
  add constraint crew_school_links_sync_status_check
  check (sync_status in ('idle', 'syncing', 'ok', 'error', 'auth_error'));

-- 2. Pending credential updates.
create table public.crew_credential_pending (
  id             uuid        primary key default gen_random_uuid(),
  crew_member_id uuid        not null references public.crew_members(id) on delete cascade,
  pilot_id       uuid        not null references auth.users(id) on delete cascade,
  -- AES-256-GCM envelope ("v1:" + base64). Never plaintext. Never readable
  -- by the web app — only the privileged vault-sync process decrypts.
  username_enc   text        not null,
  password_enc   text        not null,
  validated_at   timestamptz not null default now(),
  processed_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- One unprocessed pending update per crew member at a time.
create unique index credential_pending_one_open
  on public.crew_credential_pending (crew_member_id)
  where processed_at is null;

comment on table public.crew_credential_pending is
  'Validated school credentials awaiting Secure Vault update. Encrypted at rest; web app writes only.';

-- RLS: pilots see and create only their own rows. No updates, no deletes
-- (the privileged process marks processed_at via service role).
alter table public.crew_credential_pending enable row level security;

create policy credential_pending_pilot_select
  on public.crew_credential_pending for select
  using (auth.uid() = pilot_id);

create policy credential_pending_pilot_insert
  on public.crew_credential_pending for insert
  with check (auth.uid() = pilot_id);

grant select, insert on public.crew_credential_pending to authenticated;

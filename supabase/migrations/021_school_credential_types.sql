-- 021_school_credential_types.sql — distinguish parent vs student credentials.
--
-- The crew_credential_pending table (020) holds validated-but-not-yet-applied
-- school credentials. Meheldi clarified these are TWO separate logins:
--   1. ParentVUE login (parent portal) — for server-side grade pulls
--   2. Student login (StudentVUE / Outlook / CTLS Learn) — for the laptop sync workers
--
-- This migration adds a credential_type column so the vault-sync process
-- knows where each credential pair belongs.

alter table public.crew_credential_pending
  add column credential_type text not null default 'parentvue'
  check (credential_type in ('parentvue', 'student'));

comment on column public.crew_credential_pending.credential_type is
  'parentvue = parent portal login (server-side pulls); student = student Microsoft/SSO login (laptop sync workers)';

-- The "one open row per member" rule now applies per credential type:
-- a member can have one pending parentvue update AND one pending student update.
drop index if exists credential_pending_one_open;

create unique index credential_pending_one_open
  on public.crew_credential_pending (crew_member_id, credential_type)
  where processed_at is null;

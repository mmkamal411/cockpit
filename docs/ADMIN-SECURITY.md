# Cockpit admin security model

How the admin command center stays safe. Written for the whole team —
backend, frontend, and anyone touching a privileged route.

## 1. Service-role handling

`src/lib/admin/serviceClient.ts` builds a Supabase client with
`SUPABASE_SERVICE_ROLE_KEY`. That key **bypasses all Row Level Security**.
Treat it like a root password:

- Server code only: route handlers, server actions, cron workers. It throws
  immediately if `typeof window !== "undefined"`, so it can never be bundled
  into client JS.
- Never log the key, never put it in a URL, never return it from an API.
- It is NOT a fallback for the publishable key: if it is missing, the client
  throws and the deploy fails loudly instead of silently running weak.
- Auth session persistence is disabled on the admin client (`persistSession:
  false, autoRefreshToken: false`) — it is a privileged tool, not a user
  session.

## 2. The two-layer admin gate

Every admin route is guarded twice, so a single misconfiguration cannot open
the door.

**Layer 1 — API (env var).** `requireAdmin()` in `src/lib/admin/auth.ts`
resolves the caller from the session cookie and checks their email against
the `ADMIN_EMAILS` env var (comma-separated, case-insensitive). Fails closed:
no email, no match, or any auth error → 403. Usage:

```ts
export async function GET(request: Request) {
  let adminEmail: string;
  try {
    adminEmail = await requireAdmin(request);
  } catch (response) {
    return response as Response;
  }
  // ... privileged work ...
}
```

**Layer 2 — database (allowlist table).** `public.is_admin(email)` is a
`SECURITY DEFINER` SQL function that checks the `admin_users` table
(normalized lowercase emails). `isAdminInDb()` calls it via RPC.
`requireAdminBothLayers()` runs both layers; either one denying access
blocks the action. Use the both-layers guard for the most sensitive routes
(user delete, table exports, impersonation view).

The migration is `supabase/migrations/003_admin_audit.sql`. After running it,
bootstrap the first admin with the commented-out seed `INSERT` in that file.

## 3. Why anon gets nothing

- The `admin_users` and `admin_audit_log` tables grant `SELECT` to the
  `authenticated` role only, and the RLS policies narrow that to admins via
  `public.is_admin(auth.jwt() ->> 'email')`. A signed-in non-admin sees zero
  rows.
- There are **no** insert/update/delete RLS policies on either table for any
  role. Writes happen only through the service-role client in the API layer,
  which bypasses RLS by design. A compromised user JWT can never insert audit
  rows (to fake a trail) or insert admin rows (to escalate itself).
- `anon` receives no grants at all — explicitly revoked in the migration, in
  case a default ever changes.

## 4. Destructive-action confirmation requirements

Any admin action that destroys data (`user.delete`, `crew_member.delete`,
bulk deletes) or exfiltrates data (`table.export`) must:

1. Require a two-step confirm in the UI: a typed confirmation (the target
   name or email, not just a button click) plus a stated reason, sent with
   the request.
2. Pass the both-layers admin gate (`requireAdminBothLayers`).
3. Write an audit row FIRST with `before` holding a snapshot of what will
   be destroyed, and `metadata.reason` holding the admin's stated reason.
   Destructive actions are logged even if the action itself then fails.
4. Prefer soft-delete (set a flag) over hard-delete where the schema allows
   it. Hard deletes are irreversible and should be rare.

Frontend team: never let a destructive button be one click. No destructive
action ships without the confirm step.

## 5. Impersonation view — read-only, never session hijacking

Admins sometimes need to see what a pilot sees (debugging a layout, a sync
problem). The rule:

- The impersonation view renders the pilot's data **read-only**, fetched with
  the admin (service-role) client. It is viewing data AS DISPLAYED FOR the
  user, never acting as the user.
- It must NEVER mint a session for the target user, set their cookies, or
  reuse their auth token. No `signInAs`, no token swapping, no cookie writes.
- The view opens in an explicit "viewing as" mode: a persistent banner names
  the pilot being viewed, and every read in that session is audit-logged as
  `admin.impersonate_view` with the target pilot's id.
- Actions are disabled in impersonation mode. If the admin needs to change
  something, they do it from the admin panel as themselves, audited.

## Quick reference

| Interface | Where | What |
|---|---|---|
| `createAdminClient()` | `src/lib/admin/serviceClient.ts` | Service-role client. Server only, throws in browser. |
| `isAdminEmail(email)` | `src/lib/admin/auth.ts` | Layer 1: ADMIN_EMAILS env check. |
| `isAdminInDb(email)` | `src/lib/admin/auth.ts` | Layer 2: admin_users table check via RPC. |
| `requireAdmin(request)` | `src/lib/admin/auth.ts` | Route guard, layer 1. Returns email or throws 403 Response. |
| `requireAdminBothLayers(request)` | `src/lib/admin/auth.ts` | Route guard, both layers. For destructive/export routes. |
| `logAdminAction(client, entry)` | `src/lib/admin/audit.ts` | Insert into admin_audit_log. Never throws. |
| `public.is_admin(text)` | migration 003 | DB-side admin check. SECURITY DEFINER, read-only. |

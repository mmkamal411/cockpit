/**
 * Admin command center — API contract types.
 *
 * These mirror the endpoints the backend architect is building in parallel
 * (src/app/api/admin/*). Rendering code must treat every field as
 * potentially missing and fall back gracefully — the backend may ship
 * these endpoints incrementally.
 */

export interface AdminStats {
  pilots: number;
  crew_members: number;
  grade_syncs_24h: number;
  todos: number;
  integrations_ok: number;
  integrations_total: number;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  crew_count: number;
  integration_count: number;
  suspended: boolean;
}

export interface UsersResponse {
  users: AdminUser[];
  total: number;
}

export interface IntegrationLink {
  id: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
}

export interface CrewMemberRow {
  id: string;
  display_name: string | null;
  relationship: string | null;
  age_tier: string | null;
}

export interface UserDetail {
  pilot: Record<string, unknown>;
  auth: { email: string; last_sign_in_at: string | null };
  integrations: IntegrationLink[];
  crew: CrewMemberRow[];
  counts: Record<string, number>;
  recent_audit: AuditEntry[];
}

export interface DeletePreview {
  would_delete: Record<string, number>;
}

export type IntegrationStatusValue = "ok" | "down" | "degraded" | "unknown";

export interface IntegrationStatus {
  id: string;
  name: string;
  status: string;
  detail: string;
  last_checked: string | null;
}

export interface TableInfo {
  name: string;
  row_count: number;
}

/**
 * GET /api/admin/tables actually returns { tables: [...] } (not a bare
 * array). The page normalizes both shapes.
 */
export interface TablesResponse {
  tables: TableInfo[];
}

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
}

export interface RlsPolicy {
  name: string;
  command: string;
  roles: string[] | null;
  using: string | null;
  with_check: string | null;
}

export interface RlsInfo {
  rls_enabled: boolean;
  rls_forced: boolean;
  policies: RlsPolicy[];
}

export interface QueryResult {
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
}

/**
 * Mirrors the admin_audit_log table (migration 003_admin_audit.sql):
 * actor_email / action / target_type / target_id / before / after /
 * metadata / created_at. The GET route may also send a legacy `actor`
 * alias — the UI normalizes both.
 */
export interface AuditEntry {
  id: string;
  actor_email: string | null;
  actor?: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  metadata?: unknown;
  created_at: string;
}

export function auditActor(e: AuditEntry): string {
  return e.actor_email ?? e.actor ?? "—";
}

export interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

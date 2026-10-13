import { createAdminClient } from "@/lib/admin/serviceClient";
import { logAdminAction } from "@/lib/admin/audit";
import { adminRoute, isAdminTable, jsonError } from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

const MAX_EXPORT_ROWS = 10000;
const PAGE_SIZE = 1000;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * GET /api/admin/tables/[name]/export?format=csv|json
 * Streams up to 10,000 rows as a downloadable file. The export is
 * audit-logged (table, format, row count). Both-layer admin guard.
 * Unknown table names are rejected with 400.
 */
export const GET = adminRoute<{ name: string }>(
  async (adminEmail, req, ctx) => {
    const { name } = await ctx.params;
    if (!isAdminTable(name)) {
      return jsonError(
        `Unknown table "${name}". Admin export is limited to the known tables.`,
        400,
      );
    }

    const formatParam = (req.nextUrl.searchParams.get("format") ?? "json").toLowerCase();
    if (formatParam !== "csv" && formatParam !== "json") {
      return jsonError('format must be "csv" or "json".', 400);
    }
    const format = formatParam as "csv" | "json";

    const admin = createAdminClient();

    const { count, error: countError } = await admin
      .from(name)
      .select("*", { count: "exact", head: true });
    if (countError) throw new Error(countError.message);
    const totalRows = Math.min(count ?? 0, MAX_EXPORT_ROWS);

    // Column order for CSV: prefer the RPC's ordinal order when available.
    let columnNames: string[] = [];
    try {
      const { data, error } = await admin.rpc("admin_table_columns", { p_table: name });
      if (error) throw error;
      columnNames = ((data ?? []) as { name: string }[]).map((column) => column.name);
    } catch (rpcError) {
      console.error("[admin] admin_table_columns RPC failed during export", rpcError);
    }

    await logAdminAction(admin, {
      actorEmail: adminEmail,
      action: "table.export",
      targetType: "table",
      targetId: name,
      metadata: { format, rows: totalRows, capped_at: MAX_EXPORT_ROWS },
    });

    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `${name}-export-${dateStamp}.${format}`;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          if (format === "csv") {
            let headerSent = false;
            for (let from = 0; from < totalRows; from += PAGE_SIZE) {
              const to = Math.min(from + PAGE_SIZE, totalRows) - 1;
              const { data, error } = await admin.from(name).select("*").range(from, to);
              if (error) throw new Error(error.message);
              const rows = (data ?? []) as Record<string, unknown>[];
              if (!headerSent) {
                if (columnNames.length === 0 && rows.length > 0) {
                  columnNames = Object.keys(rows[0]);
                }
                controller.enqueue(
                  encoder.encode(`${columnNames.map(csvCell).join(",")}\n`),
                );
                headerSent = true;
              }
              for (const row of rows) {
                controller.enqueue(
                  encoder.encode(
                    `${columnNames.map((column) => csvCell(row[column])).join(",")}\n`,
                  ),
                );
              }
            }
          } else {
            controller.enqueue(encoder.encode("[\n"));
            let emitted = 0;
            for (let from = 0; from < totalRows; from += PAGE_SIZE) {
              const to = Math.min(from + PAGE_SIZE, totalRows) - 1;
              const { data, error } = await admin.from(name).select("*").range(from, to);
              if (error) throw new Error(error.message);
              for (const row of (data ?? []) as Record<string, unknown>[]) {
                controller.enqueue(
                  encoder.encode(`${emitted > 0 ? ",\n" : ""}${JSON.stringify(row)}`),
                );
                emitted += 1;
              }
            }
            controller.enqueue(encoder.encode("\n]"));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type":
          format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  },
  { bothLayers: true },
);

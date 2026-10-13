/**
 * Export the full table (up to 10,000 rows) via the server-side export
 * endpoint. Plain anchor links — the browser downloads the file.
 */
export function ExportButtons({ tableName }: { tableName: string }) {
  const encoded = encodeURIComponent(tableName);
  const btn =
    "rounded-lg border border-white/15 px-3 py-1.5 font-mono text-xs text-stardust hover:border-cyan-400/40 hover:text-cyan-200";
  return (
    <div className="flex items-center gap-2">
      <a href={`/api/admin/tables/${encoded}/export?format=csv`} className={btn} download>
        Export CSV
      </a>
      <a href={`/api/admin/tables/${encoded}/export?format=json`} className={btn} download>
        Export JSON
      </a>
    </div>
  );
}

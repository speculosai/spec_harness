import { useEffect, useMemo, useRef, useState } from "react"
import { ResponsiveContainer } from "recharts"
import { ChevronDown, Loader2, Search } from "lucide-react"

/** Full-page chrome: white header bar (title/subtitle left, actions right) over a centered slate page. */
export function PageShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">{children}</main>
    </div>
  )
}

/** Stat tile: muted label (optional icon right), bold value, optional sub line. */
export function KpiCard({ label, value, sub, icon: Icon }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ComponentType<{ size?: number | string; className?: string }> }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        {Icon ? <Icon size={18} className="text-violet-600" /> : null}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  )
}

/** Chart card: heading + a fixed-height box that auto-sizes any recharts chart passed as children. */
export function ChartCard({ title, subtitle, height, children }: { title: string; subtitle?: string; height?: number; children: React.ReactElement }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-4" style={{ height: height ?? 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** One DataTable column: `key` indexes the row, `render` draws the cell, `sortValue` drives sort + search. */
export type Column<T> = { key: string; label: string; render?: (row: T) => React.ReactNode; sortValue?: (row: T) => string | number; align?: "left" | "right" }

const raw = <T,>(row: T, key: string): unknown => (row as any)[key]

// Text used for search matching: sortValue, else a scalar render(), else the raw field.
function cellText<T>(row: T, col: Column<T>): string {
  if (col.sortValue) return String(col.sortValue(row))
  if (col.render) {
    const node = col.render(row)
    if (typeof node === "string" || typeof node === "number") return String(node)
  }
  const v = raw(row, col.key)
  return v == null ? "" : String(v)
}

/** Searchable, sortable, paginated table — plain useState/useMemo, no table library. */
export function DataTable<T>({ data, columns, searchable, pageSize, emptyTitle }: { data: T[]; columns: Column<T>[]; searchable?: boolean; pageSize?: number; emptyTitle?: string }) {
  const size = pageSize ?? 10
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [asc, setAsc] = useState(true)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data
    return data.filter((row) => columns.some((col) => cellText(row, col).toLowerCase().includes(q)))
  }, [data, columns, query])

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return filtered
    const dir = asc ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = col.sortValue ? col.sortValue(a) : raw(a, col.key)
      const bv = col.sortValue ? col.sortValue(b) : raw(b, col.key)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true }) * dir
    })
  }, [filtered, columns, sortKey, asc])

  const pages = Math.max(1, Math.ceil(sorted.length / size))
  const current = Math.min(page, pages - 1)
  const rows = sorted.slice(current * size, current * size + size)

  function toggleSort(key: string) {
    if (key === sortKey) setAsc(!asc)
    else { setSortKey(key); setAsc(true) }
    setPage(0)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {searchable ? (
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search size={16} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0) }}
            placeholder="Search…"
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-violet-600 ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? <ChevronDown size={14} className={asc ? "rotate-180" : ""} /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50">
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-slate-700 ${col.align === "right" ? "text-right" : "text-left"}`}>
                    {col.render ? col.render(row) : String(raw(row, col.key) ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 ? <EmptyState title={emptyTitle ?? "No rows"} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <span>{sorted.length} rows</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, current - 1))}
            disabled={current === 0}
            className="rounded-lg border border-slate-200 px-3 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Prev
          </button>
          <span>Page {current + 1} of {pages}</span>
          <button
            onClick={() => setPage(Math.min(pages - 1, current + 1))}
            disabled={current >= pages - 1}
            className="rounded-lg border border-slate-200 px-3 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

/** Centered spinner for the loading phase of a fetch. */
export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Loader2 size={24} className="animate-spin text-violet-600" />
      <span className="text-sm">{label ?? "Loading…"}</span>
    </div>
  )
}

/** Friendly red banner for a failed fetch — never surface a raw stack trace. */
export function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>
}

/** Centered muted block for "nothing to show here". */
export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{body}</p> : null}
    </div>
  )
}

/** Runs `fetcher` once on mount; returns { data, loading, error } and never sets state after unmount. */
export function useAsyncData<T>(fetcher: () => Promise<T>): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef(fetcher)
  ref.current = fetcher

  useEffect(() => {
    let alive = true
    ref.current()
      .then((d) => { if (alive) setData(d) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return { data, loading, error }
}

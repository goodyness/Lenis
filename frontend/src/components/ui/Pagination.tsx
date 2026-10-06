interface PaginationProps {
  page: number
  pages: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pages, pageSize, total, onPageChange }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const getPageNumbers = (): (number | '...')[] => {
    if (pages <= 7) {
      return Array.from({ length: pages }, (_, i) => i + 1)
    }
    const result: (number | '...')[] = [1]
    if (page > 3) result.push('...')
    for (let p = Math.max(2, page - 1); p <= Math.min(pages - 1, page + 1); p++) {
      result.push(p)
    }
    if (page < pages - 2) result.push('...')
    result.push(pages)
    return result
  }

  return (
    <nav
      className="flex items-center justify-between border-t border-slate-200 px-4 py-3"
      aria-label="Pagination"
    >
      <p className="text-sm text-slate-500">
        {total === 0 ? 'No results' : `Showing ${from}\u2013${to} of ${total}`}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {getPageNumbers().map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-1 text-sm text-slate-400">
              &hellip;
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p as number)}
              aria-current={p === page ? 'page' : undefined}
              className={[
                'inline-flex h-8 w-8 items-center justify-center rounded border text-sm font-medium transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                p === page
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </nav>
  )
}

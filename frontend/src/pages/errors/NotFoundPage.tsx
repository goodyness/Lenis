import { Link } from 'react-router-dom'
import { ErrorLayout } from '../../components/errors/ErrorLayout'

export function NotFoundPage() {
  return (
    <ErrorLayout
      statusCode="404"
      badgeText="404 Not Found"
      badgeVariant="neutral"
      title="Page not found"
      message="Sorry, we couldn't find the page you're looking for. It might have been removed, had its name changed, or is temporarily unavailable."
      suggestion="Check the URL for errors or try one of the helpful links below."
      icon={
        <svg
          className="h-10 w-10 text-slate-700"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"
          />
        </svg>
      }
    >
      {/* Helpful shortcut cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-left">
        <Link
          to="/"
          className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
        >
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Explore
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900 group-hover:text-indigo-600">
            Home Page →
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Return to the main overview.
          </p>
        </Link>

        <Link
          to="/docs"
          className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
        >
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Guides
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900 group-hover:text-indigo-600">
            Documentation →
          </p>
          <p className="mt-1 text-xs text-slate-500">
            API reference and integration docs.
          </p>
        </Link>

        <Link
          to="/contact"
          className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
        >
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Help
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900 group-hover:text-indigo-600">
            Contact Support →
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Get assistance from our team.
          </p>
        </Link>
      </div>
    </ErrorLayout>
  )
}

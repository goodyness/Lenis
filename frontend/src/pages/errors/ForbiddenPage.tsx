import { Link } from 'react-router-dom'
import { ErrorLayout } from '../../components/errors/ErrorLayout'
import { useAuthStore } from '../../lib/auth-store'

interface ForbiddenPageProps {
  message?: string
  requiredRole?: string
}

export function ForbiddenPage({ message, requiredRole }: ForbiddenPageProps) {
  const user = useAuthStore((s) => s.user)
  const currentRole = user?.role || user?.account_type || 'unauthenticated'

  return (
    <ErrorLayout
      statusCode="403"
      badgeText="403 Forbidden"
      badgeVariant="warning"
      title="Access Restricted"
      message={
        message ||
        "You do not have permission to access this resource or area. Your current account role does not satisfy the required authorization level."
      }
      suggestion={
        requiredRole
          ? `Required role: ${requiredRole} (Your active role: ${currentRole})`
          : 'Please make sure you are signed in with the correct credentials or contact your administrator.'
      }
      icon={
        <svg
          className="h-10 w-10 text-amber-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      }
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-left">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
          Need access to this section?
        </h4>
        <p className="mt-1 text-xs text-amber-700">
          If you believe this is an error or need your account permissions upgraded,
          please check your verification status or reach out to our team.
        </p>
        <div className="mt-3 flex gap-3">
          <Link
            to="/dashboard/settings"
            className="text-xs font-bold text-amber-900 underline hover:text-amber-800"
          >
            Account Settings
          </Link>
          <Link
            to="/contact"
            className="text-xs font-bold text-amber-900 underline hover:text-amber-800"
          >
            Request Access
          </Link>
        </div>
      </div>
    </ErrorLayout>
  )
}

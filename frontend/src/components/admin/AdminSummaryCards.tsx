import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../lib/api'

interface DashboardSummary {
  total_users: number
  pending_verification_requests: number
  verified_developers: number
  active_merchants: number
}

type LoadState = 'loading' | 'ready' | 'error'

interface MetricCardProps {
  label: string
  value: number | null
  loading: boolean
  colorClass: string
  icon: React.ReactNode
  to?: string
}

function MetricCard({ label, value, loading, colorClass, icon, to }: MetricCardProps) {
  const content = (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300 transition-colors">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={['flex h-8 w-8 items-center justify-center rounded-full', colorClass].join(' ')}>
          {icon}
        </span>
      </div>
      <div className="mt-3">
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-slate-200" />
        ) : (
          <p className="text-2xl font-semibold text-slate-900">
            {value !== null ? value.toLocaleString() : '-'}
          </p>
        )}
      </div>
    </div>
  )

  if (to) {
    return <Link to={to} className="block focus:outline-none focus:ring-2 focus:ring-slate-400 rounded-lg">{content}</Link>
  }

  return content
}

const UsersIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
  </svg>
)

const ClockIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
  </svg>
)

const CheckIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
)

const StoreIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
  </svg>
)

export function AdminSummaryCards() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    async function fetchSummary() {
      try {
        const { data } = await apiClient.get<DashboardSummary>('/admin/dashboard')
        if (!cancelled) {
          setSummary(data)
          setLoadState('ready')
        }
      } catch {
        if (!cancelled) {
          setLoadState('error')
        }
      }
    }

    fetchSummary()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadState === 'error') {
    return (
      <p className="text-sm text-red-600" role="alert">
        Failed to load dashboard metrics. Please refresh the page.
      </p>
    )
  }

  const loading = loadState === 'loading'

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Platform metrics">
      <MetricCard
        label="Total Users"
        value={summary?.total_users ?? null}
        loading={loading}
        colorClass="bg-blue-50 text-blue-600"
        icon={<UsersIcon />}
        to="/admin/users"
      />
      <MetricCard
        label="Pending Verifications"
        value={summary?.pending_verification_requests ?? null}
        loading={loading}
        colorClass="bg-yellow-50 text-yellow-600"
        icon={<ClockIcon />}
        to="/admin/verification"
      />
      <MetricCard
        label="Verified Developers"
        value={summary?.verified_developers ?? null}
        loading={loading}
        colorClass="bg-green-50 text-green-600"
        icon={<CheckIcon />}
        to="/admin/verification"
      />
      <MetricCard
        label="Merchants (KYC)"
        value={summary?.active_merchants ?? null}
        loading={loading}
        colorClass="bg-purple-50 text-purple-600"
        icon={<StoreIcon />}
        to="/admin/merchants"
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { Card } from '../ui/Card'
import { StatusBadge } from '../ui/StatusBadge'
import { EmailVerificationBanner } from './EmailVerificationBanner'

interface UserProfile {
  id: string
  email: string
  full_name: string
  account_type: string
  status: string
  email_verified: boolean
  created_at: string
}

type LoadState = 'loading' | 'ready' | 'error'

export function DashboardOverview() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    async function fetchProfile() {
      try {
        const { data } = await apiClient.get<UserProfile>('/users/me')
        if (!cancelled) {
          setProfile(data)
          setLoadState('ready')
        }
      } catch {
        if (!cancelled) {
          setLoadState('error')
        }
      }
    }

    fetchProfile()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadState === 'loading') {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading profile">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </div>
    )
  }

  if (loadState === 'error' || !profile) {
    return (
      <p className="text-sm text-red-600" role="alert">
        Failed to load your profile. Please refresh the page.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {/* Email verification prompt */}
      {!profile.email_verified && (
        <EmailVerificationBanner email={profile.email} />
      )}

      {/* Profile summary */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Welcome back, {profile.full_name}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Here is an overview of your account.
        </p>
      </div>

      {/* Account details card */}
      <Card title="Account details">
        <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-2 sm:gap-x-8">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Name
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{profile.full_name}</dd>
          </div>

          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Email
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-slate-900">
              {profile.email}
              {profile.email_verified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                  Unverified
                </span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Account type
            </dt>
            <dd className="mt-1">
              <StatusBadge status={profile.account_type} />
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Account status
            </dt>
            <dd className="mt-1">
              <StatusBadge status={profile.status} />
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Member since
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {new Date(profile.created_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  )
}

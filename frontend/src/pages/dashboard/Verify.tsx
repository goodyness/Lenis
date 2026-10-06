import { useCallback, useEffect, useState } from 'react'
import { VerificationRequestForm, VerificationResponse } from '../../components/dashboard/VerificationRequestForm'
import { VerificationStatusCard } from '../../components/dashboard/VerificationStatusCard'
import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { ToastProvider } from '../../components/ui/Toaster'
import { apiClient } from '../../lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewState =
  | { kind: 'loading' }
  | { kind: 'form' }
  | { kind: 'status'; data: VerificationResponse }
  | { kind: 'forbidden' }
  | { kind: 'error' }

// The /verification/requests/mine endpoint can return additional fields
interface VerificationRequestData extends VerificationResponse {
  rejection_reason?: string
  status: 'pending' | 'approved' | 'rejected'
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="max-w-2xl space-y-4" aria-busy="true" aria-label="Loading verification status">
      <div className="h-6 w-56 animate-pulse rounded bg-slate-200" />
      <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page content (separate from shell so hooks work cleanly)
// ---------------------------------------------------------------------------

function VerifyContent() {
  const [view, setView] = useState<ViewState>({ kind: 'loading' })

  const fetchStatus = useCallback(async () => {
    setView({ kind: 'loading' })
    try {
      const { data } = await apiClient.get<VerificationRequestData>(
        '/verification/requests/mine',
      )
      setView({ kind: 'status', data })
    } catch (err: unknown) {
      const error = err as { response?: { status?: number } }
      const status = error?.response?.status

      if (status === 404) {
        setView({ kind: 'form' })
      } else if (status === 403) {
        setView({ kind: 'forbidden' })
      } else {
        setView({ kind: 'error' })
      }
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  function handleFormSuccess(data: VerificationResponse) {
    setView({ kind: 'status', data })
  }

  function handleResubmit() {
    setView({ kind: 'form' })
  }

  if (view.kind === 'loading') {
    return <Skeleton />
  }

  if (view.kind === 'forbidden') {
    return (
      <div className="max-w-2xl">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-600">
            Verification is only available for developer accounts.
          </p>
        </div>
      </div>
    )
  }

  if (view.kind === 'error') {
    return (
      <div className="max-w-2xl space-y-3" role="alert">
        <p className="text-sm text-red-600">
          Failed to load verification status. Please try again.
        </p>
        <button
          type="button"
          onClick={fetchStatus}
          className="text-sm font-medium text-slate-700 underline hover:text-slate-900"
        >
          Retry
        </button>
      </div>
    )
  }

  if (view.kind === 'form') {
    return <VerificationRequestForm onSuccess={handleFormSuccess} />
  }

  // status view
  const d = view.data as VerificationRequestData
  const isRejected = d.status === 'rejected'

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Developer Verification</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track the status of your identity and business verification request.
        </p>
      </div>
      <VerificationStatusCard
        status={d.status}
        rejectionReason={d.rejection_reason}
        submittedAt={d.created_at}
        fullLegalName={d.full_legal_name}
        country={d.country}
        businessType={d.business_type}
        websiteUrl={d.website_url}
        intendedUse={d.intended_use}
        onResubmit={isRejected ? handleResubmit : undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export function Verify() {
  return (
    <ProtectedRoute>
      <AppShell>
        <ToastProvider>
          <VerifyContent />
        </ToastProvider>
      </AppShell>
    </ProtectedRoute>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { UserTable } from '../../components/admin/UserTable'
import { SuspendedUsersTab } from '../../components/admin/SuspendedUsersTab'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { useAuthStore } from '../../lib/auth-store'
import { apiClient } from '../../lib/api'
import { AxiosError } from 'axios'

type ActionType = 'suspend' | 'reactivate' | 'promote'

interface PendingAction {
  type: ActionType
  userId: string
  email: string
}

interface SuspendFormState {
  reason: string
  message: string
}

interface ErrorDetail {
  detail?: string
  code?: string
}

export function UserManagement() {
  const user = useAuthStore((s) => s.user)
  const isSuperadmin = user?.role === 'superadmin'

  const [activeTab, setActiveTab] = useState<'all' | 'suspended'>('all')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [suspendForm, setSuspendForm] = useState<SuspendFormState>({ reason: '', message: '' })

  // Banner state
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear success message after 3 s
  useEffect(() => {
    if (successMessage) {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 3000)
    }
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [successMessage])

  function openModal(type: ActionType, userId: string, email: string) {
    setErrorBanner(null)
    setSuspendForm({ reason: '', message: '' })
    setPendingAction({ type, userId, email })
  }

  function closeModal() {
    if (!actionLoading) setPendingAction(null)
  }

  async function handleConfirm() {
    if (!pendingAction) return
    setActionLoading(true)

    const { type, userId, email } = pendingAction
    const endpointMap: Record<ActionType, string> = {
      suspend: `/admin/users/${userId}/suspend`,
      reactivate: `/admin/users/${userId}/reactivate`,
      promote: `/admin/users/${userId}/promote-admin`,
    }
    const labelMap: Record<ActionType, string> = {
      suspend: `${email} has been suspended.`,
      reactivate: `${email} has been reactivated.`,
      promote: `${email} has been promoted to admin.`,
    }

    try {
      if (type === 'suspend') {
        await apiClient.post(endpointMap[type], {
          reason: suspendForm.reason || null,
          message: suspendForm.message || null,
        })
      } else {
        await apiClient.post(endpointMap[type])
      }
      setPendingAction(null)
      setRefreshTrigger((t) => t + 1)
      setSuccessMessage(labelMap[type])
    } catch (err) {
      const axiosErr = err as AxiosError<ErrorDetail>
      const status = axiosErr.response?.status
      if (status === 403) {
        setErrorBanner('You cannot perform this action on a superadmin account.')
      } else {
        setErrorBanner('Action failed. Please try again.')
      }
      setPendingAction(null)
    } finally {
      setActionLoading(false)
    }
  }

  const modalConfig: Record<ActionType, { title: string; description: string; confirmLabel: string; confirmVariant: 'primary' | 'danger' }> = {
    suspend: {
      title: 'Suspend User',
      description: `Are you sure you want to suspend ${pendingAction?.email ?? ''}? They will lose access to the platform immediately.`,
      confirmLabel: 'Suspend',
      confirmVariant: 'danger',
    },
    reactivate: {
      title: 'Reactivate User',
      description: `Are you sure you want to reactivate ${pendingAction?.email ?? ''}? Their account will be restored to active status.`,
      confirmLabel: 'Reactivate',
      confirmVariant: 'primary',
    },
    promote: {
      title: 'Promote to Admin',
      description: `This action will grant admin privileges to ${pendingAction?.email ?? ''}. This cannot be undone without superadmin intervention.`,
      confirmLabel: 'Promote',
      confirmVariant: 'primary',
    },
  }

  const currentModal = pendingAction ? modalConfig[pendingAction.type] : null

  return (
    <ProtectedRoute requiredRole="admin">
      <AppShell>
        <div className="space-y-6">
          {/* Page header */}
          <div>
            <h1 className="text-xl font-semibold text-slate-900">User Management</h1>
            <p className="mt-0.5 text-sm text-slate-500">Manage platform accounts.</p>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {([
              { label: 'All Users', value: 'all' },
              { label: 'Suspended & Appeals', value: 'suspended' },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={[
                  'rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 whitespace-nowrap',
                  activeTab === tab.value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Error banner */}
          {errorBanner && (
            <div
              className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm font-medium text-red-700">{errorBanner}</p>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                aria-label="Dismiss error"
                className="ml-4 rounded p-1 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Success banner */}
          {successMessage && (
            <div
              className="rounded-lg border border-green-200 bg-green-50 px-4 py-3"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-green-700">{successMessage}</p>
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'all' ? (
            <UserTable
              isSuperadmin={isSuperadmin}
              onSuspend={(id, email) => openModal('suspend', id, email)}
              onReactivate={(id, email) => openModal('reactivate', id, email)}
              onPromote={(id, email) => openModal('promote', id, email)}
              refreshTrigger={refreshTrigger}
            />
          ) : (
            <SuspendedUsersTab
              isSuperadmin={isSuperadmin}
              onReactivate={(id, email) => openModal('reactivate', id, email)}
              refreshTrigger={refreshTrigger}
              onRefresh={() => setRefreshTrigger((t) => t + 1)}
            />
          )}
        </div>

        {/* Confirmation modal */}
        {pendingAction && currentModal && (
          <Modal
            isOpen={true}
            onClose={closeModal}
            title={currentModal.title}
          >
            <p className="text-sm text-slate-600">{currentModal.description}</p>

            {/* Suspend-specific fields: reason + message */}
            {pendingAction.type === 'suspend' && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="suspend-reason" className="text-sm font-medium text-slate-700">
                    Reason <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <select
                    id="suspend-reason"
                    value={suspendForm.reason}
                    onChange={(e) => setSuspendForm((f) => ({ ...f, reason: e.target.value }))}
                    disabled={actionLoading}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="">— Select a reason —</option>
                    <option value="policy_violation">Policy Violation</option>
                    <option value="fraud">Fraudulent Activity</option>
                    <option value="spam">Spam or Abuse</option>
                    <option value="identity_verification_failed">Identity Verification Failed</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="suspend-message" className="text-sm font-medium text-slate-700">
                    Message to user <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="suspend-message"
                    rows={3}
                    disabled={actionLoading}
                    placeholder="Explain what the user did and what they need to do to reinstate their account…"
                    value={suspendForm.message}
                    onChange={(e) => setSuspendForm((f) => ({ ...f, message: e.target.value }))}
                    maxLength={2000}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 resize-y focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                  <p className="text-xs text-slate-400 text-right">{suspendForm.message.length}/2000</p>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={closeModal}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                variant={currentModal.confirmVariant}
                size="md"
                loading={actionLoading}
                onClick={handleConfirm}
              >
                {currentModal.confirmLabel}
              </Button>
            </div>
          </Modal>
        )}
      </AppShell>
    </ProtectedRoute>
  )
}

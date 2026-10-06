import { useState } from 'react'
import { suspendMerchant, unsuspendMerchant } from '../../services/admin'
import type { MerchantUserStatus } from '../../services/admin'
import { ApiError } from '../../services/errors'
import { useToast } from '../ui/Toaster'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

interface SuspendMerchantModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  merchantName: string
  currentStatus: MerchantUserStatus
  onSuccess: (newStatus: MerchantUserStatus) => void
}

export function SuspendMerchantModal({
  isOpen,
  onClose,
  userId,
  merchantName,
  currentStatus,
  onSuccess,
}: SuspendMerchantModalProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const isSuspending = currentStatus === 'active'

  async function handleConfirm() {
    setLoading(true)
    try {
      if (isSuspending) {
        await suspendMerchant(userId)
        toast.success('Merchant suspended')
        onSuccess('suspended')
        onClose()
      } else {
        await unsuspendMerchant(userId)
        toast.success('Merchant unsuspended')
        onSuccess('active')
        onClose()
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'MERCHANT_ALREADY_SUSPENDED'
      ) {
        toast.error('Merchant is already suspended')
        onClose()
      } else if (err instanceof ApiError) {
        // Keep modal open for other errors
        toast.error(err.detail)
      } else {
        toast.error('An unexpected error occurred')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isSuspending ? 'Suspend Merchant' : 'Unsuspend Merchant'}
    >
      <div className="space-y-5">
        {isSuspending ? (
          /* Suspend warning — amber */
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">
              You are about to suspend{' '}
              <strong>{merchantName}</strong>. This will immediately
              deactivate all their active payment links and prevent them from
              receiving payments. This action can be undone.
            </p>
          </div>
        ) : (
          /* Unsuspend info — blue */
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-sm text-blue-800">
              You are about to unsuspend{' '}
              <strong>{merchantName}</strong>. Payment links that were
              deactivated during this suspension will be reactivated. Any
              links deactivated for other reasons will remain inactive.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={isSuspending ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={loading}
          >
            {isSuspending ? 'Suspend Merchant' : 'Unsuspend Merchant'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

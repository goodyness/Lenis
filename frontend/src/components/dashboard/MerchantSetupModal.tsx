import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { OnboardingStatus } from '../../stores/onboardingStore'

interface Props {
  status: OnboardingStatus
  onDismiss: () => void
}

/**
 * Popup shown to merchants whose setup is incomplete.
 * Lists what is missing and links them to /onboarding.
 *
 * Shown when:
 * - onboarding is not complete (profile step, business step, or KYC not submitted)
 */
export function MerchantSetupModal({ status, onDismiss }: Props) {
  const navigate = useNavigate()

  // Derive missing items from the onboarding step number.
  // current_step = 1 → none complete, current_step = 2 → step 1 done, etc.
  const missingItems: string[] = []

  if (status.current_step <= 1) {
    missingItems.push('Personal information (name, country, phone)')
  }
  if (status.current_step <= 2) {
    missingItems.push('Business information')
  }
  if (status.current_step <= 3) {
    missingItems.push('Identity verification (KYC)')
  }
  if (!status.wallet_added) {
    missingItems.push('Payout wallet address')
  }

  return (
    <Modal isOpen title="Complete your profile" onClose={onDismiss}>
      <p className="text-sm text-slate-600">
        Before you can create payment links or invoices, you need to complete
        your account setup. Here is what is still missing:
      </p>

      <ul className="mt-4 space-y-2" aria-label="Incomplete setup items">
        {missingItems.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
            {/* Warning icon */}
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          Remind me later
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate('/onboarding')}
        >
          Complete setup
        </Button>
      </div>
    </Modal>
  )
}

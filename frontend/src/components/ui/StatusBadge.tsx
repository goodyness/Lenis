import { Badge } from './Badge'

interface StatusBadgeProps {
  status?: string | null
  className?: string
}

type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

const statusMap: Record<string, BadgeVariant> = {
  active: 'green',
  unverified: 'yellow',
  suspended: 'red',
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
  verified: 'blue',
  merchant: 'purple',
  developer: 'blue',
  admin: 'red',
  superadmin: 'red',
  // Onboarding statuses
  incomplete: 'yellow',
  pending_kyc_review: 'yellow',
  kyc_approved: 'green',
  kyc_rejected: 'red',
  // KYC statuses
  not_started: 'default',
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (!status) {
    return (
      <Badge variant="default" className={className}>
        Unknown
      </Badge>
    )
  }
  const clean = String(status).toLowerCase()
  const variant: BadgeVariant = statusMap[clean] ?? 'default'
  const label = clean.charAt(0).toUpperCase() + clean.slice(1).replace(/_/g, ' ')
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  )
}

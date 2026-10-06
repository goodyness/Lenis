import { ErrorLayout } from '../../components/errors/ErrorLayout'

interface MaintenancePageProps {
  message?: string
  estimatedTime?: string
}

export function MaintenancePage({
  message,
  estimatedTime = 'a few minutes',
}: MaintenancePageProps) {
  return (
    <ErrorLayout
      statusCode="503"
      badgeText="503 Maintenance"
      badgeVariant="warning"
      title="System Maintenance in Progress"
      message={
        message ||
        "We are performing scheduled upgrades and maintenance to improve system reliability and network performance."
      }
      suggestion={`Expected to be back online within ${estimatedTime}. Thank you for your patience.`}
      showReloadButton={true}
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
            d="M11.42 15.17L17.25 21A2.67 2.67 0 1021 17.25l-5.83-5.83m0 0a5.25 5.25 0 00-7.42-7.42m7.42 7.42l-5.83 5.83a5.25 5.25 0 01-7.42-7.42l5.83-5.83"
          />
        </svg>
      }
    />
  )
}

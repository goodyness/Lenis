import { useLocation } from 'react-router-dom'
import { ErrorLayout } from '../../components/errors/ErrorLayout'

interface ServerErrorPageProps {
  errorDetails?: string | Error | null
  message?: string
}

export function ServerErrorPage({
  errorDetails,
  message,
}: ServerErrorPageProps) {
  const location = useLocation()
  const stateError = (location.state as { error?: string | Error })?.error

  const details = errorDetails || stateError

  return (
    <ErrorLayout
      statusCode="500"
      badgeText="500 Server Error"
      badgeVariant="danger"
      title="Internal server error"
      message={
        message ||
        "We're experiencing technical difficulties on our end. Our engineering team has been notified and is working to resolve the issue."
      }
      suggestion="Please refresh the page in a few moments, or check back shortly."
      showReloadButton={true}
      errorDetails={details}
      icon={
        <svg
          className="h-10 w-10 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.75 6a3.75 3.75 0 013.3-2h5.9a3.75 3.75 0 013.3 2l2.1 2.55a4.5 4.5 0 01.9 2.7"
          />
        </svg>
      }
    />
  )
}

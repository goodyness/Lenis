import { useLocation, useSearchParams } from 'react-router-dom'
import { ErrorLayout } from '../../components/errors/ErrorLayout'

export function GenericErrorPage() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const state = (location.state as {
    code?: string
    title?: string
    message?: string
    details?: string
  }) || {}

  const code = searchParams.get('code') || state.code || 'Error'
  const title = searchParams.get('title') || state.title || 'An error occurred'
  const message =
    searchParams.get('message') ||
    state.message ||
    'The requested operation could not be completed.'
  const details = searchParams.get('details') || state.details || null

  return (
    <ErrorLayout
      statusCode={code}
      title={title}
      message={message}
      badgeText={code !== 'Error' ? `Status ${code}` : 'Notice'}
      badgeVariant="neutral"
      showReloadButton={true}
      errorDetails={details}
    />
  )
}

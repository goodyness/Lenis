import { APIKeyPanel } from '../../components/dashboard/APIKeyPanel'
import { ToastProvider } from '../../components/ui/Toaster'

export function ApiKeys() {
  return (
    <ToastProvider>
      <APIKeyPanel />
    </ToastProvider>
  )
}

import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { DashboardOverview } from '../../components/dashboard/DashboardOverview'

export function Dashboard() {
  return (
    <ProtectedRoute>
      <AppShell>
        <DashboardOverview />
      </AppShell>
    </ProtectedRoute>
  )
}

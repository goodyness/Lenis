import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { AdminSummaryCards } from '../../components/admin/AdminSummaryCards'
import { AuditLogTable } from '../../components/admin/AuditLogTable'

export function AdminDashboard() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AppShell>
        <div className="space-y-8">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Admin Dashboard</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Platform overview and recent activity.
            </p>
          </div>

          <AdminSummaryCards />

          <AuditLogTable />
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}

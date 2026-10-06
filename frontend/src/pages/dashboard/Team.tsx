import { useCallback, useEffect, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toaster'
import { apiClient } from '../../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  member_id: string
  email: string
  full_name: string
  role: 'owner' | 'admin' | 'developer'
  accepted_at: string | null
}

type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

const ROLE_BADGE: Record<TeamMember['role'], BadgeVariant> = {
  owner: 'purple',
  admin: 'blue',
  developer: 'default',
}

const VALID_ROLES = ['admin', 'developer'] as const
type AssignableRole = (typeof VALID_ROLES)[number]

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-slate-100" />
        </td>
      ))}
    </tr>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Team() {
  const { toast } = useToast()

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite modal
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AssignableRole>('developer')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Role change modal
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null)
  const [newRole, setNewRole] = useState<AssignableRole>('developer')
  const [roleLoading, setRoleLoading] = useState(false)

  // Remove confirmation
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiClient.get<TeamMember[]>('/merchant/team')
      setMembers(data ?? [])
    } catch {
      setError('Failed to load team members.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  // ── Invite ──────────────────────────────────────────────────────────────────

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      setInviteError('Email is required.')
      return
    }
    setInviteLoading(true)
    setInviteError(null)
    try {
      await apiClient.post('/merchant/team/invite', {
        email: inviteEmail.trim(),
        role: inviteRole,
      })
      toast({ title: 'Invitation sent', description: `Invite sent to ${inviteEmail}.` })
      setShowInvite(false)
      setInviteEmail('')
      setInviteRole('developer')
      await loadMembers()
    } catch (err: unknown) {
      const msg =
        typeof err === 'object' && err !== null && 'response' in err
          ? ((err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? 'Failed to send invitation.')
          : 'Failed to send invitation.'
      setInviteError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setInviteLoading(false)
    }
  }

  // ── Role update ─────────────────────────────────────────────────────────────

  async function handleRoleChange() {
    if (!roleTarget) return
    setRoleLoading(true)
    try {
      await apiClient.patch(`/merchant/team/${roleTarget.member_id}/role`, { role: newRole })
      toast({ title: 'Role updated', description: `${roleTarget.email} is now ${newRole}.` })
      setRoleTarget(null)
      await loadMembers()
    } catch {
      toast({ title: 'Error', description: 'Failed to update role.', variant: 'destructive' })
    } finally {
      setRoleLoading(false)
    }
  }

  // ── Remove ──────────────────────────────────────────────────────────────────

  async function handleRemove() {
    if (!removeTarget) return
    setRemoveLoading(true)
    try {
      await apiClient.delete(`/merchant/team/${removeTarget.member_id}`)
      toast({ title: 'Member removed', description: `${removeTarget.email} has been removed.` })
      setRemoveTarget(null)
      await loadMembers()
    } catch (err: unknown) {
      const detail =
        typeof err === 'object' && err !== null && 'response' in err
          ? ((err as { response?: { data?: { detail?: { error?: string } } } }).response?.data?.detail?.error)
          : undefined
      const msg = detail === 'cannot_remove_sole_owner'
        ? 'Cannot remove the sole owner of the organisation.'
        : 'Failed to remove member.'
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setRemoveLoading(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage who has access to your Lenis organisation.
          </p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          Invite member
        </Button>
      </div>

      {/* Members table */}
      <Card>
        {error && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    No team members yet. Invite someone to get started.
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.member_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{m.full_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{m.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={ROLE_BADGE[m.role]} className="capitalize">
                        {m.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {m.accepted_at
                        ? new Date(m.accepted_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : <span className="italic text-slate-400">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.role !== 'owner' && (
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRoleTarget(m)
                              setNewRole(m.role === 'admin' ? 'developer' : 'admin')
                            }}
                            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            Change role
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveTarget(m)}
                            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Invite Modal ────────────────────────────────────────────────────── */}
      <Modal
        isOpen={showInvite}
        onClose={() => { setShowInvite(false); setInviteError(null) }}
        title="Invite team member"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Email address
            </label>
            <Input
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Role
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AssignableRole)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="developer">Developer — read-only API access</option>
              <option value="admin">Admin — full org management</option>
            </select>
          </div>
          {inviteError && (
            <p className="text-sm text-red-600">{inviteError}</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviteLoading}>
              {inviteLoading ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Change Role Modal ───────────────────────────────────────────────── */}
      <Modal
        isOpen={!!roleTarget}
        onClose={() => setRoleTarget(null)}
        title="Change member role"
      >
        {roleTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Update the role for <strong>{roleTarget.email}</strong>.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                New role
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AssignableRole)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="developer">Developer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setRoleTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleRoleChange} disabled={roleLoading}>
                {roleLoading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Remove Confirmation Modal ───────────────────────────────────────── */}
      <Modal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove team member"
      >
        {removeTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Remove <strong>{removeTarget.email}</strong> from this organisation? They will
              immediately lose access.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setRemoveTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRemove}
                disabled={removeLoading}
              >
                {removeLoading ? 'Removing…' : 'Remove member'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

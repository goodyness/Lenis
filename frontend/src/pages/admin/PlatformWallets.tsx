import { useEffect, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { apiClient } from '../../lib/api'

interface PlatformWallet {
  id: string
  wallet_address: string
  label: string
  network: string
  is_active: boolean
  usage_count: number
  created_at: string
  updated_at: string
}

interface SubscriptionPayment {
  id: string
  user_id: string
  user_email?: string
  tier: string
  period: string
  usd_amount: number
  crypto_token: string
  crypto_network: string
  crypto_amount: string
  assigned_wallet_address: string
  tx_hash?: string | null
  status: string
  confirmed_at?: string | null
  created_at: string
}

export function PlatformWallets() {
  const [activeTab, setActiveTab] = useState<'wallets' | 'payments'>('wallets')
  const [wallets, setWallets] = useState<PlatformWallet[]>([])
  const [payments, setPayments] = useState<SubscriptionPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Add wallet modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('Primary Treasury Wallet')
  const [network, setNetwork] = useState('all_evm')
  const [isActive, setIsActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const [wRes, pRes] = await Promise.all([
        apiClient.get<{ wallets: PlatformWallet[]; total: number }>('/admin/platform-wallets'),
        apiClient.get<{ payments: SubscriptionPayment[]; total: number }>('/admin/subscriptions/payments'),
      ])
      setWallets(wRes.data.wallets)
      setPayments(pRes.data.payments)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load platform wallets.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateWallet(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!address.trim().startsWith('0x') || address.trim().length !== 42) {
      setFormError('Please enter a valid 42-character EVM address starting with 0x.')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/admin/platform-wallets', {
        wallet_address: address.trim(),
        label: label.trim(),
        network: network.trim(),
        is_active: isActive,
      })
      setSuccess('Platform wallet added successfully.')
      setIsAddModalOpen(false)
      setAddress('')
      setLabel('Primary Treasury Wallet')
      setNetwork('all_evm')
      fetchData()
    } catch (err: any) {
      setFormError(err.response?.data?.detail || 'Failed to add platform wallet.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleStatus(wallet: PlatformWallet) {
    try {
      await apiClient.patch(`/admin/platform-wallets/${wallet.id}`, {
        is_active: !wallet.is_active,
      })
      setWallets((prev) =>
        prev.map((w) => (w.id === wallet.id ? { ...w, is_active: !w.is_active } : w))
      )
      setSuccess(`Wallet ${wallet.wallet_address.slice(0, 8)}... status updated.`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update wallet.')
    }
  }

  async function handleDeleteWallet(walletId: string) {
    if (!confirm('Are you sure you want to remove this treasury wallet from the pool?')) return

    try {
      await apiClient.delete(`/admin/platform-wallets/${walletId}`)
      setWallets((prev) => prev.filter((w) => w.id !== walletId))
      setSuccess('Platform wallet deleted successfully.')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete wallet.')
    }
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <AppShell>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Platform Treasury Wallets</h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Manage platform EVM collection wallets with automated load-balancing across subscription upgrades.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setFormError(null)
                  setIsAddModalOpen(true)
                }}
              >
                <span>+ Add Platform Wallet</span>
              </Button>
            </div>
          </div>

          {/* Alerts */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center justify-between">
              <span>⚠️ {error}</span>
              <button type="button" onClick={() => setError(null)} className="font-bold underline">
                Dismiss
              </button>
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center justify-between">
              <span>✓ {success}</span>
              <button type="button" onClick={() => setSuccess(null)} className="font-bold underline">
                Dismiss
              </button>
            </div>
          )}

          {/* Sub Navigation */}
          <div className="flex border-b border-slate-200 gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('wallets')}
              className={`pb-3 text-xs font-bold transition-colors ${
                activeTab === 'wallets'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Treasury Wallets Pool ({wallets.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`pb-3 text-xs font-bold transition-colors ${
                activeTab === 'payments'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Subscription Payment Logs ({payments.length})
            </button>
          </div>

          {/* Tab: Platform Wallets */}
          {activeTab === 'wallets' && (
            <Card title="Configured Treasury Wallets (Load Balanced)">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      <th className="py-3 px-4">Label</th>
                      <th className="py-3 px-4">EVM Address</th>
                      <th className="py-3 px-4">Network Scope</th>
                      <th className="py-3 px-4 text-center">Load Count</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                          Loading platform wallets...
                        </td>
                      </tr>
                    ) : wallets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                          No platform wallets configured yet. Click "+ Add Platform Wallet" to register an EVM treasury address.
                        </td>
                      </tr>
                    ) : (
                      wallets.map((wallet) => (
                        <tr key={wallet.id} className="hover:bg-slate-50/60 font-sans">
                          <td className="py-3.5 px-4 font-bold text-slate-900">{wallet.label}</td>
                          <td className="py-3.5 px-4 font-mono text-slate-700 text-xs">
                            <span className="bg-slate-100 px-2 py-1 rounded-md border border-slate-200">
                              {wallet.wallet_address}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 capitalize text-slate-600 font-medium">
                            {wallet.network === 'all_evm' ? 'All EVM Chains' : wallet.network}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {wallet.usage_count} assignments
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(wallet)}
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition-colors ${
                                wallet.is_active
                                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                  : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                              }`}
                            >
                              {wallet.is_active ? 'Active' : 'Paused'}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteWallet(wallet.id)}
                              className="text-xs font-semibold text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Tab: Payments History */}
          {activeTab === 'payments' && (
            <Card title="Subscription Crypto Upgrade Audit Trail">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Plan & Period</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Network</th>
                      <th className="py-3 px-4">Assigned Treasury Wallet</th>
                      <th className="py-3 px-4">Tx Hash</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Loading payments...
                        </td>
                      </tr>
                    ) : payments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          No subscription upgrade transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/60">
                          <td className="py-3.5 px-4 font-bold text-slate-900">{p.user_email || p.user_id.slice(0, 8)}</td>
                          <td className="py-3.5 px-4 font-semibold text-slate-800 capitalize">
                            {p.tier} ({p.period})
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-900">
                            {p.crypto_amount} {p.crypto_token} (${p.usd_amount} USD)
                          </td>
                          <td className="py-3.5 px-4 capitalize text-slate-600 font-medium">{p.crypto_network}</td>
                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                            {p.assigned_wallet_address.slice(0, 8)}...{p.assigned_wallet_address.slice(-6)}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px]">
                            {p.tx_hash ? (
                              <span className="text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {p.tx_hash.slice(0, 10)}...
                              </span>
                            ) : (
                              <span className="text-slate-400">Pending</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                                p.status === 'confirmed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-500 font-mono text-[11px]">
                            {new Date(p.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Add Wallet Modal */}
          {isAddModalOpen && (
            <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add Platform Treasury Wallet">
              <form onSubmit={handleCreateWallet} className="space-y-4">
                <Input
                  label="Wallet Address (EVM)"
                  placeholder="0x..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                />

                <Input
                  label="Wallet Label / Identifier"
                  placeholder="Primary Cold Storage / Multi-sig Treasury"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Network Scope</label>
                  <select
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="all_evm">All EVM Chains (Universal)</option>
                    <option value="base">Base</option>
                    <option value="polygon">Polygon</option>
                    <option value="arbitrum">Arbitrum</option>
                    <option value="ethereum">Ethereum</option>
                    <option value="bsc">BNB Smart Chain</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="wallet-active"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <label htmlFor="wallet-active" className="text-xs font-semibold text-slate-700">
                    Enable wallet immediately for load-balanced assignments
                  </label>
                </div>

                {formError && (
                  <p className="rounded-md bg-red-50 p-2.5 text-xs text-red-700">{formError}</p>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setIsAddModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" loading={submitting}>
                    Save Wallet
                  </Button>
                </div>
              </form>
            </Modal>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}

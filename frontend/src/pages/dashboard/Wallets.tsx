import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toaster'
import { ApiError } from '../../services/errors'
import { getWalletChallenge } from '../../services/merchant'
import { Web3WalletConnector } from '../../lib/web3'
import { useMerchantStore } from '../../stores/merchantStore'
import type { MerchantWallet } from '../../stores/merchantStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type WalletStatus = MerchantWallet['status']
type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

const statusVariant: Record<WalletStatus, BadgeVariant> = {
  active: 'green',
  pending: 'yellow',
  inactive: 'default',
}

const statusLabel: Record<WalletStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
}

/** Capitalise first letter, lowercase the rest. */
function titleCase(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/**
 * Truncate an EVM address to `0x1234…abcd` for narrow viewports.
 * Full address is preserved in the `title` attribute.
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateAddress(v: string): string | undefined {
  if (!v) return 'Wallet address is required.'
  if (!/^0x[0-9a-fA-F]{40}$/.test(v))
    return 'Enter a valid EVM address (0x followed by 40 hex characters).'
  return undefined
}

function validateNetwork(v: string): string | undefined {
  if (!v) return 'Please select a network.'
  return undefined
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading wallets">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  )
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

interface DeleteModalProps {
  wallet: MerchantWallet | null
  onConfirm: () => Promise<void>
  onClose: () => void
  loading: boolean
}

function DeleteModal({ wallet, onConfirm, onClose, loading }: DeleteModalProps) {
  return (
    <Modal
      isOpen={wallet !== null}
      onClose={onClose}
      title="Remove wallet"
    >
      <p className="text-sm text-slate-600">
        Are you sure you want to remove your{' '}
        <span className="font-medium text-slate-900">
          {wallet ? titleCase(wallet.network) : ''}
        </span>{' '}
        wallet? This cannot be undone.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          Remove wallet
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Wallets() {
  const toast = useToast()

  const wallets = useMerchantStore((s) => s.wallets)
  const networks = useMerchantStore((s) => s.networks)
  const fetchWallets = useMerchantStore((s) => s.fetchWallets)
  const fetchNetworks = useMerchantStore((s) => s.fetchNetworks)
  const addWalletAction = useMerchantStore((s) => s.addWallet)
  const deleteWalletAction = useMerchantStore((s) => s.deleteWallet)

  const [loading, setLoading] = useState(wallets === null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ─── Add wallet form state ─────────────────────────────────────────────────

  const [formNetwork, setFormNetwork] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [nonce, setNonce] = useState<string | null>(null)
  const [isSigning, setIsSigning] = useState(false)
  const [formErrors, setFormErrors] = useState<{ network?: string; address?: string }>({})
  const [isAdding, setIsAdding] = useState(false)

  // ─── Delete modal state ────────────────────────────────────────────────────

  const [walletToDelete, setWalletToDelete] = useState<MerchantWallet | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null)

  // ─── Data loading ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      await Promise.all([fetchWallets(), fetchNetworks()])
    } catch {
      setLoadError('Failed to load wallets. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [fetchWallets, fetchNetworks])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync with connected MetaMask account on mount and listen to changes
  useEffect(() => {
    Web3WalletConnector.getConnectedAccount().then((acc) => {
      if (acc) {
        setConnectedWallet(acc)
      }
    })

    const unsubAccounts = Web3WalletConnector.onAccountsChanged((accounts) => {
      if (accounts && accounts.length > 0) {
        const newAcc = accounts[0].toLowerCase()
        setConnectedWallet(newAcc)
        setFormAddress((prev) => {
          if (prev && prev.toLowerCase() !== newAcc) {
            setSignature(null)
            setNonce(null)
            return newAcc
          }
          return prev
        })
      } else {
        setConnectedWallet(null)
      }
    })

    return () => {
      unsubAccounts()
    }
  }, [])

  // ─── EIP-191 Signature verification ────────────────────────────────────────

  async function handleConnectAndSign() {
    setFormErrors({})
    setIsSigning(true)
    try {
      const res = await Web3WalletConnector.connect()
      setConnectedWallet(res.address)
      setFormAddress(res.address)
      const challenge = await getWalletChallenge(res.address)
      const sig = await Web3WalletConnector.signMessage(challenge.challenge, res.address)
      setSignature(sig)
      setNonce(challenge.nonce)
      toast.success('Wallet ownership verified via EIP-191 signature.')
    } catch (err: any) {
      toast.error(err.message || 'Wallet signing failed or was rejected.')
    } finally {
      setIsSigning(false)
    }
  }

  // ─── Add wallet ────────────────────────────────────────────────────────────

  async function handleAddWallet(e: React.FormEvent) {
    e.preventDefault()

    const fieldErrors = {
      network: validateNetwork(formNetwork),
      address: validateAddress(formAddress),
    }
    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setFormErrors(fieldErrors)
      return
    }

    setFormErrors({})
    setIsAdding(true)
    try {
      await addWalletAction({
        network: formNetwork,
        address: formAddress.trim(),
        signature: signature || undefined,
        nonce: nonce || undefined,
      })
      toast.success('Wallet added successfully.')
      setFormNetwork('')
      setFormAddress('')
      setSignature(null)
      setNonce(null)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'WALLET_DUPLICATE_NETWORK') {
          toast.error('A wallet for this network already exists.')
        } else {
          toast.error(err.detail)
        }
      } else {
        toast.error('Something went wrong. Please try again.')
      }
    } finally {
      setIsAdding(false)
    }
  }

  // ─── Delete wallet ─────────────────────────────────────────────────────────

  async function handleDeleteConfirm() {
    if (!walletToDelete) return
    setIsDeleting(true)
    try {
      await deleteWalletAction(walletToDelete.id)
      toast.success('Wallet removed.')
      setWalletToDelete(null)
    } catch (err) {
      setWalletToDelete(null)
      if (err instanceof ApiError) {
        if (err.code === 'WALLET_LAST_ACTIVE') {
          toast.error(
            'This wallet cannot be removed — it is linked to active payment links.',
          )
        } else {
          toast.error(err.detail)
        }
      } else {
        toast.error('Something went wrong. Please try again.')
      }
    } finally {
      setIsDeleting(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const walletList = wallets ?? []
  const networkList = networks ?? []
  const isNetworksLoading = networks === null && !loadError

  return (
    <>
      <div className="space-y-6">
        {/* Page heading */}
        <h1 className="text-2xl font-semibold text-slate-900">Wallets</h1>

        {/* Self-Custodial / DEX Wallet Advisory Banner */}
        <div className="rounded-xl border border-amber-200/90 bg-amber-50/80 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-amber-100 p-1 text-amber-600 shrink-0">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="text-xs text-amber-900 leading-relaxed">
              <p className="font-semibold text-sm text-amber-900">
                Self-Custodial / Web3 Wallets Required
              </p>
              <p className="mt-1">
                Please connect or enter a <strong>self-custodial Web3 wallet</strong> (e.g., MetaMask, Trust Wallet, Rabby, Rainbow, Phantom, or Ledger/Trezor).
              </p>
              <p className="mt-1 font-medium text-amber-950">
                ⚠️ <strong>Do NOT use Centralized Exchange (CEX) deposit addresses</strong> (e.g. Binance, Coinbase Exchange, Bybit, KuCoin, OKX). Direct on-chain settlement and automated verification cannot resolve custodial exchange internal routing.
              </p>
            </div>
          </div>
        </div>

        {/* Load error banner */}
        {loadError && (
          <div
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {loadError}{' '}
            <button type="button" className="underline" onClick={load}>
              Retry
            </button>
          </div>
        )}

        {/* Wallet list */}
        {loading ? (
          <ListSkeleton />
        ) : !loadError && walletList.length === 0 ? (
          <Card>
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500">
                You haven't added any wallets yet. Use the form below to add one.
              </p>
            </div>
          </Card>
        ) : !loadError && walletList.length > 0 ? (
          <Card>
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-slate-200"
                aria-label="Merchant wallets"
              >
                <thead>
                  <tr>
                    {['Network', 'Address', 'Status', 'Actions'].map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className="whitespace-nowrap py-3 pr-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400 first:pl-0 last:pr-0"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {walletList.map((wallet) => (
                    <tr key={wallet.id} className="hover:bg-slate-50">
                      {/* Network */}
                      <td className="whitespace-nowrap py-3 pr-4 text-sm font-medium text-slate-900">
                        {titleCase(wallet.network)}
                      </td>

                      {/* Address */}
                      <td className="py-3 pr-4">
                        {/* Truncated on small screens, full on md+ */}
                        <span
                          className="font-mono text-sm text-slate-700 md:hidden"
                          title={wallet.address}
                        >
                          {truncateAddress(wallet.address)}
                        </span>
                        <span
                          className="hidden font-mono text-sm text-slate-700 md:inline"
                          title={wallet.address}
                        >
                          {wallet.address}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap py-3 pr-4">
                        <Badge variant={statusVariant[wallet.status]}>
                          {statusLabel[wallet.status]}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap py-3">
                        <button
                          type="button"
                          disabled={wallet.status === 'inactive'}
                          onClick={() => setWalletToDelete(wallet)}
                          aria-label={`Remove ${titleCase(wallet.network)} wallet`}
                          title="Remove wallet"
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {/* Trash icon */}
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {/* Add wallet form */}
        <Card title="Add a wallet">
          <form onSubmit={handleAddWallet} noValidate className="flex flex-col gap-4">
            {/* Network selector */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="wallet-network"
                className="text-sm font-medium text-slate-700"
              >
                Network
                <span className="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="wallet-network"
                value={formNetwork}
                onChange={(e) => {
                  setFormNetwork(e.target.value)
                  if (formErrors.network)
                    setFormErrors((prev) => ({ ...prev, network: undefined }))
                }}
                disabled={isAdding || isNetworksLoading}
                aria-invalid={!!formErrors.network}
                aria-describedby={
                  formErrors.network ? 'wallet-network-error' : undefined
                }
                className={[
                  'w-full rounded-md border px-3 py-2 text-sm text-slate-900',
                  'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
                  formErrors.network
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                    : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
                  isAdding || isNetworksLoading
                    ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                    : 'bg-white',
                ].join(' ')}
              >
                <option value="">
                  {isNetworksLoading ? 'Loading networks…' : 'Select network'}
                </option>
                {networkList.map((n) => (
                  <option key={n.chain_id} value={n.display_name.toLowerCase()}>
                    {n.display_name}
                  </option>
                ))}
              </select>
              {formErrors.network && (
                <p
                  id="wallet-network-error"
                  className="text-xs text-red-600"
                  role="alert"
                >
                  {formErrors.network}
                </p>
              )}
            </div>

            {/* Address input */}
            <div className="space-y-2">
              <Input
                label="Wallet Address"
                id="wallet-address"
                type="text"
                autoComplete="off"
                placeholder="0x…"
                maxLength={42}
                value={formAddress}
                onChange={(e) => {
                  setFormAddress(e.target.value)
                  if (formErrors.address)
                    setFormErrors((prev) => ({ ...prev, address: undefined }))
                }}
                error={formErrors.address}
                required
                disabled={isAdding}
                helperText="Your public EVM wallet address (42 characters starting with 0x)."
              />

              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={signature ? "secondary" : "primary"}
                    size="sm"
                    onClick={handleConnectAndSign}
                    loading={isSigning}
                  >
                    {signature ? '⚡ Re-verify with MetaMask' : '⚡ Connect & Verify with MetaMask'}
                  </Button>
                </div>
                {signature ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Signature Verified
                  </span>
                ) : connectedWallet ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    Connected: <span className="font-mono font-medium">{truncateAddress(connectedWallet)}</span>
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isAdding}
                disabled={isNetworksLoading || !!loadError}
              >
                Add wallet
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Delete confirmation modal */}
      <DeleteModal
        wallet={walletToDelete}
        onConfirm={handleDeleteConfirm}
        onClose={() => setWalletToDelete(null)}
        loading={isDeleting}
      />
    </>
  )
}

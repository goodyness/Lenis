import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toaster'
import { ApiError } from '../../services/errors'
import { getWalletChallenge } from '../../services/merchant'
import { Web3WalletConnector } from '../../lib/web3'
import { useMerchantStore } from '../../stores/merchantStore'

interface QuickAddWalletModalProps {
  isOpen: boolean
  onClose: () => void
  defaultNetwork?: string
  onSuccess?: (network: string) => void
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function QuickAddWalletModal({
  isOpen,
  onClose,
  defaultNetwork,
  onSuccess,
}: QuickAddWalletModalProps) {
  const toast = useToast()
  const networks = useMerchantStore((s) => s.networks)
  const fetchNetworks = useMerchantStore((s) => s.fetchNetworks)
  const fetchWallets = useMerchantStore((s) => s.fetchWallets)
  const addWalletAction = useMerchantStore((s) => s.addWallet)

  const [formNetwork, setFormNetwork] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [nonce, setNonce] = useState<string | null>(null)
  const [isSigning, setIsSigning] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [formErrors, setFormErrors] = useState<{ network?: string; address?: string }>({})
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      if (!networks) {
        fetchNetworks()
      }
      if (defaultNetwork) {
        setFormNetwork(defaultNetwork.toLowerCase())
      }
      setFormAddress('')
      setSignature(null)
      setNonce(null)
      setFormErrors({})

      Web3WalletConnector.getConnectedAccount().then((acc) => {
        if (acc) setConnectedWallet(acc)
      })
    }
  }, [isOpen, defaultNetwork, networks, fetchNetworks])

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const errors: { network?: string; address?: string } = {}
    if (!formNetwork) {
      errors.network = 'Please select a network.'
    }
    if (!formAddress.trim()) {
      errors.address = 'Wallet address is required.'
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(formAddress.trim())) {
      errors.address = 'Enter a valid EVM address (0x followed by 40 hex characters).'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
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
      await fetchWallets()
      toast.success('Wallet added successfully!')
      onSuccess?.(formNetwork)
      onClose()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'WALLET_DUPLICATE_NETWORK') {
          toast.error('A wallet for this network already exists.')
        } else {
          toast.error(err.detail)
        }
      } else {
        toast.error('Failed to add wallet. Please try again.')
      }
    } finally {
      setIsAdding(false)
    }
  }

  const networkList = networks ?? []

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Payout Wallet">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 leading-relaxed">
          <p className="font-semibold">Self-Custodial / Web3 Wallets Only</p>
          <p className="mt-0.5">
            Use MetaMask, Trust Wallet, Rabby, or a hardware wallet. <strong>Do NOT enter CEX deposit addresses</strong> (Binance, Coinbase, Bybit, etc.).
          </p>
        </div>

        {/* Network */}
        <div className="flex flex-col gap-1">
          <label htmlFor="quick-wallet-network" className="text-sm font-medium text-slate-700">
            Network <span className="text-red-500">*</span>
          </label>
          <select
            id="quick-wallet-network"
            value={formNetwork}
            onChange={(e) => {
              setFormNetwork(e.target.value)
              if (formErrors.network) setFormErrors((prev) => ({ ...prev, network: undefined }))
            }}
            disabled={isAdding}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">Select network</option>
            {networkList.map((n) => (
              <option key={n.chain_id} value={n.display_name.toLowerCase()}>
                {n.display_name}
              </option>
            ))}
          </select>
          {formErrors.network && (
            <p className="text-xs text-red-600">{formErrors.network}</p>
          )}
        </div>

        {/* Address */}
        <div className="space-y-2">
          <Input
            label="Wallet Address"
            id="quick-wallet-address"
            type="text"
            autoComplete="off"
            placeholder="0x…"
            maxLength={42}
            value={formAddress}
            onChange={(e) => {
              setFormAddress(e.target.value)
              if (formErrors.address) setFormErrors((prev) => ({ ...prev, address: undefined }))
            }}
            error={formErrors.address}
            required
            disabled={isAdding}
            helperText="42-character EVM address starting with 0x"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant={signature ? 'secondary' : 'primary'}
              size="sm"
              onClick={handleConnectAndSign}
              loading={isSigning}
            >
              {signature ? '⚡ Re-verify with Web3' : '⚡ Connect & Verify with Web3'}
            </Button>

            {signature ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Verified
              </span>
            ) : connectedWallet ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                Connected: <span className="font-mono font-medium">{truncateAddress(connectedWallet)}</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isAdding}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isAdding}>
            Save Wallet
          </Button>
        </div>
      </form>
    </Modal>
  )
}

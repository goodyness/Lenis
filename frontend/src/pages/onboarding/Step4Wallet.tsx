import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { submitOnboardingStep, getWalletChallenge } from '../../services/merchant'
import { getNetworks } from '../../services/networks'
import { ApiError } from '../../services/errors'
import { Web3WalletConnector } from '../../lib/web3'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import type { Network } from '../../stores/merchantStore'

// ─── Validation ───────────────────────────────────────────────────────────────

function validateNetwork(v: string): string | undefined {
  if (!v) return 'Please select a network.'
  return undefined
}

function validateAddress(v: string): string | undefined {
  if (!v) return 'Wallet address is required.'
  if (!/^0x[0-9a-fA-F]{40}$/.test(v))
    return 'Enter a valid EVM address (0x followed by 40 hex characters).'
  return undefined
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormValues {
  network: string
  address: string
  signature?: string
  nonce?: string
}

interface FormErrors {
  network?: string
  address?: string
  form?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Step4Wallet() {
  const navigate = useNavigate()
  const saveFormData = useOnboardingStore((state) => state.saveFormData)
  const setStep = useOnboardingStore((state) => state.setStep)
  const persistedData = useOnboardingStore((state) => state.formData[4]) as
    | Partial<FormValues>
    | undefined

  // Initialise from persisted store data if available
  const [values, setValues] = useState<FormValues>({
    network: persistedData?.network ?? '',
    address: persistedData?.address ?? '',
    signature: persistedData?.signature,
    nonce: persistedData?.nonce,
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSigning, setIsSigning] = useState(false)
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null)

  // Networks loading state
  const [networks, setNetworks] = useState<Network[]>([])
  const [isLoadingNetworks, setIsLoadingNetworks] = useState(true)
  const [networksError, setNetworksError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoadingNetworks(true)
    getNetworks()
      .then((data) => {
        if (!cancelled) {
          setNetworks(data)
          setIsLoadingNetworks(false)
          // Default to first network (e.g. Base or Polygon) if not already chosen
          if (!values.network && data.length > 0) {
            setValues((prev) => ({ ...prev, network: data[0].display_name.toLowerCase() }))
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNetworksError(
            'Failed to load networks. Please refresh and try again.',
          )
          setIsLoadingNetworks(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Sync with connected MetaMask account on mount and listen to changes
  useEffect(() => {
    Web3WalletConnector.getConnectedAccount().then((acc) => {
      if (acc) {
        setConnectedWallet(acc)
        setValues((prev) => (prev.address ? prev : { ...prev, address: acc }))
      }
    })

    const unsubAccounts = Web3WalletConnector.onAccountsChanged((accounts) => {
      if (accounts && accounts.length > 0) {
        const newAcc = accounts[0].toLowerCase()
        setConnectedWallet(newAcc)
        setValues((prev) => {
          // If address changed, reset signature state
          if (prev.address.toLowerCase() !== newAcc) {
            return { ...prev, address: newAcc, signature: undefined, nonce: undefined }
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

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleNetworkChange(v: string) {
    setValues((prev) => ({ ...prev, network: v }))
    if (errors.network) setErrors((prev) => ({ ...prev, network: undefined }))
  }

  function handleAddressChange(v: string) {
    setValues((prev) => ({
      ...prev,
      address: v,
      // If address is manually changed, reset signature
      signature: undefined,
      nonce: undefined,
    }))
    if (errors.address) setErrors((prev) => ({ ...prev, address: undefined }))
  }

  const handleConnectAndSign = useCallback(async () => {
    setErrors({})
    setIsSigning(true)
    try {
      const conn = await Web3WalletConnector.connect()
      const currentAddress = conn.address
      setConnectedWallet(currentAddress)
      setValues((prev) => ({ ...prev, address: currentAddress }))

      // Generate EIP-191 challenge from backend
      const challenge = await getWalletChallenge(currentAddress)

      // Prompt personal_sign in wallet
      const sig = await Web3WalletConnector.signMessage(challenge.challenge, currentAddress)

      setValues((prev) => ({
        ...prev,
        address: currentAddress,
        signature: sig,
        nonce: challenge.nonce,
      }))
    } catch (err: any) {
      setErrors({ form: err.message || 'Wallet signing failed or was rejected.' })
    } finally {
      setIsSigning(false)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Run all validations
    const fieldErrors: FormErrors = {
      network: validateNetwork(values.network),
      address: validateAddress(values.address),
    }

    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)

    try {
      await submitOnboardingStep(4, {
        network: values.network,
        address: values.address.trim(),
        signature: values.signature,
        nonce: values.nonce,
      })

      // Persist to store and redirect to dashboard
      saveFormData(4, {
        network: values.network,
        address: values.address.trim(),
        signature: values.signature,
        nonce: values.nonce,
      })
      setStep(5)
      navigate('/dashboard')
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ form: err.detail })
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const isVerified = Boolean(values.signature && values.nonce)

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Wallet Setup</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure your primary settlement wallet to receive customer payments.
        </p>
      </div>

      {/* Primary EVM Wallet Announcement Box */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-4 text-sm text-slate-700 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 items-center rounded-full bg-indigo-600 px-2 text-xs font-semibold text-white">
            Primary Receiving EVM Wallet
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          This address serves as your <strong>Primary Receiving EVM Wallet</strong> across all EVM-compatible chains (Base, Ethereum, Polygon, Arbitrum, Optimism, BSC). You can manage, verify, and configure multiple chain-specific receiving addresses anytime in <strong>Dashboard → Wallets</strong>.
        </p>
      </div>

      {/* CEX vs DEX Advisory */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-amber-900">
          <svg className="h-4 w-4 text-amber-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          Self-Custodial (DEX) Wallets Only
        </div>
        <p>
          Please provide a <strong>self-custody Web3 wallet</strong> (MetaMask, Trust Wallet, Rainbow, Phantom, Ledger).
        </p>
        <p className="font-medium text-amber-950">
          ⚠️ <strong>Do NOT use Centralized Exchange (CEX) deposit addresses</strong> (Binance, Coinbase, Bybit, etc.). Automated on-chain payment detection will not work with exchange custodial accounts.
        </p>
      </div>

      {/* Non-custodial security note */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 text-xs text-slate-600 space-y-1">
        <div className="flex items-center gap-1.5 font-medium text-slate-800">
          <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Non-Custodial Settlement Guarantee
        </div>
        <p>
          Funds are transferred directly into your own private wallet. Lenis never holds custody of merchant funds or asks for private keys.
        </p>
      </div>

      {/* Network selector */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="step4-network"
          className="text-sm font-medium text-slate-700"
        >
          Default Settlement Network
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>

        {networksError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {networksError}
          </p>
        ) : (
          <select
            id="step4-network"
            value={values.network}
            onChange={(e) => handleNetworkChange(e.target.value)}
            disabled={isSubmitting || isLoadingNetworks}
            aria-invalid={!!errors.network}
            aria-describedby={errors.network ? 'step4-network-error' : undefined}
            className={[
              'w-full rounded-md border px-3 py-2 text-sm text-slate-900',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
              errors.network
                ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
              isSubmitting || isLoadingNetworks
                ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                : 'bg-white',
            ].join(' ')}
          >
            <option value="">
              {isLoadingNetworks ? 'Loading networks…' : 'Select network'}
            </option>
            {networks.map((n) => (
              <option key={n.chain_id} value={n.display_name.toLowerCase()}>
                {n.display_name}
              </option>
            ))}
          </select>
        )}

        {errors.network && (
          <p
            id="step4-network-error"
            className="text-xs text-red-600"
            role="alert"
          >
            {errors.network}
          </p>
        )}
      </div>

      {/* Wallet address input + Web3 connect */}
      <div className="space-y-2.5">
        <Input
          label="Primary Wallet Address"
          id="step4-address"
          type="text"
          autoComplete="off"
          placeholder="0x..."
          maxLength={42}
          value={values.address}
          onChange={(e) => handleAddressChange(e.target.value)}
          error={errors.address}
          required
          disabled={isSubmitting}
          helperText="Your public EVM wallet address (42 characters starting with 0x)."
        />

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isVerified ? "secondary" : "primary"}
              size="sm"
              onClick={handleConnectAndSign}
              loading={isSigning}
            >
              {isVerified ? '⚡ Re-verify with MetaMask' : '⚡ Connect & Verify with MetaMask'}
            </Button>
          </div>

          {isVerified ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Cryptographically Verified (EIP-191)
            </div>
          ) : connectedWallet ? (
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Connected: <span className="font-mono font-medium">{truncateAddress(connectedWallet)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Form-level server error */}
      {errors.form && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          <div className="font-medium">Verification Notice</div>
          <div className="mt-0.5 text-xs">{errors.form}</div>
        </div>
      )}

      <Button
        type="submit"
        className="mt-2 w-full"
        size="lg"
        loading={isSubmitting}
        disabled={isLoadingNetworks || !!networksError}
      >
        Finish Setup
      </Button>
    </form>
  )
}


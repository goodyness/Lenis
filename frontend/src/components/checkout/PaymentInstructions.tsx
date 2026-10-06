import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Web3WalletConnector } from '../../lib/web3'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletInfo {
  network: string
  address: string
}

interface PaymentInstructionsProps {
  /** The selected network identifier, e.g. "ethereum", "base", "bsc" */
  network: string | null
  /** The selected token symbol, e.g. "USDC", "ETH" */
  tokenSymbol: string | null
  /** ERC-20 contract address if applicable */
  contractAddress?: string | null
  /** The payment amount in crypto units (decimal string, e.g. "0.2000"). */
  amount: string | null
  /** Optional base USD amount for reference, e.g. "600.00" */
  usdAmount?: string | null
  /** Optional live rate string, e.g. "1 ETH ≈ $3,000.00 USD" */
  rateText?: string | null
  amountMode?: 'fixed' | 'flexible'
  /** All merchant wallets — component looks up the address for the selected network. */
  wallets: WalletInfo[]
  /** Callback when direct Web3 transaction is broadcast */
  onPaymentBroadcast?: (txHash: string, fromAddress: string) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNetworkDisplay(network: string): string {
  const knownNames: Record<string, string> = {
    ethereum: 'Ethereum',
    base: 'Base',
    polygon: 'Polygon',
    arbitrum: 'Arbitrum One',
    optimism: 'Optimism',
    bsc: 'BNB Smart Chain',
  }
  return (
    knownNames[network.toLowerCase()] ??
    network.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API fallback
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all select-none',
        'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
        copied
          ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold'
          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
      ].join(' ')}
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 16 16" fill="none">
            <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Copied!</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 16 16" fill="none">
            <rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 11V3a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Copy {label}</span>
        </>
      )}
    </button>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentInstructions({
  network,
  tokenSymbol,
  contractAddress,
  amount,
  usdAmount,
  rateText,
  wallets,
  onPaymentBroadcast,
}: PaymentInstructionsProps) {
  const [activeTab, setActiveTab] = useState<'wallet' | 'manual'>('wallet')
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isPaying, setIsPaying] = useState(false)
  const [web3Error, setWeb3Error] = useState<string | null>(null)
  const [hasInjectedWallet, setHasInjectedWallet] = useState(false)

  useEffect(() => {
    setHasInjectedWallet(Web3WalletConnector.isAvailable())
  }, [])

  if (!network || !tokenSymbol) {
    return null
  }

  // Find exact network match or fallback to EVM address
  let wallet = wallets.find(
    (w) => w.network.toLowerCase() === network.toLowerCase(),
  )
  if (!wallet && wallets.length > 0) {
    const isCurrentEvm =
      !network.toLowerCase().includes('solana') &&
      !network.toLowerCase().includes('bitcoin')
    if (isCurrentEvm) {
      wallet = wallets.find((w) => /^0x[0-9a-fA-F]{40}$/.test(w.address))
    }
  }

  if (!wallet) {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-800">No payout wallet available for this network</p>
        <p className="mt-1 text-xs text-amber-600">
          The merchant has not configured a receiving address for <span className="font-semibold">{formatNetworkDisplay(network)}</span>.
          Please select another payment network.
        </p>
      </div>
    )
  }

  const displayAmount = amount || '0'
  const isPayDisabled = !amount || parseFloat(amount) <= 0

  async function handleConnectWallet() {
    setWeb3Error(null)
    setIsConnecting(true)
    try {
      const res = await Web3WalletConnector.connect()
      setConnectedAccount(res.address)
    } catch (err: any) {
      setWeb3Error(err.message || 'Failed to connect Web3 wallet.')
    } finally {
      setIsConnecting(false)
    }
  }

  async function handleDirectPay() {
    if (!connectedAccount) {
      await handleConnectWallet()
      return
    }
    if (!amount || isPayDisabled) {
      setWeb3Error('Please enter or confirm a valid payment amount.')
      return
    }

    setWeb3Error(null)
    setIsPaying(true)
    try {
      const txHash = await Web3WalletConnector.sendPayment({
        network: network!,
        toAddress: wallet!.address,
        tokenSymbol: tokenSymbol!,
        contractAddress,
        amount,
        fromAddress: connectedAccount,
      })

      if (onPaymentBroadcast) {
        onPaymentBroadcast(txHash, connectedAccount)
      }
    } catch (err: any) {
      console.error('Payment error:', err)
      setWeb3Error(err.message || 'Transaction was rejected or failed.')
    } finally {
      setIsPaying(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Rate & Exact Amount Notice */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-800">
              Amount to Pay
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {displayAmount} {tokenSymbol}
              </span>
              {usdAmount && (
                <span className="text-xs font-medium text-slate-500">
                  (≈ ${parseFloat(usdAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)
                </span>
              )}
            </div>
            {rateText && (
              <p className="text-xs text-blue-700 font-medium">
                ⚡ {rateText} • Locked for this checkout session
              </p>
            )}
          </div>
          <CopyButton text={displayAmount} label="amount" />
        </div>
      </div>

      {/* Tab Switcher: Pay with Wallet vs Manual QR */}
      <div className="flex rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('wallet')}
          className={[
            'flex-1 rounded-md py-2 text-xs font-medium transition-all select-none',
            activeTab === 'wallet'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900',
          ].join(' ')}
        >
          ⚡ Pay with Connected Wallet
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('manual')}
          className={[
            'flex-1 rounded-md py-2 text-xs font-medium transition-all select-none',
            activeTab === 'manual'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900',
          ].join(' ')}
        >
          📱 QR Code & Address
        </button>
      </div>

      {web3Error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
          {web3Error}
        </div>
      )}

      {activeTab === 'wallet' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Target Network</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {formatNetworkDisplay(network)}
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200/80 pt-3 text-xs">
            <span className="font-medium text-slate-500">Exact Asset to Send</span>
            <span className="font-semibold text-slate-900">
              {displayAmount} {tokenSymbol}
            </span>
          </div>

          {!connectedAccount ? (
            <button
              type="button"
              disabled={isConnecting}
              onClick={handleConnectWallet}
              className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 select-none shadow-sm"
            >
              {isConnecting ? 'Connecting Web3 Wallet…' : 'Connect Browser Wallet (MetaMask / Web3)'}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Connected Payer Wallet</span>
                  <span className="font-mono font-medium text-slate-800">
                    {connectedAccount.slice(0, 6)}…{connectedAccount.slice(-4)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={isPaying || isPayDisabled}
                onClick={handleDirectPay}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-50 select-none"
              >
                {isPaying
                  ? 'Confirming Transaction in Wallet…'
                  : `Pay ${displayAmount} ${tokenSymbol} Now`}
              </button>
            </div>
          )}

          {!hasInjectedWallet && !connectedAccount && (
            <p className="text-center text-xs text-slate-400">
              No Web3 extension detected. You can switch to the QR Code tab to pay with your mobile wallet app.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Merchant Receiving Address
              </p>
              <CopyButton text={wallet.address} label="address" />
            </div>
            <p className="break-all font-mono text-sm font-medium text-slate-900 select-all" aria-label="Merchant wallet address">
              {wallet.address}
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-100 bg-white p-6 shadow-xs">
            <div
              className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm"
              aria-label={`QR code for wallet address ${wallet.address}`}
            >
              <QRCodeSVG
                value={wallet.address}
                size={190}
                level="M"
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
            <p className="text-center text-xs text-slate-500">
              Scan with your mobile wallet app (MetaMask, Trust Wallet, Phantom) to send <strong>{displayAmount} {tokenSymbol}</strong> on <strong>{formatNetworkDisplay(network)}</strong>.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}


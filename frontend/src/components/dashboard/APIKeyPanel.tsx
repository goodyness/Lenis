import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { useEnvironmentStore } from '../../stores/environmentStore'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toaster'
import { SecurityGate } from './SecurityGate'
import type { SecurityChallengeStatus } from './SecurityGate'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiKeyData {
  publishable_key: string
  secret_key_masked: string
  has_live_keys: boolean
  live_publishable_key?: string | null
  live_secret_key_masked?: string | null
}

interface UserProfile {
  id: string
  email: string
  full_name: string
  account_type: string
  status: string
  email_verified: boolean
  created_at: string
}

export interface APIKeyHistoryItem {
  id: string
  key_type: string
  prefix: string
  suffix_display: string
  active: boolean
  created_at: string
  revoked_at: string | null
}

type LoadState = 'loading' | 'ready' | 'error'
type CodeTab = 'curl' | 'js' | 'python'
type RegenTarget = 'pk' | 'sk' | 'pair'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      className="text-xs"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </Button>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading API keys">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-white border border-slate-100 shadow-xs" />
      <div className="h-40 animate-pulse rounded-2xl bg-white border border-slate-100 shadow-xs" />
      <div className="h-64 animate-pulse rounded-2xl bg-white border border-slate-100 shadow-xs" />
    </div>
  )
}

// ─── Revealed Key Modal ───────────────────────────────────────────────────────

interface RevealedKeyModalProps {
  isOpen: boolean
  onClose: () => void
  secretKey: string
  publishableKey?: string | null
  title: string
}

function RevealedKeyModal({
  isOpen,
  onClose,
  secretKey,
  publishableKey,
  title,
}: RevealedKeyModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
          ⚠️ <strong>Save these credentials now:</strong> For security reasons, the full secret key is never stored in plaintext and cannot be displayed again after you close this dialog.
        </div>

        {publishableKey && (
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">New Publishable Key</span>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <p className="min-w-0 flex-1 font-mono text-xs text-slate-900 truncate">
                {publishableKey}
              </p>
              <CopyButton value={publishableKey} />
            </div>
          </div>
        )}

        {secretKey && (
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">New Secret Key</span>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-white">
              <p className="break-all font-mono text-xs text-emerald-400" aria-label="New secret key">
                {secretKey}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {secretKey && <CopyButton value={secretKey} />}
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function APIKeyPanel() {
  const toast = useToast()
  const { mode, setMode } = useEnvironmentStore()

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [keyData, setKeyData] = useState<ApiKeyData | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [codeTab, setCodeTab] = useState<CodeTab>('curl')

  // History State
  const [keyHistory, setKeyHistory] = useState<APIKeyHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Security Challenge State for Action Verification
  const [secStatus, setSecStatus] = useState<SecurityChallengeStatus | null>(null)
  const [secMethod, setSecMethod] = useState<'2fa' | 'email' | 'phone'>('email')
  const [secCode, setSecCode] = useState('')
  const [sendingOtp, setSendingOtp] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)

  // Unified Key Rotation Modal State
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false)
  const [regenTarget, setRegenTarget] = useState<RegenTarget>('sk')
  const [regenLoading, setRegenLoading] = useState(false)
  const [revealedRegenKeys, setRevealedRegenKeys] = useState<{
    secretKey?: string
    publishableKey?: string
  } | null>(null)

  // Live Keys Initial Generation Modal State
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [revealedLiveKey, setRevealedLiveKey] = useState<string | null>(null)

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const { data } = await apiClient.get<{ keys: APIKeyHistoryItem[] }>('/users/me/api-keys/history')
      setKeyHistory(data.keys || [])
    } catch {
      // Non-fatal error loading history
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const fetchData = useCallback(async () => {
    setLoadState('loading')
    try {
      const [keysRes, profileRes, secRes] = await Promise.all([
        apiClient.get<ApiKeyData>('/users/me/api-keys'),
        apiClient.get<UserProfile>('/users/me'),
        apiClient.get<SecurityChallengeStatus>('/users/me/security-challenge/status').catch(() => null),
      ])
      setKeyData(keysRes.data)
      setProfile(profileRes.data)
      if (secRes?.data) {
        setSecStatus(secRes.data)
        setSecMethod(secRes.data.default_method)
      }
      setLoadState('ready')
      fetchHistory()
    } catch {
      setLoadState('error')
    }
  }, [fetchHistory])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // OTP cooldown timer
  useEffect(() => {
    if (otpCooldown <= 0) return
    const timer = setInterval(() => {
      setOtpCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [otpCooldown])

  async function handleSendActionOTP(channel: 'email' | 'phone') {
    setSendingOtp(true)
    try {
      const { data } = await apiClient.post<{ message: string }>('/users/me/security-challenge/request-otp', {
        channel,
      })
      setOtpCooldown(60)
      toast.success(data.message || ('Security code sent to your ' + channel + '.'))
    } catch (err: any) {
      const msg = err.response?.data?.detail?.detail || 'Failed to send security code.'
      toast.error(msg)
    } finally {
      setSendingOtp(false)
    }
  }

  function openRegenModal(target: RegenTarget) {
    setRegenTarget(target)
    setSecCode('')
    setConfirmRegenOpen(true)
  }

  async function handleExecuteRegenerate() {
    if (!secCode.trim()) {
      toast.error('Please enter your 6-digit security authorization code.')
      return
    }

    setRegenLoading(true)
    try {
      const endpoint =
        regenTarget === 'pk'
          ? '/users/me/api-keys/regenerate-pk'
          : regenTarget === 'pair'
          ? '/users/me/api-keys/regenerate-pair'
          : '/users/me/api-keys/regenerate-sk'

      const { data } = await apiClient.post<{
        publishable_key?: string | null
        secret_key?: string | null
        message: string
      }>(endpoint, {
        mode,
        key_category: regenTarget,
        security_code: secCode.trim(),
        security_method: secMethod,
      })

      setConfirmRegenOpen(false)
      setSecCode('')

      if (data.secret_key) {
        setRevealedRegenKeys({
          secretKey: data.secret_key,
          publishableKey: data.publishable_key ?? undefined,
        })
      }

      // Refresh active keys and history log
      const { data: freshKeys } = await apiClient.get<ApiKeyData>('/users/me/api-keys')
      setKeyData(freshKeys)
      fetchHistory()
      toast.success(data.message || 'Key rotated successfully.')
    } catch (err: any) {
      const msg = err.response?.data?.detail?.detail || 'Failed to rotate key. Check your verification code.'
      toast.error(msg)
    } finally {
      setRegenLoading(false)
    }
  }

  async function handleGenerateLiveKeys() {
    if (!secCode.trim()) {
      toast.error('Please enter your 6-digit security authorization code.')
      return
    }

    setLiveLoading(true)
    try {
      const { data } = await apiClient.post<{
        secret_key: string
        publishable_key?: string
      }>('/users/me/api-keys/live', {
        security_code: secCode.trim(),
        security_method: secMethod,
      })
      setConfirmLiveOpen(false)
      setSecCode('')
      if (data.secret_key) {
        setRevealedRegenKeys({
          secretKey: data.secret_key,
          publishableKey: data.publishable_key ?? undefined,
        })
      }
      const { data: fresh } = await apiClient.get<ApiKeyData>('/users/me/api-keys')
      setKeyData(fresh)
      fetchHistory()
      toast.success('Live production keys generated successfully.')
    } catch (err: any) {
      const msg = err.response?.data?.detail?.detail || 'Failed to generate live keys. Check your verification code.'
      toast.error(msg)
    } finally {
      setLiveLoading(false)
    }
  }

  if (loadState === 'loading') {
    return <Skeleton />
  }

  if (loadState === 'error' || !keyData || !profile) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center space-y-4">
        <div className="text-2xl">⚠️</div>
        <h2 className="text-base font-bold text-red-900">Failed to Load API Keys</h2>
        <p className="text-xs text-red-700 max-w-sm mx-auto">
          We encountered an issue fetching your developer credentials. Please retry.
        </p>
        <Button variant="secondary" size="sm" onClick={fetchData}>
          Retry
        </Button>
      </div>
    )
  }

  const isLive = mode === 'live'
  const hasLiveKeys = Boolean(keyData.has_live_keys && keyData.live_publishable_key)
  const activePublishableKey = isLive
    ? (keyData.live_publishable_key || '')
    : keyData.publishable_key
  const activeSecretKey = isLive
    ? (keyData.live_secret_key_masked || '')
    : keyData.secret_key_masked

  const canGenerateLiveKeys =
    profile.status === 'verified' || profile.account_type === 'merchant' || profile.account_type === 'developer'

  const authHeaderKey = activeSecretKey || (isLive ? 'sk_live_YOUR_SECRET_KEY' : 'sk_test_YOUR_SECRET_KEY')

  const curlCode = `curl -X POST https://api.lenis.io/merchant/payment-links \\
  -H "Authorization: Bearer ${authHeaderKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "E-Commerce Checkout",
    "amount_mode": "fixed",
    "amount": "120.00",
    "accepted_tokens": [
      {"network": "base", "token_symbol": "USDC", "contract_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
      {"network": "polygon", "token_symbol": "USDT", "contract_address": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"}
    ]
  }'`

  const jsCode = `import axios from 'axios';

const response = await axios.post('https://api.lenis.io/merchant/payment-links', {
  title: 'E-Commerce Checkout',
  amount_mode: 'fixed',
  amount: '120.00',
  accepted_tokens: [
    { network: 'base', token_symbol: 'USDC', contract_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    { network: 'polygon', token_symbol: 'USDT', contract_address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }
  ]
}, {
  headers: {
    'Authorization': 'Bearer ${authHeaderKey}',
    'Content-Type': 'application/json'
  }
});

console.log('Payment URL:', response.data.payment_url);`

  const pythonCode = `import requests

url = "https://api.lenis.io/merchant/payment-links"
headers = {
    "Authorization": "Bearer ${authHeaderKey}",
    "Content-Type": "application/json"
}
payload = {
    "title": "E-Commerce Checkout",
    "amount_mode": "fixed",
    "amount": "120.00",
    "accepted_tokens": [
        {"network": "base", "token_symbol": "USDC", "contract_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
        {"network": "polygon", "token_symbol": "USDT", "contract_address": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"}
    ]
}

res = requests.post(url, json=payload, headers=headers)
print("Payment URL:", res.json()["payment_url"])`

  return (
    <SecurityGate>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">API Keys & Developer Integration</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Integrate Lenis decentralized payments into your website, backend services, or mobile apps.
            </p>
          </div>
          
          {/* Controls: Mode Switch & Roll Full Pair */}
          <div className="flex items-center gap-2">
            <Button
              variant={isLive && !hasLiveKeys ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                if (isLive && !hasLiveKeys) {
                  setSecCode('')
                  setConfirmLiveOpen(true)
                } else {
                  openRegenModal('pair')
                }
              }}
              className="text-xs"
              title={isLive && !hasLiveKeys ? 'Generate initial live API credentials' : 'Rotate both Public and Secret keys simultaneously'}
            >
              {isLive && !hasLiveKeys ? '⚡ Generate Live Keys' : `🔄 Rotate Key Pair (${isLive ? 'Live' : 'Test'})`}
            </Button>

            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setMode('sandbox')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  mode === 'sandbox'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🧪 Sandbox (Test)
              </button>
              <button
                type="button"
                onClick={() => setMode('live')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  mode === 'live'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ⚡ Live (Production)
              </button>
            </div>
          </div>
        </div>

        {/* Mode Info Banner */}
        {isLive ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-emerald-700 font-bold text-sm">⚡ Live Production Environment</span>
                <Badge variant="green">Real Settlements</Badge>
              </div>
              <p className="text-xs text-emerald-800 hidden sm:block">
                Requests authenticated with Live keys execute real blockchain transactions.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-amber-800 font-bold text-sm">🧪 Sandbox Test Environment</span>
                <Badge variant="yellow">Simulated</Badge>
              </div>
              <p className="text-xs text-amber-800 hidden sm:block">
                Test keys allow simulating checkouts, webhook deliveries, and order workflows risk-free.
              </p>
            </div>
          </div>
        )}

        {/* ─── Live Keys Requirement Alert if in Live Mode without Keys ─── */}
        {isLive && !hasLiveKeys && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base">🚀</span>
                  <h2 className="text-sm font-bold text-indigo-950">Generate Production Live Keys</h2>
                </div>
                <p className="text-xs text-indigo-800 mt-1 max-w-xl">
                  Ready to accept mainnet crypto settlements? Generate your live publishable (<code className="font-mono text-indigo-900">pk_live_</code>) and secret (<code className="font-mono text-indigo-900">sk_live_</code>) keys.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={!canGenerateLiveKeys}
                onClick={() => {
                  setSecCode('')
                  setConfirmLiveOpen(true)
                }}
                className="whitespace-nowrap shadow-xs"
              >
                {canGenerateLiveKeys ? 'Generate Live Keys' : 'Verification Required'}
              </Button>
            </div>
          </div>
        )}

        {/* ─── Publishable Key Card ─── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isLive ? 'Live Publishable Key (Client-Side)' : 'Test Publishable Key (Client-Side)'}
              </h2>
              <p className="text-xs text-slate-500">Use in frontend checkouts or widget scripts. Safe for public visibility.</p>
            </div>
            <Badge variant={isLive ? 'green' : 'blue'}>
              {isLive ? 'pk_live' : 'pk_test'}
            </Badge>
          </div>

          {isLive && !hasLiveKeys ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
              <span className="text-xs text-slate-500 font-medium italic">
                No production live publishable key generated yet.
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={!canGenerateLiveKeys}
                onClick={() => {
                  setSecCode('')
                  setConfirmLiveOpen(true)
                }}
                className="text-xs shrink-0"
              >
                ⚡ Generate Live Keys
              </Button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                type="text"
                readOnly
                value={activePublishableKey}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-900 focus:outline-none"
              />
              <CopyButton value={activePublishableKey} />
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-slate-100">
            <p className="text-[11px] text-slate-400">
              Embed into website checkout SDKs or mobile payment components.
            </p>
            {(!isLive || hasLiveKeys) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openRegenModal('pk')}
                className="text-xs"
              >
                🔄 Regenerate {isLive ? 'Live' : 'Test'} Public Key
              </Button>
            )}
          </div>
        </div>

        {/* ─── Secret Key Card ─── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isLive ? 'Live Secret Key (Server-Side)' : 'Test Secret Key (Server-Side)'}
              </h2>
              <p className="text-xs text-slate-500">Authenticate server-to-server requests. Never expose this key in client-side code.</p>
            </div>
            <Badge variant={isLive ? 'green' : 'blue'}>
              {isLive ? 'sk_live' : 'sk_test'}
            </Badge>
          </div>

          {isLive && !hasLiveKeys ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
              <span className="text-xs text-slate-500 font-medium italic">
                No production live secret key generated yet.
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={!canGenerateLiveKeys}
                onClick={() => {
                  setSecCode('')
                  setConfirmLiveOpen(true)
                }}
                className="text-xs shrink-0"
              >
                ⚡ Generate Live Keys
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input
                  type="text"
                  readOnly
                  value={activeSecretKey}
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-900 focus:outline-none select-all"
                />
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  🔒 Masked
                </span>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50/80 border border-amber-200/60 rounded-lg p-2 leading-relaxed">
                ℹ️ <strong>Why is this masked?</strong> For security, secret keys are hashed with SHA-256 and cannot be retrieved in plaintext from the database. The full key is only shown once upon generation. If you lost your key, click <strong>Regenerate Secret Key</strong> below to create and copy a new one.
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 border-t border-slate-100">
            <p className="text-[11px] text-slate-400">
              Only the last 4 characters (<code className="font-mono">{activeSecretKey.slice(-4)}</code>) are visible for verification.
            </p>
            {(!isLive || hasLiveKeys) && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => openRegenModal('sk')}
                className="text-xs shrink-0"
              >
                🔄 Regenerate {isLive ? 'Live' : 'Test'} Secret Key
              </Button>
            )}
          </div>
        </div>

        {/* ─── API Key Rotation History ─── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">API Key Rotation History</h2>
              <p className="text-xs text-slate-500">Audit trail of all generated, active, and revoked developer credentials.</p>
            </div>
            <Badge variant="blue">{keyHistory.length} {keyHistory.length === 1 ? 'Key' : 'Keys'} Recorded</Badge>
          </div>

          {historyLoading ? (
            <div className="py-6 text-center text-xs text-slate-400">Loading rotation history...</div>
          ) : keyHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
              No previous key rotations on record.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Key Type</th>
                    <th className="px-4 py-2.5">Key Identifier</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Created Date</th>
                    <th className="px-4 py-2.5">Revoked Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keyHistory.map((key) => {
                    const isKeyLive = key.key_type.includes('live')
                    return (
                      <tr key={key.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] ${
                              isKeyLive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {key.key_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {key.prefix}...{key.suffix_display}
                        </td>
                        <td className="px-4 py-3">
                          {key.active ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                              Revoked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(key.created_at)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {key.revoked_at ? formatDate(key.revoked_at) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── Code Integration Examples ─── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Quick Integration Example ({isLive ? 'Production Live' : 'Sandbox Test'})
              </h2>
              <p className="text-xs text-slate-500">Create a dynamic payment checkout link via Lenis REST API.</p>
            </div>
            {/* Code Tabs */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              {(['curl', 'js', 'python'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCodeTab(tab)}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold uppercase transition-all ${
                    codeTab === tab ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'curl' ? 'cURL' : tab === 'js' ? 'Node.js' : 'Python'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative rounded-xl border border-slate-800 bg-slate-950 p-4 text-white overflow-x-auto">
            <pre className="font-mono text-xs leading-relaxed text-slate-200">
              {codeTab === 'curl' && curlCode}
              {codeTab === 'js' && jsCode}
              {codeTab === 'python' && pythonCode}
            </pre>
            <div className="absolute top-3 right-3">
              <CopyButton
                value={codeTab === 'curl' ? curlCode : codeTab === 'js' ? jsCode : pythonCode}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Unified Confirm Regenerate Modal with Security Challenge ─── */}
      <Modal
        isOpen={confirmRegenOpen}
        onClose={() => setConfirmRegenOpen(false)}
        title={`Authorize ${isLive ? 'Live' : 'Sandbox'} ${
          regenTarget === 'pk' ? 'Public Key' : regenTarget === 'pair' ? 'Full Key Pair' : 'Secret Key'
        } Rotation`}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
            ⚠️ <strong>Warning:</strong> Rotating your {regenTarget === 'pk' ? 'public key' : regenTarget === 'pair' ? 'key pair' : 'secret key'} will immediately revoke and invalidate the active key. Any running apps or checkout widgets using the previous key will require updating.
          </div>
          
          {/* Sleek Segmented Method Tabs */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Verification Channel
              </label>
              <span className="text-[11px] text-slate-400">
                {secMethod === 'email'
                  ? secStatus?.masked_email
                  : secMethod === 'phone'
                  ? secStatus?.masked_phone
                  : 'Authenticator App'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
              {/* Email Tab */}
              <button
                type="button"
                onClick={() => {
                  setSecMethod('email')
                  setSecCode('')
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                  secMethod === 'email'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>✉️</span>
                <span>Email</span>
              </button>

              {/* 2FA Tab */}
              {secStatus?.two_factor_enabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setSecMethod('2fa')
                    setSecCode('')
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                    secMethod === '2fa'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>🔐</span>
                  <span>2FA App</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium text-slate-400 opacity-40 cursor-not-allowed select-none"
                  title="2FA Authenticator not configured"
                >
                  <span className="grayscale opacity-70">🔐</span>
                  <span>2FA App</span>
                </div>
              )}

              {/* SMS Tab */}
              {secStatus?.phone_verified && secStatus?.masked_phone ? (
                <button
                  type="button"
                  onClick={() => {
                    setSecMethod('phone')
                    setSecCode('')
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                    secMethod === 'phone'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>💬</span>
                  <span>SMS</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium text-slate-400 opacity-40 cursor-not-allowed select-none"
                  title="Phone not verified"
                >
                  <span className="grayscale opacity-70">💬</span>
                  <span>SMS</span>
                </div>
              )}
            </div>
          </div>

          {/* Verification Code Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="sec-code-input" className="text-xs font-bold text-slate-800">
                {secMethod === '2fa'
                  ? 'Authenticator 6-digit Code'
                  : secMethod === 'phone'
                  ? ('SMS Code to ' + (secStatus?.masked_phone || 'Phone'))
                  : ('Email Code to ' + (secStatus?.masked_email || 'Email'))}
              </label>
              {secMethod !== '2fa' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={sendingOtp}
                  disabled={otpCooldown > 0}
                  onClick={() => handleSendActionOTP(secMethod)}
                  className="text-[11px] h-7 px-2"
                >
                  {otpCooldown > 0 ? ('Resend (' + otpCooldown + 's)') : 'Send Code'}
                </Button>
              )}
            </div>
            <Input
              id="sec-code-input"
              type="text"
              maxLength={6}
              placeholder="000000"
              value={secCode}
              onChange={(e) => setSecCode(e.target.value.replace(/\D/g, ''))}
              className="font-mono text-center text-lg tracking-widest"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmRegenOpen(false)}
              disabled={regenLoading}
            >
              Cancel
            </Button>
            <Button
              variant={regenTarget === 'sk' || regenTarget === 'pair' ? 'danger' : 'primary'}
              size="sm"
              loading={regenLoading}
              onClick={handleExecuteRegenerate}
            >
              Authorize & Rotate Key
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Confirm Live Keys Creation Modal with Security Challenge ─── */}
      <Modal
        isOpen={confirmLiveOpen}
        onClose={() => setConfirmLiveOpen(false)}
        title="Authorize Production Live Keys Generation"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 text-xs text-indigo-900">
            🚀 <strong>Production Access:</strong> Live API keys allow processing real on-chain crypto transactions. Authorize with your security code below to generate production credentials.
          </div>
          
          {/* Sleek Segmented Method Tabs */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Verification Channel
              </label>
              <span className="text-[11px] text-slate-400">
                {secMethod === 'email'
                  ? secStatus?.masked_email
                  : secMethod === 'phone'
                  ? secStatus?.masked_phone
                  : 'Authenticator App'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
              {/* Email Tab */}
              <button
                type="button"
                onClick={() => {
                  setSecMethod('email')
                  setSecCode('')
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                  secMethod === 'email'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>✉️</span>
                <span>Email</span>
              </button>

              {/* 2FA Tab */}
              {secStatus?.two_factor_enabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setSecMethod('2fa')
                    setSecCode('')
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                    secMethod === '2fa'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>🔐</span>
                  <span>2FA App</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium text-slate-400 opacity-40 cursor-not-allowed select-none"
                  title="2FA Authenticator not configured"
                >
                  <span className="grayscale opacity-70">🔐</span>
                  <span>2FA App</span>
                </div>
              )}

              {/* SMS Tab */}
              {secStatus?.phone_verified && secStatus?.masked_phone ? (
                <button
                  type="button"
                  onClick={() => {
                    setSecMethod('phone')
                    setSecCode('')
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                    secMethod === 'phone'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>💬</span>
                  <span>SMS</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium text-slate-400 opacity-40 cursor-not-allowed select-none"
                  title="Phone not verified"
                >
                  <span className="grayscale opacity-70">💬</span>
                  <span>SMS</span>
                </div>
              )}
            </div>
          </div>

          {/* Verification Code Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="sec-live-code-input" className="text-xs font-bold text-slate-800">
                {secMethod === '2fa'
                  ? 'Authenticator 6-digit Code'
                  : secMethod === 'phone'
                  ? ('SMS Code to ' + (secStatus?.masked_phone || 'Phone'))
                  : ('Email Code to ' + (secStatus?.masked_email || 'Email'))}
              </label>
              {secMethod !== '2fa' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={sendingOtp}
                  disabled={otpCooldown > 0}
                  onClick={() => handleSendActionOTP(secMethod)}
                  className="text-[11px] h-7 px-2"
                >
                  {otpCooldown > 0 ? ('Resend (' + otpCooldown + 's)') : 'Send Code'}
                </Button>
              )}
            </div>
            <Input
              id="sec-live-code-input"
              type="text"
              maxLength={6}
              placeholder="000000"
              value={secCode}
              onChange={(e) => setSecCode(e.target.value.replace(/\D/g, ''))}
              className="font-mono text-center text-lg tracking-widest"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmLiveOpen(false)}
              disabled={liveLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={liveLoading}
              onClick={handleGenerateLiveKeys}
            >
              Authorize & Generate Keys
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Revealed regenerated key modal (SK or Pair) ─── */}
      <RevealedKeyModal
        isOpen={revealedRegenKeys !== null}
        onClose={() => setRevealedRegenKeys(null)}
        secretKey={revealedRegenKeys?.secretKey ?? ''}
        publishableKey={revealedRegenKeys?.publishableKey}
        title="Your Rotated Credentials"
      />

      {/* ─── Revealed live SK modal ─── */}
      <RevealedKeyModal
        isOpen={revealedLiveKey !== null}
        onClose={() => setRevealedLiveKey(null)}
        secretKey={revealedLiveKey ?? ''}
        title="Your Production Live Secret Key"
      />
    </SecurityGate>
  )
}

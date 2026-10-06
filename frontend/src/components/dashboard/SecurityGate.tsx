import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'
import { useToast } from '../ui/Toaster'

export interface SecurityChallengeStatus {
  two_factor_enabled: boolean
  phone_verified: boolean
  masked_phone: string | null
  masked_email: string
  is_unlocked: boolean
  unlocked_until: string | null
  available_methods: ('2fa' | 'email' | 'phone')[]
  default_method: '2fa' | 'email' | 'phone'
}

interface SecurityGateProps {
  children: React.ReactNode
}

export function SecurityGate({ children }: SecurityGateProps) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SecurityChallengeStatus | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<'2fa' | 'email' | 'phone'>('email')
  
  const [code, setCode] = useState('')
  const [rememberDevice, setRememberDevice] = useState(true)
  const [verifying, setVerifying] = useState(false)
  
  const [otpSent, setOtpSent] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await apiClient.get<SecurityChallengeStatus>('/users/me/security-challenge/status')
      setStatus(data)
      setSelectedMethod(data.default_method)
    } catch {
      // Non-fatal error loading status
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Cooldown countdown effect
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  async function handleSendOTP(channel: 'email' | 'phone') {
    setSendingOtp(true)
    try {
      const { data } = await apiClient.post<{ message: string }>('/users/me/security-challenge/request-otp', {
        channel,
      })
      setOtpSent(true)
      setResendCooldown(60)
      toast.success(data.message || ('Verification code sent to your ' + channel + '.'))
    } catch (err: any) {
      const msg = err.response?.data?.detail?.detail || 'Failed to send verification code.'
      toast.error(msg)
    } finally {
      setSendingOtp(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) {
      toast.error('Please enter the 6-digit verification code.')
      return
    }

    setVerifying(true)
    try {
      const { data } = await apiClient.post<{ verified: boolean; message: string }>(
        '/users/me/security-challenge/verify',
        {
          code: code.trim(),
          method: selectedMethod,
          remember_device: rememberDevice,
        }
      )
      if (data.verified) {
        toast.success('Security access granted.')
        fetchStatus()
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail?.detail || 'Invalid verification code. Please try again.'
      toast.error(msg)
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          Verifying security session...
        </div>
      </div>
    )
  }

  // If already unlocked on this device, render protected content
  if (status?.is_unlocked) {
    return <>{children}</>
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="border-slate-200/80 shadow-sm overflow-hidden p-0">
        {/* Top Header */}
        <div className="bg-slate-900 px-6 py-6 text-white text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 border border-slate-700 text-2xl shadow-inner">
            🔐
          </div>
          <h2 className="text-lg font-bold tracking-tight text-white">Security Verification Required</h2>
          <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
            API keys and developer credentials grant direct access to your merchant funds and webhooks. Please verify your identity to proceed.
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* Sleek Segmented Method Tabs */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Verification Channel
              </label>
              <span className="text-[11px] text-slate-400">
                {selectedMethod === 'email'
                  ? status?.masked_email
                  : selectedMethod === 'phone'
                  ? status?.masked_phone
                  : 'Authenticator App'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
              {/* Email Tab */}
              <button
                type="button"
                onClick={() => {
                  setSelectedMethod('email')
                  setCode('')
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  selectedMethod === 'email'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>✉️</span>
                <span>Email OTP</span>
              </button>

              {/* 2FA App Tab */}
              {status?.two_factor_enabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMethod('2fa')
                    setCode('')
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                    selectedMethod === '2fa'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>🔐</span>
                  <span>2FA App</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-400 opacity-40 cursor-not-allowed select-none"
                  title="2FA Authenticator not configured (enable in Settings)"
                >
                  <span className="grayscale opacity-70">🔐</span>
                  <span>2FA App</span>
                </div>
              )}

              {/* SMS OTP Tab */}
              {status?.phone_verified && status?.masked_phone ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMethod('phone')
                    setCode('')
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                    selectedMethod === 'phone'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>💬</span>
                  <span>SMS OTP</span>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-400 opacity-40 cursor-not-allowed select-none"
                  title="Phone number not verified (link in Settings)"
                >
                  <span className="grayscale opacity-70">💬</span>
                  <span>SMS OTP</span>
                </div>
              )}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleVerify} className="space-y-4">
            {selectedMethod === '2fa' ? (
              <div className="space-y-2">
                <label htmlFor="totp-code" className="block text-xs font-semibold text-slate-700">
                  Enter 6-digit code from your Authenticator app
                </label>
                <Input
                  id="totp-code"
                  type="text"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="font-mono text-center text-lg tracking-widest"
                  autoFocus
                  required
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="otp-input" className="block text-xs font-semibold text-slate-700">
                    {selectedMethod === 'email'
                      ? ('Enter code sent to ' + (status?.masked_email || 'your email'))
                      : ('Enter code sent to ' + (status?.masked_phone || 'your phone'))}
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={sendingOtp}
                    disabled={resendCooldown > 0}
                    onClick={() => handleSendOTP(selectedMethod as 'email' | 'phone')}
                    className="text-xs"
                  >
                    {resendCooldown > 0
                      ? ('Resend in ' + resendCooldown + 's')
                      : otpSent
                      ? 'Resend Code'
                      : 'Send Verification Code'}
                  </Button>
                </div>

                <Input
                  id="otp-input"
                  type="text"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="font-mono text-center text-lg tracking-widest"
                  autoFocus
                  required
                />
              </div>
            )}

            {/* Remember device checkbox */}
            <div className="flex items-center gap-2 pt-1">
              <input
                id="remember-device"
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <label htmlFor="remember-device" className="text-xs text-slate-600 select-none">
                Remember this device for <strong>2 weeks (14 days)</strong>
              </label>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={verifying}
              className="w-full justify-center shadow-xs text-sm"
            >
              Verify & Unlock Credentials
            </Button>
          </form>

          {/* Footer disclaimer */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-500 text-center">
            🔒 Re-verification is automatically required if your IP address or browser changes, or whenever regenerating active credentials.
          </div>
        </div>
      </Card>
    </div>
  )
}

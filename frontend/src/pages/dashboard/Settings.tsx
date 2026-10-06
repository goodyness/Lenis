import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AxiosError } from 'axios'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useAuthStore } from '../../lib/auth-store'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { useMerchantStore, type Branding } from '../../stores/merchantStore'
import { apiClient } from '../../lib/api'

// ─── Tab Definition ───────────────────────────────────────────────────────────

type SettingsTab = 'profile' | 'notifications' | 'billing' | 'security' | 'branding' | 'wallets'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  user_id: string
  email: string
  full_name: string
  account_type: string
  status: string
  email_verified: boolean
  phone_number?: string | null
  phone_verified?: boolean
  two_factor_enabled: boolean
  subscription_tier?: string
  subscription_period?: string | null
  subscription_expires_at?: string | null
  monthly_tx_count?: number
  created_at: string
}

interface TwoFactorSetupResponse {
  secret: string
  otpauth_url: string
  qr_code_data_url: string
}

interface NotificationPreferences {
  email_payment_detected: boolean
  email_payment_confirmed: boolean
  email_invoice_paid: boolean
  email_kyc_decision: boolean
  email_security_alerts: boolean
  inapp_payment_detected: boolean
  inapp_payment_confirmed: boolean
  inapp_invoice_paid: boolean
  inapp_kyc_decision: boolean
  inapp_security_alerts: boolean
  sms_enabled: boolean
  sms_payment_confirmed: boolean
}

interface UserPaymentHistoryItem {
  id: string
  user_id: string
  tier: string
  tier_name?: string
  period: string
  usd_amount: number
  crypto_token: string
  crypto_network: string
  crypto_amount: string
  amount_received?: string | null
  remaining_balance?: string | null
  assigned_wallet_address: string
  tx_hash?: string | null
  status: string
  is_expired: boolean
  time_remaining_seconds: number
  confirmed_at?: string | null
  expires_at: string
  created_at: string
}

interface SubscriptionOverview {
  tier: string
  tier_name: string
  monthly_tx_count: number
  monthly_tx_cap: number
  period?: string | null
  expires_at?: string | null
  features: string[]
  is_active: boolean
}

// ─── Preset Brand Colors ──────────────────────────────────────────────────────

const PRESET_COLORS = [
  { name: 'Lenis Blue', hex: '#0052FF' },
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Sky', hex: '#0284C7' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Rose', hex: '#EC4899' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Dark Slate', hex: '#0F172A' },
]

// ─── KYC status labels ────────────────────────────────────────────────────────

const kycLabel: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Not started', color: 'text-slate-500' },
  pending: { label: 'Under review', color: 'text-blue-600' },
  approved: { label: 'Verified', color: 'text-green-600' },
  rejected: { label: 'Rejected', color: 'text-red-600' },
}

// ─── Subscription Plan Definitions ───────────────────────────────────────────

const SUBSCRIPTION_PLANS = [
  {
    tier: 'free',
    name: 'Starter',
    badge: 'Free Forever',
    priceMonthly: 0,
    priceYearly: 0,
    txCap: 50,
    description: 'Perfect for testing, early-stage developers & pilot merchants.',
    features: [
      'Up to 50 transactions / mo',
      'Non-custodial EVM settlements',
      'Base & Polygon networks',
      'Instant Webhook notifications',
      'Standard email support',
    ],
    highlight: false,
  },
  {
    tier: 'growth',
    name: 'Growth Pro',
    badge: 'Popular for Businesses',
    priceMonthly: 29,
    priceYearly: 290,
    txCap: 1000,
    description: 'Designed for scaling e-commerce, SaaS & crypto merchants.',
    features: [
      'Up to 1,000 transactions / mo',
      'All EVM chains + Priority indexing',
      'Custom store branding & logo',
      'Instant Email & In-App Alerts',
      'Priority 24/7 technical support',
      'API rate limit: 300 req/min',
    ],
    highlight: true,
  },
  {
    tier: 'scale',
    name: 'Scale Business',
    badge: 'High Throughput',
    priceMonthly: 99,
    priceYearly: 990,
    txCap: 10000,
    description: 'For high-volume web3 apps, fintechs & large enterprises.',
    features: [
      'Up to 10,000 transactions / mo',
      'Dedicated high-throughput RPC indexers',
      'Multi-wallet settlement routing',
      'Automated customer payment reminders',
      'Dedicated account manager',
      'Early access to new blockchain chains',
    ],
    highlight: false,
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function Settings() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const fetchOnboardingStatus = useOnboardingStore((s) => s.fetchStatus)
  const onboardingStatus = useOnboardingStore((s) => s.status)

  const fetchBranding = useMerchantStore((s) => s.fetchBranding)
  const updateBranding = useMerchantStore((s) => s.updateBranding)
  const uploadBrandingLogo = useMerchantStore((s) => s.uploadBrandingLogo)

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── Phone OTP Verification State ──────────────────────────────────────────
  const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false)
  const [phoneInput, setPhoneInput] = useState('')
  const [otpInput, setOtpInput] = useState('')
  const [phoneStep, setPhoneStep] = useState<'enter_phone' | 'enter_otp'>('enter_phone')
  const [phoneLoading, setPhoneLoading] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [phoneSuccess, setPhoneSuccess] = useState<string | null>(null)
  const [resendTimer, setResendTimer] = useState(0)

  // ─── Didit Auto KYC Verification State ─────────────────────────────────────
  const [isDiditModalOpen, setIsDiditModalOpen] = useState(false)
  const [diditSessionUrl, setDiditSessionUrl] = useState<string | null>(null)
  const [diditSessionId, setDiditSessionId] = useState<string | null>(null)
  const [diditLoading, setDiditLoading] = useState(false)
  const [diditCheckLoading, setDiditCheckLoading] = useState(false)
  const [diditStatusMsg, setDiditStatusMsg] = useState<string | null>(null)
  const [diditError, setDiditError] = useState<string | null>(null)

  // ─── Notification Preferences State ────────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    email_payment_detected: true,
    email_payment_confirmed: true,
    email_invoice_paid: true,
    email_kyc_decision: true,
    email_security_alerts: true,
    inapp_payment_detected: true,
    inapp_payment_confirmed: true,
    inapp_invoice_paid: true,
    inapp_kyc_decision: true,
    inapp_security_alerts: true,
    sms_enabled: false,
    sms_payment_confirmed: false,
  })
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifSuccess, setNotifSuccess] = useState<string | null>(null)
  const [notifError, setNotifError] = useState<string | null>(null)

  // ─── Subscription Overview & Payment History State ─────────────────────────
  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<UserPaymentHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [upgradingTier, setUpgradingTier] = useState<string | null>(null)
  const [subSuccess, setSubSuccess] = useState<string | null>(null)
  const [subError, setSubError] = useState<string | null>(null)

  // ─── Multi-step Automatic Crypto Checkout Modal State ────────────────────────
  const [isCryptoModalOpen, setIsCryptoModalOpen] = useState(false)
  const [checkoutStep, setCheckoutStep] = useState<'select_chain' | 'pay_and_detect' | 'success'>('select_chain')
  const [selectedPlanForUpgrade, setSelectedPlanForUpgrade] = useState<typeof SUBSCRIPTION_PLANS[0] | null>(null)
  const [cryptoToken, setCryptoToken] = useState<'USDC' | 'USDT' | 'ETH' | 'POL' | 'BNB'>('USDC')
  const [cryptoNetwork, setCryptoNetwork] = useState<'base' | 'polygon' | 'arbitrum' | 'ethereum' | 'bsc'>('base')
  const [cryptoIntent, setCryptoIntent] = useState<{
    payment_id: string
    tier: string
    tier_name: string
    period: string
    usd_amount: number
    crypto_token: string
    crypto_network: string
    crypto_amount: string
    assigned_wallet_address: string
    expires_at: string
  } | null>(null)
  const [intentLoading, setIntentLoading] = useState(false)
  const [txHashInput, setTxHashInput] = useState('')
  const [confirmedTxHash, setConfirmedTxHash] = useState<string | null>(null)
  const [showManualTxInput, setShowManualTxInput] = useState(false)
  const [verifyingTx, setVerifyingTx] = useState(false)
  const [cryptoModalError, setCryptoModalError] = useState<string | null>(null)
  const [copiedWallet, setCopiedWallet] = useState(false)
  const [countdownSeconds, setCountdownSeconds] = useState(1200)
  const [underpaidWarning, setUnderpaidWarning] = useState<{ received: string; remaining: string } | null>(null)

  // ─── Branding State ─────────────────────────────────────────────────────────
  const [branding, setBranding] = useState<Branding>({
    business_name: '',
    brand_logo_url: null,
    brand_color: '#4F46E5',
    brand_tagline: '',
    support_email: '',
    support_phone: '',
  })
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [brandingSuccess, setBrandingSuccess] = useState<string | null>(null)
  const [brandingError, setBrandingError] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoLoadError, setLogoLoadError] = useState(false)
  const [previewMode, setPreviewMode] = useState<'checkout' | 'receipt'>('checkout')

  // ─── Password Change State ──────────────────────────────────────────────────
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState<string | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  // ─── 2FA State ──────────────────────────────────────────────────────────────
  const [is2FASetupModalOpen, setIs2FASetupModalOpen] = useState(false)
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null)
  const [setupCode, setSetupCode] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupLoading, setSetupLoading] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)

  const [is2FADisableModalOpen, setIs2FADisableModalOpen] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [disableError, setDisableError] = useState<string | null>(null)
  const [disableLoading, setDisableLoading] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') as SettingsTab | null
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab && ['profile', 'notifications', 'billing', 'security', 'branding', 'wallets'].includes(initialTab)
      ? initialTab
      : 'profile'
  )

  // Handle ?tab=billing&upgrade=growth deep links from pricing page
  useEffect(() => {
    const upgradeParam = searchParams.get('upgrade')
    if (upgradeParam && activeTab === 'billing') {
      const target = SUBSCRIPTION_PLANS.find((p) => p.tier === upgradeParam)
      if (target) {
        handleOpenCryptoUpgrade(target)
      }
    }
  }, [searchParams, activeTab])

  function handleTabChange(tab: SettingsTab) {
    setActiveTab(tab)
    setSearchParams({ tab }, { replace: true })
  }

  const [securitySuccessMsg, setSecuritySuccessMsg] = useState<string | null>(null)

  // Countdown timer for SMS OTP resend
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer((t) => t - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendTimer])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const loads: Promise<unknown>[] = [
        apiClient.get<UserProfile>('/users/me'),
        fetchOnboardingStatus(),
        apiClient.get<NotificationPreferences>('/users/me/notifications/preferences'),
        apiClient.get<SubscriptionOverview>('/users/me/subscription'),
      ]
      if (user?.account_type === 'merchant') {
        loads.push(fetchBranding())
      }
      const [profileRes, , notifRes, subRes, brandData] = await Promise.all(loads) as [
        { data: UserProfile },
        unknown,
        { data: NotificationPreferences },
        { data: SubscriptionOverview },
        Branding | undefined,
      ]
      setProfile(profileRes.data)
      const existingPhone = profileRes.data.phone_number || onboardingStatus?.phone_number || ''
      if (existingPhone) {
        setPhoneInput(existingPhone)
      }
      if (notifRes.data) {
        setNotifPrefs(notifRes.data)
      }
      if (subRes.data) {
        setSubscription(subRes.data)
      }
      if (brandData) {
        setBranding({
          business_name: brandData.business_name || '',
          brand_logo_url: brandData.brand_logo_url || null,
          brand_color: brandData.brand_color || '#4F46E5',
          brand_tagline: brandData.brand_tagline || '',
          support_email: brandData.support_email || '',
          support_phone: brandData.support_phone || '',
        })
      }
    } catch {
      setError('Failed to load profile. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Phone OTP Functions ───────────────────────────────────────────────────

  function openPhoneModal() {
    setPhoneError(null)
    setPhoneSuccess(null)
    setOtpInput('')
    setPhoneStep('enter_phone')
    const existingPhone = profile?.phone_number || onboardingStatus?.phone_number || ''
    if (existingPhone) {
      setPhoneInput(existingPhone)
    }
    setIsPhoneModalOpen(true)
  }

  async function handleSendPhoneOtp(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!phoneInput.trim()) {
      setPhoneError('Please enter a valid mobile number.')
      return
    }
    setPhoneError(null)
    setPhoneSuccess(null)
    setPhoneLoading(true)
    try {
      const res = await apiClient.post<{ message: string }>('/users/me/phone/send-otp', {
        phone_number: phoneInput.trim(),
      })
      setPhoneSuccess(res.data?.message || 'Verification code sent via SMS!')
      setPhoneStep('enter_otp')
      setResendTimer(60)
    } catch (err: unknown) {
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setPhoneError(msg || 'Failed to send verification SMS. Please verify your phone format and try again.')
    } finally {
      setPhoneLoading(false)
    }
  }

  async function handleVerifyPhoneOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otpInput.trim() || otpInput.trim().length !== 6) {
      setPhoneError('Please enter the 6-digit OTP code received on your phone.')
      return
    }
    setPhoneError(null)
    setPhoneLoading(true)
    try {
      await apiClient.post<{ message: string; phone_number: string }>('/users/me/phone/verify-otp', {
        phone_number: phoneInput.trim(),
        otp: otpInput.trim(),
      })
      setSecuritySuccessMsg('Phone number verified successfully and saved as your primary contact!')
      setIsPhoneModalOpen(false)
      load()
    } catch (err: unknown) {
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setPhoneError(msg || 'Invalid or expired OTP code. Please try again.')
    } finally {
      setPhoneLoading(false)
    }
  }

  // ─── Didit Automated KYC Functions ─────────────────────────────────────────

  async function handleStartDiditKYC() {
    setDiditLoading(true)
    setDiditError(null)
    setDiditStatusMsg(null)
    setIsDiditModalOpen(true)
    try {
      const res = await apiClient.post<{ session_id: string; url: string }>('/merchant/kyc/didit/session')
      setDiditSessionId(res.data.session_id)
      setDiditSessionUrl(res.data.url)
      window.open(res.data.url, '_blank', 'noopener,noreferrer')
      setDiditStatusMsg('Verification window opened on Didit. Complete your ID and biometric scan, then click Confirm.')
    } catch {
      setDiditError('Failed to initialize Didit auto-verification. Please retry.')
    } finally {
      setDiditLoading(false)
    }
  }

  async function handleCheckDiditKYC() {
    setDiditCheckLoading(true)
    setDiditError(null)
    try {
      const activeSession = diditSessionId || onboardingStatus?.kyc_didit_session_id || undefined
      const res = await apiClient.post<{
        status: string
        kyc_status: string
        reason?: string
      }>('/merchant/kyc/didit/check', {
        session_id: activeSession,
      })

      if (res.data.status === 'approved' || res.data.kyc_status === 'approved') {
        setSecuritySuccessMsg('Your identity and merchant profile have been verified successfully with Didit!')
        setIsDiditModalOpen(false)
        await fetchOnboardingStatus()
        await load()
      } else if (res.data.status === 'rejected' || res.data.kyc_status === 'rejected') {
        setDiditError(res.data.reason || 'Verification was declined by Didit.')
        await fetchOnboardingStatus()
        await load()
      } else {
        setDiditStatusMsg('Verification is still in progress on Didit. Once you complete the scan on Didit, click Confirm below.')
      }
    } catch {
      setDiditError('Failed to check Didit verification status. Please verify your connection.')
    } finally {
      setDiditCheckLoading(false)
    }
  }

  // ─── Notification Preferences Functions ────────────────────────────────────

  async function handleSaveNotificationPreferences(e: React.FormEvent) {
    e.preventDefault()
    setNotifSaving(true)
    setNotifSuccess(null)
    setNotifError(null)
    try {
      const res = await apiClient.put<NotificationPreferences>('/users/me/notifications/preferences', notifPrefs)
      setNotifPrefs(res.data)
      setNotifSuccess('Notification preferences saved successfully!')
    } catch {
      setNotifError('Failed to save notification preferences. Please try again.')
    } finally {
      setNotifSaving(false)
    }
  }

  // ─── Subscription Functions ────────────────────────────────────────────────


  // ─── Fetch Subscription Payment History ─────────────────────────────────────
  async function fetchPaymentHistory() {
    setHistoryLoading(true)
    try {
      const res = await apiClient.get<{ payments: UserPaymentHistoryItem[]; total: number }>(
        '/users/me/subscription/payments'
      )
      setPaymentHistory(res.data.payments)
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'billing') {
      fetchPaymentHistory()
    }
  }, [activeTab])

  // ─── Active Countdown Timer for Modal ────────────────────────────────────────
  useEffect(() => {
    if (isCryptoModalOpen && checkoutStep === 'pay_and_detect' && countdownSeconds > 0) {
      const timer = setInterval(() => {
        setCountdownSeconds((s) => Math.max(0, s - 1))
      }, 1000)
      return () => clearInterval(timer)
    }
  }, [isCryptoModalOpen, checkoutStep, countdownSeconds])

  // ─── Automatic On-Chain Payment Poller ────────────────────────────────────────
  useEffect(() => {
    let poller: any = null
    if (isCryptoModalOpen && checkoutStep === 'pay_and_detect' && cryptoIntent?.payment_id) {
      poller = setInterval(async () => {
        try {
          const res = await apiClient.get<UserPaymentHistoryItem>(
            `/users/me/subscription/payments/${cryptoIntent.payment_id}`
          )
          if (res.data.status === 'confirmed') {
            setConfirmedTxHash(res.data.tx_hash || '0x' + 'f'.repeat(64))
            setCheckoutStep('success')
            // Refresh subscription & profile
            const subRes = await apiClient.get<SubscriptionOverview>('/users/me/subscription')
            setSubscription(subRes.data)
            fetchPaymentHistory()
            if (profile) {
              setProfile({ ...profile, subscription_tier: res.data.tier })
            }
          } else if (res.data.status === 'underpaid') {
            setUnderpaidWarning({
              received: res.data.amount_received || '0',
              remaining: res.data.remaining_balance || '0',
            })
          } else if (res.data.status === 'failed' || res.data.is_expired) {
            setCryptoModalError('Payment session has expired. Please initiate a new upgrade.')
          }
        } catch {
          // ignore network glitch during polling
        }
      }, 3000)
    }
    return () => {
      if (poller) clearInterval(poller)
    }
  }, [isCryptoModalOpen, checkoutStep, cryptoIntent, profile])

  async function fetchCryptoIntent(tier: string, period: 'monthly' | 'yearly', token: string, network: string) {
    setIntentLoading(true)
    setCryptoModalError(null)
    setUnderpaidWarning(null)
    try {
      const res = await apiClient.post('/users/me/subscription/crypto-intent', {
        tier,
        period,
        crypto_token: token,
        crypto_network: network,
      })
      setCryptoIntent(res.data)
      setCountdownSeconds(1200)
      setCheckoutStep('pay_and_detect')
      fetchPaymentHistory()
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to generate crypto payment intent.'
      setCryptoModalError(typeof msg === 'object' ? msg.detail || 'Error' : msg)
    } finally {
      setIntentLoading(false)
    }
  }

  function handleOpenCryptoUpgrade(plan: typeof SUBSCRIPTION_PLANS[0]) {
    if (plan.tier === 'free') {
      handleUpgradeTier('free')
      return
    }
    setSelectedPlanForUpgrade(plan)
    setCryptoModalError(null)
    setUnderpaidWarning(null)
    setTxHashInput('')
    setConfirmedTxHash(null)
    setShowManualTxInput(false)
    setCheckoutStep('select_chain')
    setIsCryptoModalOpen(true)
  }

  function handleResumePendingPayment(item: UserPaymentHistoryItem) {
    const plan = SUBSCRIPTION_PLANS.find((p) => p.tier === item.tier) || SUBSCRIPTION_PLANS[1]
    setSelectedPlanForUpgrade(plan)
    setCryptoToken(item.crypto_token as any)
    setCryptoNetwork(item.crypto_network as any)
    setCryptoIntent({
      payment_id: item.id,
      tier: item.tier,
      tier_name: item.tier_name || plan.name,
      period: item.period,
      usd_amount: item.usd_amount,
      crypto_token: item.crypto_token,
      crypto_network: item.crypto_network,
      crypto_amount: item.crypto_amount,
      assigned_wallet_address: item.assigned_wallet_address,
      expires_at: item.expires_at,
    })
    setCountdownSeconds(item.time_remaining_seconds || 1200)
    setCryptoModalError(null)
    setUnderpaidWarning(
      item.amount_received
        ? { received: item.amount_received, remaining: item.remaining_balance || '0' }
        : null
    )
    setCheckoutStep('pay_and_detect')
    setIsCryptoModalOpen(true)
  }

  async function handleConfirmCryptoPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!cryptoIntent) return

    const hash = txHashInput.trim()
    if (!hash.startsWith('0x') || hash.length !== 66) {
      setCryptoModalError('Please enter a valid 66-character EVM transaction hash (starting with 0x).')
      return
    }

    setVerifyingTx(true)
    setCryptoModalError(null)
    try {
      const res = await apiClient.post<UserPaymentHistoryItem>('/users/me/subscription/submit-tx', {
        payment_id: cryptoIntent.payment_id,
        tx_hash: hash,
      })
      if (res.data.status === 'confirmed') {
        setConfirmedTxHash(hash)
        setCheckoutStep('success')
        const subRes = await apiClient.get<SubscriptionOverview>('/users/me/subscription')
        setSubscription(subRes.data)
        fetchPaymentHistory()
        if (profile) {
          setProfile({ ...profile, subscription_tier: cryptoIntent.tier })
        }
      } else if (res.data.status === 'underpaid') {
        setUnderpaidWarning({
          received: res.data.amount_received || '0',
          remaining: res.data.remaining_balance || '0',
        })
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Transaction verification failed. Please check the hash and retry.'
      setCryptoModalError(typeof msg === 'object' ? msg.detail || 'Error' : msg)
    } finally {
      setVerifyingTx(false)
    }
  }

  async function handleUpgradeTier(targetTier: string) {
    setUpgradingTier(targetTier)
    setSubSuccess(null)
    setSubError(null)
    try {
      const res = await apiClient.post<SubscriptionOverview>('/users/me/subscription/upgrade', {
        tier: targetTier,
        period: billingPeriod,
      })
      setSubscription(res.data)
      setSubSuccess(`Your subscription has been updated to ${res.data.tier_name}!`)
      if (profile) {
        setProfile({ ...profile, subscription_tier: targetTier })
      }
    } catch (err: unknown) {
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setSubError(msg || 'Failed to update subscription. Please try again.')
    } finally {
      setUpgradingTier(null)
    }
  }

  // ─── Branding Handlers ─────────────────────────────────────────────────────

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    setBrandingError(null)
    setLogoLoadError(false)
    const localBlobUrl = URL.createObjectURL(file)
    setBranding((prev) => ({ ...prev, brand_logo_url: localBlobUrl }))
    try {
      const updated = await uploadBrandingLogo(file)
      setBranding((prev) => ({ ...prev, brand_logo_url: updated.brand_logo_url || localBlobUrl }))
      setBrandingSuccess('Brand logo uploaded successfully!')
    } catch (err: unknown) {
      setBrandingError(err instanceof Error ? err.message : 'Failed to upload logo.')
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleSaveBranding(e: React.FormEvent) {
    e.preventDefault()
    setBrandingSaving(true)
    setBrandingError(null)
    setBrandingSuccess(null)
    try {
      const updated = await updateBranding({
        brand_color: branding.brand_color,
        brand_tagline: branding.brand_tagline || null,
        support_email: branding.support_email || null,
        support_phone: branding.support_phone || null,
        brand_logo_url: branding.brand_logo_url || null,
      })
      setBranding({
        business_name: updated.business_name || '',
        brand_logo_url: updated.brand_logo_url || null,
        brand_color: updated.brand_color || '#4F46E5',
        brand_tagline: updated.brand_tagline || '',
        support_email: updated.support_email || '',
        support_phone: updated.support_phone || '',
      })
      setBrandingSuccess('Store branding saved successfully!')
    } catch (err: unknown) {
      setBrandingError(err instanceof Error ? err.message : 'Failed to save branding settings.')
    } finally {
      setBrandingSaving(false)
    }
  }

  // ─── Password Handlers ─────────────────────────────────────────────────────

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(null)

    if (!currentPassword) {
      setPwError('Please enter your current password.')
      return
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }

    setPwLoading(true)
    try {
      await apiClient.post('/users/me/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      setPwSuccess('Your password has been changed successfully. A confirmation email has been dispatched.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSecuritySuccessMsg('Password updated successfully.')
      setTimeout(() => {
        setIsPasswordModalOpen(false)
        setPwSuccess(null)
      }, 2500)
    } catch (err: unknown) {
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setPwError(msg || 'Failed to change password. Please check your credentials and try again.')
    } finally {
      setPwLoading(false)
    }
  }

  // ─── 2FA Handlers ──────────────────────────────────────────────────────────

  async function open2FASetup() {
    setSetupError(null)
    setSetupCode('')
    setSetupLoading(true)
    setIs2FASetupModalOpen(true)
    try {
      const res = await apiClient.post<TwoFactorSetupResponse>('/users/me/2fa/setup')
      setSetupData(res.data)
    } catch {
      setSetupError('Failed to initialize 2FA setup. Please try again.')
    } finally {
      setSetupLoading(false)
    }
  }

  async function handleEnable2FA(e: React.FormEvent) {
    e.preventDefault()
    if (!setupData || !setupCode.trim()) {
      setSetupError('Please enter the 6-digit code from your authenticator app.')
      return
    }
    setSetupError(null)
    setSetupLoading(true)
    try {
      await apiClient.post('/users/me/2fa/enable', {
        secret: setupData.secret,
        code: setupCode.trim(),
      })
      setIs2FASetupModalOpen(false)
      setSecuritySuccessMsg('Two-Factor Authentication is now enabled on your account.')
      load()
    } catch (err: unknown) {
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setSetupError(msg || 'Invalid authentication code. Please check and try again.')
    } finally {
      setSetupLoading(false)
    }
  }

  async function handleDisable2FA(e: React.FormEvent) {
    e.preventDefault()
    if (!disablePassword) {
      setDisableError('Please enter your account password.')
      return
    }
    setDisableError(null)
    setDisableLoading(true)
    try {
      await apiClient.post('/users/me/2fa/disable', {
        password: disablePassword,
        code: disableCode.trim() || undefined,
      })
      setIs2FADisableModalOpen(false)
      setDisablePassword('')
      setDisableCode('')
      setSecuritySuccessMsg('Two-Factor Authentication has been disabled.')
      load()
    } catch (err: unknown) {
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setDisableError(msg || 'Failed to disable 2FA. Please verify your password and try again.')
    } finally {
      setDisableLoading(false)
    }
  }

  function copySecretToClipboard() {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret)
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <div className="space-y-3" aria-busy="true" aria-label="Loading settings">
          <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-red-600" role="alert">{error}</p>
        <Button variant="secondary" size="sm" onClick={load}>Retry</Button>
      </div>
    )
  }

  const kyc = onboardingStatus
    ? kycLabel[onboardingStatus.kyc_status] ?? kycLabel.not_started
    : null

  const onboardingComplete = onboardingStatus?.onboarding_complete ?? false

  const tabs = [
    { id: 'profile' as const, label: 'Profile & Contact', icon: '👤' },
    { id: 'notifications' as const, label: 'Notifications', icon: '🔔' },
    { id: 'billing' as const, label: 'Subscription & Plans', icon: '💎' },
    { id: 'security' as const, label: 'Security & 2FA', icon: '🔒' },
    ...(user?.account_type === 'merchant'
      ? [{ id: 'branding' as const, label: 'Store Branding', icon: '🎨' }]
      : []),
    { id: 'wallets' as const, label: 'Payout Wallets', icon: '💳' },
  ]

  const displayPhone = profile?.phone_number || onboardingStatus?.phone_number

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="text-xs text-slate-500">
          Manage your account profile, mobile OTP contact, notifications, tiered subscriptions, credentials, and branding.
        </p>
      </div>

      {securitySuccessMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span className="font-semibold">{securitySuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSecuritySuccessMsg(null)}
            className="text-xs text-emerald-600 hover:text-emerald-900 font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ─── Tab Navigation Bar ────────────────────────────────────────────── */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-1 sm:space-x-6 overflow-x-auto" aria-label="Settings Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 border-b-2 py-3.5 px-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-slate-900 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.id === 'security' && profile?.two_factor_enabled && (
                  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    2FA ON
                  </span>
                )}
                {tab.id === 'profile' && onboardingStatus?.kyc_status === 'approved' && (
                  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                    Verified
                  </span>
                )}
                {tab.id === 'billing' && subscription && (
                  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 uppercase">
                    {subscription.tier}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* ─── Tab: Profile & Contact ─────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          {/* Account info */}
          <Card title="Account Profile">
            <dl className="space-y-4">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Email address</dt>
                <dd className="text-sm font-mono text-slate-900">{profile?.email ?? user?.email ?? '—'}</dd>
              </div>

              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Full name</dt>
                <dd className="text-sm text-slate-900">{profile?.full_name || <span className="italic text-slate-400">Not set</span>}</dd>
              </div>

              {/* Phone / Contact Number with Termii OTP Verification Badge */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 border-t border-slate-100 pt-3">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Contact / Phone</dt>
                <dd className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-mono text-slate-900">
                    {displayPhone || <span className="italic text-slate-400">No phone attached</span>}
                  </span>

                  {profile?.phone_verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Not Verified
                    </span>
                  )}

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={openPhoneModal}
                    className="ml-auto sm:ml-2 text-xs"
                  >
                    {displayPhone ? (profile?.phone_verified ? 'Change Phone' : 'Verify Phone') : 'Add & Verify Phone'}
                  </Button>
                </dd>
              </div>

              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Account role</dt>
                <dd className="text-sm capitalize font-semibold text-slate-900">{profile?.account_type ?? '—'}</dd>
              </div>

              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Email verified</dt>
                <dd className={`text-sm font-semibold ${profile?.email_verified ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {profile?.email_verified ? '✓ Verified' : '⚠ Unverified'}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Verification status */}
          <Card title="KYC & Identity Verification">
            <dl className="space-y-4">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">KYC status</dt>
                <dd className={`text-sm font-bold ${kyc?.color ?? 'text-slate-500'}`}>
                  {kyc?.label ?? '—'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Wallet added</dt>
                <dd className={`text-sm font-medium ${onboardingStatus?.wallet_added ? 'text-green-600' : 'text-yellow-600'}`}>
                  {onboardingStatus?.wallet_added ? 'Yes' : 'No'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Setup</dt>
                <dd className={`text-sm font-medium ${onboardingComplete ? 'text-green-600' : 'text-yellow-600'}`}>
                  {onboardingComplete ? 'Complete' : 'Incomplete'}
                </dd>
              </div>
              {(onboardingStatus?.kyc_didit_session_id || diditSessionId) && (
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4 border-t border-slate-100 pt-3">
                  <dt className="w-40 shrink-0 text-sm font-medium text-slate-500">Didit Session</dt>
                  <dd className="text-xs font-mono text-slate-700">
                    {onboardingStatus?.kyc_didit_session_id || diditSessionId}
                  </dd>
                </div>
              )}
            </dl>

            {/* Action Banner for unverified or rejected KYC */}
            {onboardingStatus?.kyc_status !== 'approved' && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚡</span>
                      <h4 className="text-sm font-bold text-slate-900">Instant Automated KYC (Didit)</h4>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                        Fastest (~60s)
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {onboardingStatus?.kyc_didit_session_id || diditSessionId
                        ? 'You have an active Didit verification session. Click to complete your scan or check your approval status.'
                        : 'Verify your identity automatically using biometric selfie and government ID scanning powered by Didit.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(onboardingStatus?.kyc_didit_session_id || diditSessionId) && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={diditCheckLoading}
                        onClick={handleCheckDiditKYC}
                        className="text-xs"
                      >
                        ⚡ Check Didit Status
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={diditLoading}
                      onClick={handleStartDiditKYC}
                      className="shrink-0 text-xs font-bold"
                    >
                      {onboardingStatus?.kyc_didit_session_id || diditSessionId
                        ? 'Resume Didit Verification →'
                        : 'Verify with Didit →'}
                    </Button>
                  </div>
                </div>

                <div className="border-t border-slate-200/80 pt-3 flex items-center justify-between">
                  <p className="text-xs text-slate-500">Need to submit or update document files manually?</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate('/onboarding?step=3')}
                    className="text-xs"
                  >
                    Manual Document Upload
                  </Button>
                </div>
              </div>
            )}

            {onboardingStatus?.kyc_status === 'approved' && (
              <div className="mt-5 space-y-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🛡️</span>
                    <span className="font-semibold text-emerald-900">
                      Your identity and merchant profile are fully verified. All crypto checkout and API gateway features are unlocked.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={diditLoading}
                      onClick={handleStartDiditKYC}
                      className="text-xs"
                    >
                      ⚡ Re-run / Test Didit Scan
                    </Button>
                    {(onboardingStatus?.kyc_didit_session_id || diditSessionId) && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={diditCheckLoading}
                        onClick={handleCheckDiditKYC}
                        className="text-xs"
                      >
                        Check Status
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── Tab: Notifications ────────────────────────────────────────────── */}
      {activeTab === 'notifications' && (
        <form onSubmit={handleSaveNotificationPreferences} className="space-y-6">
          {notifSuccess && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>✅</span>
                <span className="font-semibold">{notifSuccess}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotifSuccess(null)}
                className="text-xs text-emerald-700 font-bold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {notifError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center gap-2">
              <span>⚠️</span>
              <span>{notifError}</span>
            </div>
          )}

          {/* Email Notification Toggles */}
          <Card title="Email Notifications">
            <p className="text-xs text-slate-500 mb-4">
              Choose which transactional and security events send instant email updates to <span className="font-mono text-slate-900 font-bold">{profile?.email}</span>.
            </p>

            <div className="divide-y divide-slate-100">
              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Payment Detected on Mempool / Chain</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Receive immediate notice when a buyer broadcasts a transaction.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.email_payment_detected}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, email_payment_detected: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Payment Confirmed & Settled</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Dispatched when required block confirmations are reached on-chain.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.email_payment_confirmed}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, email_payment_confirmed: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Invoice Fully Paid</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Notifies you when an issued customer invoice is marked as paid.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.email_invoice_paid}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, email_invoice_paid: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Compliance & KYC Decisions</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Updates regarding business onboarding and document review statuses.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.email_kyc_decision}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, email_kyc_decision: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Security & Credentials Alerts</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Critical security notices including password changes and 2FA toggles.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.email_security_alerts}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, email_security_alerts: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>
            </div>
          </Card>

          {/* In-App Notification Toggles */}
          <Card title="In-App Notification Center">
            <p className="text-xs text-slate-500 mb-4">
              Control the events delivered to your dashboard notification bell dropdown.
            </p>

            <div className="divide-y divide-slate-100">
              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">In-App Payment Detected</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Toast & bell item when on-chain transfer is initially seen.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.inapp_payment_detected}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, inapp_payment_detected: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">In-App Payment Confirmed</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Instant bell badge when settlement reaches target depth.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.inapp_payment_confirmed}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, inapp_payment_confirmed: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">In-App Invoice Paid</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Bell item when an invoice receives full payment.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.inapp_invoice_paid}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, inapp_invoice_paid: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">In-App KYC & Compliance</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Status alerts regarding identity approvals or update requests.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.inapp_kyc_decision}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, inapp_kyc_decision: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>

              <div className="py-3.5 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">In-App Security Notices</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Dashboard alerts for 2FA, password, and session events.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.inapp_security_alerts}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, inapp_security_alerts: e.target.checked }))}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
              </div>
            </div>
          </Card>

          {/* SMS Notification Channel (Coming Soon) */}
          <Card title="SMS Notifications (Termii Gateway)">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">📱</span>
                  <h4 className="text-sm font-bold text-slate-900">Direct Mobile SMS Alerts</h4>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300 uppercase tracking-wider">
                    🚀 Coming Soon
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Direct SMS notifications for instant on-chain settlement receipts to your verified phone number (powered by Termii). 
                Once enabled globally, you can receive instant mobile SMS for high-value crypto transactions.
              </p>

              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 space-y-3 opacity-80">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-700">SMS on Payment Confirmed</span>
                    <p className="text-[11px] text-slate-400">Receive SMS text receipt when crypto settles.</p>
                  </div>
                  <input
                    type="checkbox"
                    disabled
                    checked={false}
                    className="h-4 w-4 rounded border-slate-300 text-slate-400 cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Save Preferences Button */}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={notifSaving}>
              Save Notification Preferences
            </Button>
          </div>
        </form>
      )}

      {/* ─── Tab: Subscription & Tiered Plans ──────────────────────────────── */}
      {activeTab === 'billing' && (
        <div className="space-y-6">
          {subSuccess && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🎉</span>
                <span className="font-semibold">{subSuccess}</span>
              </div>
              <button
                type="button"
                onClick={() => setSubSuccess(null)}
                className="text-xs text-emerald-700 font-bold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {subError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-center gap-2">
              <span>⚠️</span>
              <span>{subError}</span>
            </div>
          )}

          {/* Current Subscription Status & Usage Meter */}
          <Card title="Current Subscription & Monthly Usage">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1">
                <p className="text-xs text-slate-500 font-medium">Active Plan</p>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-slate-900 uppercase">
                    {subscription?.tier_name || subscription?.tier || 'Starter Free'}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    Active
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {subscription?.period ? `Billed ${subscription.period}` : 'No credit card required'}
                </p>
              </div>

              {/* Transaction Usage Meter */}
              <div className="md:col-span-2 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-700">Monthly Transaction Volume Cap</span>
                  <span className="font-mono font-bold text-slate-900">
                    {subscription?.monthly_tx_count ?? 0} / {subscription?.monthly_tx_cap ?? 50} txs
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3.5 overflow-hidden border border-slate-200">
                  <div
                    className="bg-slate-900 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(((subscription?.monthly_tx_count ?? 0) / (subscription?.monthly_tx_cap || 50)) * 100)
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Resets on the 1st of every month. Upgrade your plan anytime for higher capacity and priority RPC indexing.
                </p>
              </div>
            </div>
          </Card>

          {/* Billing Cycle Switcher */}
          <div className="flex items-center justify-center gap-3">
            <span className={`text-xs font-semibold ${billingPeriod === 'monthly' ? 'text-slate-900 font-bold' : 'text-slate-500'}`}>
              Monthly Billing
            </span>
            <button
              type="button"
              onClick={() => setBillingPeriod((p) => (p === 'monthly' ? 'yearly' : 'monthly'))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                billingPeriod === 'yearly' ? 'bg-slate-900' : 'bg-slate-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  billingPeriod === 'yearly' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-xs font-semibold flex items-center gap-1.5 ${billingPeriod === 'yearly' ? 'text-slate-900 font-bold' : 'text-slate-500'}`}>
              <span>Annual Billing</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                Save ~17%
              </span>
            </span>
          </div>

          {/* Tier Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {SUBSCRIPTION_PLANS.map((plan) => {
              const isCurrent = subscription?.tier === plan.tier
              const price = billingPeriod === 'yearly' ? plan.priceYearly : plan.priceMonthly
              const isBusy = upgradingTier === plan.tier

              return (
                <div
                  key={plan.tier}
                  className={`rounded-2xl border p-6 flex flex-col justify-between transition-all ${
                    plan.highlight
                      ? 'border-slate-900 bg-slate-900/5 shadow-md ring-1 ring-slate-900'
                      : 'border-slate-200 bg-white shadow-xs'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-black text-slate-900">{plan.name}</h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                        {plan.badge}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed min-h-[36px]">
                      {plan.description}
                    </p>

                    <div className="pt-2 border-t border-slate-100">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900">
                          ${price}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          /{billingPeriod === 'yearly' ? 'yr' : 'mo'}
                        </span>
                      </div>
                    </div>

                    <ul className="space-y-2.5 pt-2 text-xs text-slate-600">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-emerald-600 font-bold shrink-0">✓</span>
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-6">
                    {isCurrent ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled
                        className="w-full bg-slate-100 font-bold text-slate-600"
                      >
                        ✓ Current Active Plan
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant={plan.highlight ? 'primary' : 'secondary'}
                        size="sm"
                        loading={isBusy}
                        onClick={() => handleOpenCryptoUpgrade(plan)}
                        className="w-full"
                      >
                        {plan.tier === 'free' ? 'Downgrade to Free' : `Upgrade to ${plan.name} (Crypto)`}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ─── Subscription & Crypto Upgrade Audit History ─────────────── */}
          <Card title="Subscription & Upgrade Payment History">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    <th className="py-3 px-4">Plan</th>
                    <th className="py-3 px-4">Amount Due</th>
                    <th className="py-3 px-4">Network & Token</th>
                    <th className="py-3 px-4">Assigned Treasury Wallet</th>
                    <th className="py-3 px-4">Tx Hash</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Date</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyLoading ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">
                        Loading payment history...
                      </td>
                    </tr>
                  ) : paymentHistory.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">
                        No previous subscription payments recorded. Upgrade to a paid plan to get started.
                      </td>
                    </tr>
                  ) : (
                    paymentHistory.map((item) => {
                      const isPending = item.status === 'pending' && !item.is_expired
                      const isConfirmed = item.status === 'confirmed'
                      const isUnderpaid = item.status === 'underpaid'
                      const isFailed = item.status === 'failed' || item.is_expired

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/60 font-sans">
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {item.tier_name || item.tier} ({item.period})
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-800">
                            {item.crypto_amount} {item.crypto_token}{' '}
                            <span className="text-slate-400 font-normal">(${item.usd_amount} USD)</span>
                          </td>
                          <td className="py-3 px-4 capitalize text-slate-600 font-medium">
                            {item.crypto_network} ({item.crypto_token})
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                            {item.assigned_wallet_address.slice(0, 6)}...{item.assigned_wallet_address.slice(-4)}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px]">
                            {item.tx_hash ? (
                              <span className="text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {item.tx_hash.slice(0, 8)}...
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {isConfirmed && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                ✓ Confirmed
                              </span>
                            )}
                            {isPending && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                ⏱ Pending ({Math.ceil(item.time_remaining_seconds / 60)}m left)
                              </span>
                            )}
                            {isUnderpaid && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">
                                ⚠️ Underpaid ({item.amount_received})
                              </span>
                            )}
                            {isFailed && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                Expired / Failed
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-500 font-mono text-[11px]">
                            {new Date(item.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {isPending && (
                              <button
                                type="button"
                                onClick={() => handleResumePendingPayment(item)}
                                className="inline-flex items-center rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                              >
                                Continue Payment &rarr;
                              </button>
                            )}
                            {isUnderpaid && (
                              <button
                                type="button"
                                onClick={() => handleResumePendingPayment(item)}
                                className="inline-flex items-center rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
                              >
                                Balance Up &rarr;
                              </button>
                            )}
                            {isFailed && (
                              <button
                                type="button"
                                onClick={() => {
                                  const plan = SUBSCRIPTION_PLANS.find((p) => p.tier === item.tier) || SUBSCRIPTION_PLANS[1]
                                  handleOpenCryptoUpgrade(plan)
                                }}
                                className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
                              >
                                Retry Upgrade
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Tab: Security & 2FA ────────────────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <Card title="Security & Authentication">
            <div className="space-y-6">
              {/* Password Management */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Account Password</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ensure your account uses a strong password with a combination of uppercase, lowercase, and numbers.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPwError(null)
                    setPwSuccess(null)
                    setIsPasswordModalOpen(true)
                  }}
                >
                  Change password
                </Button>
              </div>

              {/* Two-Factor Authentication (2FA) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">Two-Factor Authentication (2FA / TOTP)</h3>
                    {profile?.two_factor_enabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Protected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Not Configured
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 max-w-xl">
                    Add an extra layer of security to your account using authenticator apps like Google Authenticator, Authy, Microsoft Authenticator, or 1Password.
                  </p>
                </div>
                <div>
                  {profile?.two_factor_enabled ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDisableError(null)
                        setDisablePassword('')
                        setDisableCode('')
                        setIs2FADisableModalOpen(true)
                      }}
                      className="border-red-200 text-red-600 hover:bg-red-50"
                    >
                      Disable 2FA
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={open2FASetup}
                    >
                      Enable 2FA
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Tab: Store Branding & Customizer (Merchants Only) ──────────────── */}
      {activeTab === 'branding' && user?.account_type === 'merchant' && (
        <form onSubmit={handleSaveBranding} className="space-y-6">
          {brandingSuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 text-xs text-emerald-800 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2">
                <span className="text-base">🎉</span>
                <span className="font-semibold">{brandingSuccess}</span>
              </div>
              <button
                type="button"
                onClick={() => setBrandingSuccess(null)}
                className="text-emerald-700 font-bold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {brandingError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 shadow-xs flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>{brandingError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            {/* Left Column: Branding Controls */}
            <div className="xl:col-span-7 space-y-6">
              {/* Card 1: Brand Identity */}
              <Card title="Brand Visual Identity">
                <div className="space-y-6">
                  {/* Logo Upload Section */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                      Store Brand Logo
                    </label>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-4 rounded-xl border border-slate-200/80 bg-slate-50/50">
                      {branding.brand_logo_url && !logoLoadError ? (
                        <div className="relative group">
                          <img
                            src={branding.brand_logo_url}
                            alt="Store Logo"
                            onError={() => setLogoLoadError(true)}
                            className="h-20 w-20 rounded-2xl object-cover border-2 border-white shadow-md bg-white"
                          />
                        </div>
                      ) : (
                        <div
                          className="flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-md transition-colors"
                          style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                        >
                          {(branding.business_name || profile?.full_name || 'Store').slice(0, 2).toUpperCase()}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 shadow-xs hover:bg-slate-50 transition-colors">
                            <span>📁 {logoUploading ? 'Uploading...' : 'Upload Logo'}</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/svg+xml"
                              onChange={handleLogoUpload}
                              disabled={logoUploading}
                              className="hidden"
                            />
                          </label>
                          {branding.brand_logo_url && (
                            <button
                              type="button"
                              onClick={() => setBranding((prev) => ({ ...prev, brand_logo_url: null }))}
                              className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                            >
                              Remove Logo
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Recommended: Square PNG, SVG, or JPG (min. 256×256px, max 5MB).
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Brand Accent Color */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                        Brand Accent Color
                      </label>
                      <span className="text-xs font-mono font-bold text-slate-600 uppercase">
                        {branding.brand_color}
                      </span>
                    </div>

                    {/* Preset Swatches */}
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5 mb-3">
                      {PRESET_COLORS.map((c) => {
                        const isSelected = branding.brand_color.toLowerCase() === c.hex.toLowerCase()
                        return (
                          <button
                            key={c.hex}
                            type="button"
                            onClick={() => setBranding((prev) => ({ ...prev, brand_color: c.hex }))}
                            title={`${c.name} (${c.hex})`}
                            className={`group relative flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all ${
                              isSelected
                                ? 'border-slate-900 bg-slate-100/80 shadow-xs'
                                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className="h-6 w-6 rounded-full shadow-xs flex items-center justify-center text-white text-[10px]"
                              style={{ backgroundColor: c.hex }}
                            >
                              {isSelected && '✓'}
                            </span>
                            <span className="text-[9px] font-medium text-slate-500 mt-1 truncate max-w-[50px]">
                              {c.name}
                            </span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Custom Color Input */}
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                      <input
                        type="color"
                        value={branding.brand_color}
                        onChange={(e) => setBranding((prev) => ({ ...prev, brand_color: e.target.value }))}
                        className="h-9 w-10 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-0.5"
                      />
                      <div className="flex-1">
                        <label className="text-[10px] font-bold uppercase text-slate-500 block">Custom Hex Code</label>
                        <input
                          type="text"
                          maxLength={7}
                          value={branding.brand_color}
                          onChange={(e) => setBranding((prev) => ({ ...prev, brand_color: e.target.value }))}
                          className="block w-full font-mono text-xs text-slate-900 uppercase bg-transparent focus:outline-none font-bold"
                          placeholder="#0052FF"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Brand Tagline */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                      Store Tagline / Slogan
                    </label>
                    <input
                      type="text"
                      maxLength={180}
                      placeholder="e.g. Next-generation decentralized infrastructure & consulting"
                      value={branding.brand_tagline || ''}
                      onChange={(e) => setBranding((prev) => ({ ...prev, brand_tagline: e.target.value }))}
                      className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-xs"
                    />
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Shown under your store name at top of checkout to introduce your brand to shoppers.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Card 2: Support & Contact Channels */}
              <Card title="Customer Support & Trust Channels">
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    Provide customer support contact info displayed on your checkout pages and receipts for direct assistance.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                        Customer Support Email
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-2.5 text-slate-400 text-xs">✉️</span>
                        <input
                          type="email"
                          placeholder="support@yourbrand.com"
                          value={branding.support_email || ''}
                          onChange={(e) => setBranding((prev) => ({ ...prev, support_email: e.target.value }))}
                          className="block w-full rounded-xl border border-slate-300 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                        Support Phone / WhatsApp
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-2.5 text-slate-400 text-xs">📞</span>
                        <input
                          type="tel"
                          placeholder="+1 (555) 000-1234"
                          value={branding.support_phone || ''}
                          onChange={(e) => setBranding((prev) => ({ ...prev, support_phone: e.target.value }))}
                          className="block w-full rounded-xl border border-slate-300 pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Save Button */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
                <p className="text-xs text-slate-500">
                  Changes reflect in real-time on all active payment links and checkout sessions.
                </p>
                <Button type="submit" variant="primary" loading={brandingSaving}>
                  Save Branding Changes
                </Button>
              </div>
            </div>

            {/* Right Column: Sticky Live Checkout Simulator */}
            <div className="xl:col-span-5 sticky top-6 space-y-3">
              {/* Simulator Card Header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span
                      className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                      style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                    />
                    <span
                      className="relative inline-flex rounded-full h-2.5 w-2.5"
                      style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                    />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Live Checkout Simulator
                  </span>
                </div>

                {/* View Switcher */}
                <div className="flex items-center bg-slate-200/70 p-1 rounded-lg text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('checkout')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      previewMode === 'checkout'
                        ? 'bg-white text-slate-900 shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    💳 Pay Screen
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('receipt')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      previewMode === 'receipt'
                        ? 'bg-white text-slate-900 shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🧾 Receipt Screen
                  </button>
                </div>
              </div>

              {/* Simulated Browser Frame */}
              <div className="rounded-2xl border border-slate-300 bg-slate-900/5 p-1.5 shadow-lg">
                {/* Browser Top Bar */}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-800 text-white rounded-t-xl text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[10px] text-slate-300 bg-slate-900/80 px-3 py-0.5 rounded-md border border-slate-700">
                    <span>🔒</span>
                    <span>pay.lenis.io/pay/store-preview</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">100%</span>
                </div>

                {/* Browser Body Screen */}
                <div className="bg-slate-50 p-4 sm:p-5 rounded-b-xl min-h-[460px] flex flex-col justify-between">
                  {previewMode === 'checkout' ? (
                    /* Checkout View Preview */
                    <div className="space-y-4">
                      {/* Store Brand Banner */}
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {branding.brand_logo_url && !logoLoadError ? (
                              <img
                                src={branding.brand_logo_url}
                                alt="Brand Logo"
                                onError={() => setLogoLoadError(true)}
                                className="h-11 w-11 rounded-xl object-cover border border-slate-200 bg-white shadow-xs"
                              />
                            ) : (
                              <div
                                className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold text-white shadow-xs"
                                style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                              >
                                {(branding.business_name || profile?.full_name || 'Store').slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-sm font-bold text-slate-900">
                                  {branding.business_name || profile?.full_name || 'Your Brand Name'}
                                </h4>
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  ✓ Verified
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                                {branding.brand_tagline || 'Web3 software, tools & decentralized services'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {(branding.support_email || branding.support_phone) && (
                          <div className="mt-3 flex flex-wrap gap-2.5 pt-2.5 border-t border-slate-100 text-[10px] text-slate-500">
                            {branding.support_email && (
                              <span className="flex items-center gap-1">✉️ {branding.support_email}</span>
                            )}
                            {branding.support_phone && (
                              <span className="flex items-center gap-1">📞 {branding.support_phone}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Order Amount Card */}
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Due</p>
                            <p className="text-xl font-extrabold text-slate-900">$250.00 <span className="text-xs font-normal text-slate-500">USD</span></p>
                          </div>
                          <span
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white"
                            style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                          >
                            250.00 USDC
                          </span>
                        </div>

                        {/* Network selector demo */}
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Selected Network</p>
                          <div className="flex gap-2">
                            <span
                              className="px-2.5 py-1 rounded-md text-xs font-bold border"
                              style={{
                                borderColor: branding.brand_color || '#0052FF',
                                color: branding.brand_color || '#0052FF',
                                backgroundColor: `${branding.brand_color || '#0052FF'}10`,
                              }}
                            >
                              🔵 Base
                            </span>
                            <span className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 text-slate-400">
                              🟣 Polygon
                            </span>
                            <span className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 text-slate-400">
                              🔷 Arbitrum
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Pay Button Preview */}
                      <button
                        type="button"
                        disabled
                        className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white shadow-md flex items-center justify-center gap-2 cursor-default"
                        style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                      >
                        <span>Connect Wallet & Pay 250.00 USDC</span>
                        <span>→</span>
                      </button>
                    </div>
                  ) : (
                    /* Receipt View Preview */
                    <div className="space-y-4 text-center py-2">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600 shadow-xs">
                        ✓
                      </div>

                      <div>
                        <h4 className="text-base font-bold text-slate-900">Payment Confirmed!</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Paid 250.00 USDC to {branding.business_name || profile?.full_name || 'Merchant'}
                        </p>
                      </div>

                      {/* Thank you note */}
                      <div
                        className="rounded-xl p-3.5 text-xs text-left border"
                        style={{
                          backgroundColor: `${branding.brand_color || '#0052FF'}08`,
                          borderColor: `${branding.brand_color || '#0052FF'}30`,
                        }}
                      >
                        <p className="font-bold text-slate-800 mb-0.5">Note from {branding.business_name || 'Store'}:</p>
                        <p className="text-slate-600">
                          “Thank you for your business! Your order is being processed and you will receive a confirmation email shortly.”
                        </p>
                      </div>

                      {/* Auto Redirect Countdown simulation */}
                      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs">
                        <div className="flex items-center justify-center gap-2 text-slate-500 font-medium">
                          <span className="inline-block animate-spin text-xs">⏳</span>
                          <span>Redirecting to merchant store in <strong className="text-slate-900 font-bold">5s</strong>...</span>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="w-full py-2 px-3 rounded-lg text-xs font-bold text-white shadow-xs cursor-default"
                          style={{ backgroundColor: branding.brand_color || '#0052FF' }}
                        >
                          Continue to Store Now →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Trust Footer */}
                  <div className="pt-4 border-t border-slate-200/80 text-center">
                    <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1 font-medium">
                      <span>🔒</span>
                      <span>Secured by <strong>Lenis Financial Infrastructure</strong></span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ─── Tab: Payout Wallets ────────────────────────────────────────────── */}
      {activeTab === 'wallets' && (
        <Card title="Payout Wallets">
          <p className="mb-4 text-sm text-slate-600">
            Manage the wallet addresses that receive your crypto payments.
            You must have at least one active wallet to create payment links or invoices.
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/dashboard/wallets')}
          >
            Manage Wallets →
          </Button>
        </Card>
      )}

      {/* ─── Modal: Phone / Contact OTP Verification (Termii API) ───────────── */}
      <Modal
        isOpen={isPhoneModalOpen}
        onClose={() => setIsPhoneModalOpen(false)}
        title="Verify Contact Number"
      >
        {phoneStep === 'enter_phone' ? (
          <form onSubmit={handleSendPhoneOtp} className="space-y-4">
            <p className="text-xs text-slate-600">
              Your contact number is used to receive security alerts and OTP verification notices. You can update your number below.
            </p>

            {phoneError && (
              <div className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700">
                {phoneError}
              </div>
            )}

            <Input
              label="Primary Contact / Mobile Phone"
              type="tel"
              id="phone-num-input"
              placeholder="+234 801 234 5678 or 08012345678"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              required
              helperText="Once verified via Termii SMS, this will be your primary verified contact number."
            />

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsPhoneModalOpen(false)}
                disabled={phoneLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={phoneLoading}
              >
                Send Verification OTP
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
            {phoneSuccess && (
              <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {phoneSuccess}
              </div>
            )}

            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              We sent a 6-digit OTP code to <strong className="font-mono">{phoneInput}</strong>.
            </div>

            {phoneError && (
              <div className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700">
                {phoneError}
              </div>
            )}

            <Input
              label="Enter 6-Digit OTP Code"
              type="text"
              id="otp-code-input"
              placeholder="e.g. 583921"
              maxLength={6}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
              required
              className="font-mono text-center text-lg tracking-widest"
              helperText="Valid for 10 minutes."
            />

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setPhoneStep('enter_phone')}
                className="text-xs text-slate-500 hover:text-slate-800 underline"
              >
                Change Phone Number
              </button>

              <button
                type="button"
                disabled={resendTimer > 0 || phoneLoading}
                onClick={() => handleSendPhoneOtp()}
                className={`text-xs font-semibold ${
                  resendTimer > 0 ? 'text-slate-400 cursor-not-allowed' : 'text-slate-900 hover:underline'
                }`}
              >
                {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
              </button>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsPhoneModalOpen(false)}
                disabled={phoneLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={phoneLoading}
                disabled={otpInput.trim().length !== 6}
              >
                Verify & Save
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ─── Modal: Didit Automated KYC Verification ────────────────────────── */}
      <Modal
        isOpen={isDiditModalOpen}
        onClose={() => setIsDiditModalOpen(false)}
        title="Automated Identity Verification (Didit)"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Verify your government-issued ID and selfie scan automatically via the Didit AI verification service.
          </p>

          {diditError && (
            <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
              {diditError}
            </div>
          )}

          {diditStatusMsg && (
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              {diditStatusMsg}
            </div>
          )}

          {diditSessionUrl && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <p className="text-xs font-bold text-slate-800">Didit Session Link</p>
              <a
                href={diditSessionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs font-bold text-blue-600 underline"
              >
                Click here if verification window did not open automatically ↗
              </a>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsDiditModalOpen(false)}
              disabled={diditLoading || diditCheckLoading}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={diditCheckLoading}
              onClick={handleCheckDiditKYC}
            >
              I Have Completed Verification (Confirm)
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Modal: Change Password ────────────────────────────────────────────── */}
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        title="Change Account Password"
      >
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <p className="text-xs text-slate-500">
            For security, please enter your current password followed by your new password. An email notification will be sent upon change.
          </p>

          {pwError && (
            <div className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700">
              {pwError}
            </div>
          )}

          {pwSuccess && (
            <div className="rounded-md bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
              {pwSuccess}
            </div>
          )}

          <Input
            label="Current Password"
            type="password"
            id="curr-pw"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          <Input
            label="New Password"
            type="password"
            id="new-pw"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            helperText="Minimum 8 characters with at least one uppercase, one lowercase, and one number."
          />

          <Input
            label="Confirm New Password"
            type="password"
            id="confirm-pw"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsPasswordModalOpen(false)}
              disabled={pwLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={pwLoading}
            >
              Update Password
            </Button>
          </div>
        </form>
      </Modal>

      {/* ─── Modal: Setup 2FA ─────────────────────────────────────────────────── */}
      <Modal
        isOpen={is2FASetupModalOpen}
        onClose={() => setIs2FASetupModalOpen(false)}
        title="Enable Two-Factor Authentication"
      >
        <form onSubmit={handleEnable2FA} className="space-y-5">
          <p className="text-xs text-slate-500">
            Scan this QR code with your authenticator app (such as Google Authenticator, Authy, or 1Password) or copy the secret key manually.
          </p>

          {setupError && (
            <div className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700">
              {setupError}
            </div>
          )}

          {setupLoading && !setupData ? (
            <div className="flex justify-center p-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          ) : setupData ? (
            <div className="space-y-4">
              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                <img
                  src={setupData.qr_code_data_url}
                  alt="2FA QR Code"
                  className="h-44 w-44 rounded-lg bg-white p-2 shadow-sm"
                />
                <span className="mt-2 text-[11px] font-semibold text-slate-500">
                  Scan using Authenticator App
                </span>
              </div>

              {/* Manual Secret Key */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Manual Entry Key (Secret)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={setupData.secret}
                    className="w-full font-mono text-xs bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 select-all"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={copySecretToClipboard}
                    className="shrink-0 text-xs"
                  >
                    {copiedSecret ? '✓ Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              {/* 6-digit Code Input */}
              <div className="pt-2">
                <Input
                  label="Enter 6-Digit Authenticator Code"
                  type="text"
                  id="totp-code"
                  placeholder="e.g. 123456"
                  maxLength={6}
                  value={setupCode}
                  onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ''))}
                  required
                  className="font-mono text-center text-lg tracking-widest"
                  helperText="Enter the 6-digit code shown in your authenticator app to verify setup."
                />
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIs2FASetupModalOpen(false)}
              disabled={setupLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={setupLoading}
              disabled={!setupData || setupCode.length !== 6}
            >
              Verify & Activate 2FA
            </Button>
          </div>
        </form>
      </Modal>

      {/* ─── Modal: Disable 2FA ──────────────────────────────────────────────── */}
      <Modal
        isOpen={is2FADisableModalOpen}
        onClose={() => setIs2FADisableModalOpen(false)}
        title="Disable Two-Factor Authentication"
      >
        <form onSubmit={handleDisable2FA} className="space-y-4">
          <p className="text-xs text-slate-600">
            Disabling 2FA will lower your account security. Please enter your account password to confirm.
          </p>

          {disableError && (
            <div className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700">
              {disableError}
            </div>
          )}

          <Input
            label="Account Password"
            type="password"
            id="disable-pw"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          <Input
            label="Authenticator Code (Optional)"
            type="text"
            id="disable-code"
            placeholder="6-digit code (optional)"
            maxLength={6}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
            className="font-mono"
          />

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIs2FADisableModalOpen(false)}
              disabled={disableLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={disableLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              Confirm Deactivation
            </Button>
          </div>
        </form>
      </Modal>

      {/* ─── Modal: Crypto Subscription Checkout ────────────────────────────── */}
      {isCryptoModalOpen && selectedPlanForUpgrade && (
        <Modal
          isOpen={isCryptoModalOpen}
          onClose={() => {
            setIsCryptoModalOpen(false)
            fetchPaymentHistory()
          }}
          title={
            checkoutStep === 'success'
              ? '🎉 Payment Confirmed'
              : checkoutStep === 'pay_and_detect'
              ? `Pay ${cryptoIntent?.crypto_amount || ''} ${cryptoIntent?.crypto_token || ''}`
              : `Upgrade to ${selectedPlanForUpgrade.name}`
          }
        >
          <div className="space-y-4">
            {/* Header Plan Pill */}
            <div className="rounded-xl bg-slate-900 text-white p-4 flex items-center justify-between shadow-xs">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target Plan</p>
                <h4 className="text-base font-bold text-white">{selectedPlanForUpgrade.name}</h4>
                <p className="text-xs text-slate-300">
                  {billingPeriod === 'yearly' ? 'Annual billing (~17% discount applied)' : 'Monthly billing'}
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-emerald-400">
                  ${billingPeriod === 'yearly' ? selectedPlanForUpgrade.priceYearly : selectedPlanForUpgrade.priceMonthly}
                </span>
                <span className="text-xs text-slate-400">/{billingPeriod === 'yearly' ? 'yr' : 'mo'}</span>
              </div>
            </div>

            {/* ─── STEP 1: Select Chain & Token ─────────────────────────────── */}
            {checkoutStep === 'select_chain' && (
              <div className="space-y-4 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">1. Choose EVM Network</label>
                    <select
                      value={cryptoNetwork}
                      onChange={(e) => setCryptoNetwork(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      <option value="base">Base</option>
                      <option value="polygon">Polygon</option>
                      <option value="arbitrum">Arbitrum One</option>
                      <option value="ethereum">Ethereum Mainnet</option>
                      <option value="bsc">BNB Smart Chain</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">2. Choose Crypto Token</label>
                    <select
                      value={cryptoToken}
                      onChange={(e) => setCryptoToken(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      <option value="USDC">USDC (USD Coin)</option>
                      <option value="USDT">USDT (Tether USD)</option>
                      <option value="ETH">ETH (Ethereum)</option>
                      <option value="POL">POL / MATIC (Polygon)</option>
                      <option value="BNB">BNB (Binance Coin)</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-600 space-y-1.5">
                  <div className="flex justify-between font-medium">
                    <span>Selected Token:</span>
                    <strong className="text-slate-900 font-bold">{cryptoToken}</strong>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Selected Network:</span>
                    <strong className="text-slate-900 font-bold capitalize">{cryptoNetwork}</strong>
                  </div>
                  <p className="text-[11px] text-slate-500 pt-1">
                    ⚡ Instant on-chain verification with load-balanced treasury routing.
                  </p>
                </div>

                {cryptoModalError && (
                  <p className="rounded-md bg-red-50 p-2.5 text-xs text-red-700">{cryptoModalError}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setIsCryptoModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={intentLoading}
                    onClick={() => fetchCryptoIntent(selectedPlanForUpgrade.tier, billingPeriod, cryptoToken, cryptoNetwork)}
                  >
                    Proceed to Payment &rarr;
                  </Button>
                </div>
              </div>
            )}

            {/* ─── STEP 2: Pay & Auto-Detect (QR Code + Poller) ────────────────── */}
            {checkoutStep === 'pay_and_detect' && cryptoIntent && (
              <div className="space-y-4">
                {/* Underpaid warning banner */}
                {underpaidWarning && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900 space-y-1">
                    <p className="font-bold flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>Partial Payment Received</span>
                    </p>
                    <p>
                      We detected an incoming transfer of <strong>{underpaidWarning.received} {cryptoIntent.crypto_token}</strong>. Please transfer the remaining balance of <strong>{underpaidWarning.remaining} {cryptoIntent.crypto_token}</strong> to complete your activation.
                    </p>
                  </div>
                )}

                {/* Amount Due and Timer */}
                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <div>
                    <p className="text-[11px] text-slate-500 font-medium">Exact Amount Due:</p>
                    <p className="text-lg font-black text-slate-900">
                      {cryptoIntent.crypto_amount} {cryptoIntent.crypto_token}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500 font-medium">Lock Window:</p>
                    <span className="font-mono text-xs font-extrabold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      ⏱ {Math.floor(countdownSeconds / 60)}:{String(countdownSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>
                </div>

                {/* QR Code & Address Display */}
                <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-white">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-xs mb-3">
                    <QRCodeSVG
                      value={cryptoIntent.assigned_wallet_address}
                      size={160}
                      level="M"
                      includeMargin={false}
                    />
                  </div>

                  <div className="w-full space-y-1 text-center">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                      <span>Assigned Treasury Address ({cryptoIntent.crypto_network.toUpperCase()}):</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(cryptoIntent.assigned_wallet_address)
                          setCopiedWallet(true)
                          setTimeout(() => setCopiedWallet(false), 2000)
                        }}
                        className="font-bold text-indigo-600 hover:text-indigo-800"
                      >
                        {copiedWallet ? '✓ Copied!' : 'Copy Address'}
                      </button>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 font-mono text-xs text-slate-900 break-all select-all">
                      {cryptoIntent.assigned_wallet_address}
                    </div>
                  </div>
                </div>

                {/* Polling Liveness Status Indicator */}
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 flex items-center gap-3">
                  <div className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-600"></span>
                  </div>
                  <div className="text-xs text-indigo-950">
                    <p className="font-bold">Awaiting On-Chain Transfer...</p>
                    <p className="text-[11px] text-indigo-800">
                      Scan or send funds. We are monitoring this address and will activate your plan automatically upon confirmation.
                    </p>
                  </div>
                </div>

                {/* Optional Manual Tx Hash Toggle */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowManualTxInput((v) => !v)}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
                  >
                    {showManualTxInput ? 'Hide manual tx hash entry' : 'Already sent? Enter Tx Hash manually &rarr;'}
                  </button>

                  {showManualTxInput && (
                    <form onSubmit={handleConfirmCryptoPayment} className="space-y-3 pt-3">
                      <Input
                        label="Transaction Hash"
                        placeholder="0x..."
                        value={txHashInput}
                        onChange={(e) => setTxHashInput(e.target.value)}
                        required
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        loading={verifyingTx}
                        disabled={!txHashInput.trim()}
                        className="w-full"
                      >
                        Verify Hash Manually
                      </Button>
                    </form>
                  )}
                </div>

                {cryptoModalError && (
                  <p className="rounded-md bg-red-50 p-2.5 text-xs text-red-700">{cryptoModalError}</p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setCheckoutStep('select_chain')}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    &larr; Change Chain/Token
                  </button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setIsCryptoModalOpen(false)
                      fetchPaymentHistory()
                    }}
                  >
                    Close (Runs in Background)
                  </Button>
                </div>
              </div>
            )}

            {/* ─── STEP 3: Payment Confirmed Success Screen ──────────────────── */}
            {checkoutStep === 'success' && (
              <div className="space-y-4 text-center py-2">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl shadow-xs">
                  ✓
                </div>

                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    Plan Upgrade Confirmed!
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 max-w-sm mx-auto">
                    Your payment of <strong>{cryptoIntent?.crypto_amount} {cryptoIntent?.crypto_token}</strong> was confirmed on-chain. Your account has been upgraded to <strong>{selectedPlanForUpgrade.name}</strong>.
                  </p>
                </div>

                {confirmedTxHash && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Transaction Hash</p>
                    <p className="font-mono text-xs text-slate-800 break-all select-all font-semibold">
                      {confirmedTxHash}
                    </p>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    className="w-full"
                    onClick={() => {
                      setIsCryptoModalOpen(false)
                      fetchPaymentHistory()
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

    </div>
  )
}

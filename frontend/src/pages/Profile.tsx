import { useState, useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { orchestratorApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import PageHeader from '@/components/PageHeader'
import {
  ShieldCheck, User, Copy, Check, Eye, EyeOff,
  KeyRound, Smartphone, RefreshCw, X, Timer,
} from 'lucide-react'
import { cn } from '@/lib/cn'

// ─── Shared components ───────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="text-[var(--color-text-muted)] hover:text-teal-600 transition-colors p-1 rounded"
      title="Copy"
    >
      {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
    </button>
  )
}

function MaskedField({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">{label}</label>
      <div className="flex items-center gap-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2">
        <span className="flex-1 font-mono text-sm text-[var(--color-text-main)] break-all">
          {visible ? value : '•'.repeat(Math.min(value.length, 32))}
        </span>
        <button
          onClick={() => setVisible(v => !v)}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] p-1 rounded"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

// ─── QR Mobile Login ─────────────────────────────────────────────────────────

const QR_TTL = 300  // seconds, must match backend

function MobileLoginQr() {
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Default to current origin; user can override with LAN IP if accessing via localhost
  const [serverUrl, setServerUrl] = useState(window.location.origin)

  async function generateQr() {
    setLoading(true)
    setError(null)
    setQrToken(null)
    try {
      const res = await orchestratorApi.post('/auth/qr-token')
      setQrToken(res.data.token)
      setSecondsLeft(QR_TTL)
    } catch {
      setError('Failed to generate QR code')
    } finally {
      setLoading(false)
    }
  }

  // Countdown timer
  useEffect(() => {
    if (!qrToken) return
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(timerRef.current!)
          setQrToken(null)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [qrToken])

  // QR encodes: {"v":1,"url":"http://192.168.x.x:5173","t":"uuid"}
  const qrPayload = qrToken
    ? JSON.stringify({ v: 1, url: serverUrl.replace(/\/$/, ''), t: qrToken })
    : ''

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const expired = qrToken === null && secondsLeft === 0

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Smartphone size={16} className="text-teal-600" />
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">Mobile Login</h3>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Scan this QR code with the haidoc Android app to log in instantly.
        Token valid for 5 minutes and can only be used once.
      </p>

      {/* Server URL — always shown so user can fix localhost → LAN IP */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
          Server URL <span className="text-[var(--color-text-muted)] font-normal">(must be reachable from phone)</span>
        </label>
        <input
          type="text"
          value={serverUrl}
          onChange={e => { setServerUrl(e.target.value); setQrToken(null) }}
          placeholder="http://192.168.1.x:5173"
          className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
        />
        {serverUrl.includes('localhost') && (
          <p className="text-xs text-amber-600 mt-1">
            ⚠ "localhost" won't work on mobile — replace with your LAN IP (e.g. 192.168.1.x:5173)
          </p>
        )}
      </div>

      {!qrToken && (
        <button
          onClick={generateQr}
          disabled={loading || !serverUrl}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <Smartphone size={15} />
          )}
          {loading ? 'Generating…' : 'Show Mobile QR'}
        </button>
      )}

      {error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
          <X size={13} /> {error}
        </div>
      )}

      {qrToken && (
        <div className="space-y-4">
          {/* QR code */}
          <div className="flex flex-col items-center gap-3 p-5 bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)]">
            <QRCodeSVG
              value={qrPayload}
              size={200}
              level="M"
              className="rounded-lg"
            />
            {/* Countdown */}
            <div className={cn(
              'flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full',
              secondsLeft < 60
                ? 'bg-red-50 text-red-600'
                : 'bg-teal-50 text-teal-700',
            )}>
              <Timer size={11} />
              Expires in {mins}:{secs.toString().padStart(2, '0')}
            </div>
          </div>

          <p className="text-xs text-[var(--color-text-muted)] text-center">
            Server: <span className="font-mono text-[var(--color-text-main)]">{serverUrl}</span>
          </p>

          {/* Refresh + dismiss */}
          <div className="flex gap-2">
            <button
              onClick={generateQr}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] transition"
            >
              <RefreshCw size={12} /> Refresh QR
            </button>
            <button
              onClick={() => { setQrToken(null); setSecondsLeft(0) }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] transition"
            >
              <X size={12} /> Hide
            </button>
          </div>
        </div>
      )}

      {expired && !qrToken && !loading && secondsLeft === 0 && (
        <p className="mt-2 text-xs text-red-500">QR expired. Click above to generate a new one.</p>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

interface Credentials {
  client_id: string
  client_secret: string
}

export default function Profile() {
  const { user, token, role, isAdmin } = useAuth()
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [loadingCreds, setLoadingCreds] = useState(false)
  const [credsError, setCredsError] = useState<string | null>(null)

  async function fetchCredentials() {
    if (!token) return
    setLoadingCreds(true)
    setCredsError(null)
    try {
      const res = await orchestratorApi.post('/auth/client-credentials', { access_token: token })
      setCreds(res.data)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCredsError(detail ?? 'Failed to fetch credentials')
    } finally {
      setLoadingCreds(false)
    }
  }

  const username = (user?.username as string) ?? '—'
  const pageTitle = (role === 'admin' || role === 'superadmin') ? 'Admin Profile' : 'User Profile'

  return (
    <div className="max-w-lg space-y-5">
      <PageHeader title={pageTitle} />
      {/* Account info */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-4">Account</h3>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
            <User size={22} className="text-teal-700" />
          </div>
          <div>
            <div className="font-semibold text-[var(--color-text-main)]">{username}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                'flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                isAdmin ? 'bg-teal-100 text-teal-700' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)]',
              )}>
                {isAdmin && <ShieldCheck size={11} />}
                {role ?? 'user'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile QR login */}
      <MobileLoginQr />

      {/* API credentials */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} className="text-[var(--color-text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">API Credentials</h3>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          OAuth2 client credentials for programmatic API access.
        </p>

        {!creds && (
          <button
            onClick={fetchCredentials}
            disabled={loadingCreds}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {loadingCreds ? 'Loading…' : 'Reveal credentials'}
          </button>
        )}

        {credsError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mt-3">
            {credsError}
          </div>
        )}

        {creds && (
          <div className="space-y-3 mt-3">
            <MaskedField label="Client ID" value={creds.client_id} />
            <MaskedField label="Client Secret" value={creds.client_secret} />
            <p className="text-xs text-[var(--color-text-muted)]">Keep your client secret private.</p>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { orchestratorApi } from '@/lib/api'
import { Network, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react'

interface RoleOption {
  name: string
  label: string
  description?: string
}

const inputCls = "w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-main)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500/50 transition-all"
const labelCls = "block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-1.5 font-mono"

export default function Register() {
  const navigate = useNavigate()
  const [roles, setRoles] = useState<RoleOption[]>([
    { name: 'user', label: 'User', description: 'Standard user access.' },
    { name: 'admin', label: 'Admin', description: 'Administrative access (Requires Key).' }
  ])
  const [form, setForm] = useState({
    username: '', email: '', password: '', full_name: '', role: 'user', registration_key: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    orchestratorApi.get('/auth/roles')
      .then(res => {
        const data: RoleOption[] = res.data
        const merged = [...data]
        if (!merged.find(r => r.name === 'user')) {
          merged.push({ name: 'user', label: 'User', description: 'Standard user access.' })
        }
        if (!merged.find(r => r.name === 'admin')) {
          merged.push({ name: 'admin', label: 'Admin', description: 'Administrative access (Requires Key).' })
        }
        setRoles(merged)
        setForm(prev => {
          const defaultRole = merged.find(r => r.name === prev.role) ? prev.role : (merged[0]?.name || 'user')
          return { ...prev, role: defaultRole }
        })
      })
      .catch(() => { /* keep defaults */ })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await orchestratorApi.post('/auth/register', {
        username: form.username,
        email: form.email,
        password: form.password,
        full_name: form.full_name,
        role: form.role,
        registration_key: form.role === 'admin' ? form.registration_key : undefined,
      })
      setSuccess(true)
      setTimeout(() => navigate('/'), 2000)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-center space-y-4 p-8">
          <CheckCircle2 size={48} className="text-cyan-400 mx-auto" />
          <h2 className="text-xl font-bold text-[var(--color-text-main)] font-mono">Account created!</h2>
          <p className="text-[var(--color-text-muted)] text-sm">Redirecting to sign in...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)] overflow-hidden">
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-5/12 flex-col justify-between p-12 relative overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(135deg, #060A13 0%, #0A1628 60%, #060A13 100%)' }}
      >
        <div className="absolute inset-0 argus-grid-bg" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-80 h-80 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute -bottom-20 left-1/4 w-64 h-64 rounded-full bg-violet-500/4 blur-2xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-violet-950/80 border border-violet-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(129,140,248,0.12)]">
            <Network size={22} className="text-violet-400" />
          </div>
          <div>
            <span className="text-white font-black text-2xl tracking-tight font-mono">Civis</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[10px] font-bold text-violet-400/50 uppercase tracking-widest font-mono">Mission Control</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <div className="space-y-3">
            <div className="text-[10px] font-bold text-violet-400/40 uppercase tracking-widest border-l-2 border-violet-500/30 pl-3 font-mono">
              Join the platform
            </div>
            <h2 className="text-4xl font-black text-white leading-tight">
              Join the<br />
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(90deg, #818CF8 0%, #22D3EE 100%)' }}
              >
                agent network.
              </span>
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
              Access the multi-agent decision intelligence platform for epidemic containment policy synthesis.
            </p>
          </div>

          <div className="space-y-2.5">
            {[
              ['Parallel Agent Orchestration', '#22D3EE'],
              ['Conflict Resolution Engine', '#818CF8'],
              ['Real-time Policy Synthesis', '#10B981'],
            ].map(([item, color]) => (
              <div key={item} className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-slate-400 text-xs font-mono">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <span className="text-[10px] text-slate-700 font-mono">Civis v1.0 — Hackathon 2026</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto bg-[var(--color-bg)] flex items-start justify-center p-8">
        <div className="w-full max-w-md py-4">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/60 border border-cyan-500/20 flex items-center justify-center">
              <Network size={18} className="text-cyan-400" />
            </div>
            <span className="text-cyan-400 font-black text-xl font-mono tracking-tight">Civis</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-main)]">Create account</h1>
            <p className="text-[var(--color-text-muted)] text-sm mt-1">Fill in your details to get started</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Role</label>
              <select
                value={form.role}
                onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
                className={inputCls}
                required
              >
                {roles.map(r => (
                  <option key={r.name} value={r.name}>{r.label}</option>
                ))}
              </select>
              {roles.find(r => r.name === form.role)?.description && (
                <p className="text-xs text-[var(--color-text-muted)] mt-1 pl-1 font-mono">
                  {roles.find(r => r.name === form.role)?.description}
                </p>
              )}
            </div>

            {form.role === 'admin' && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                <label className={labelCls}>Registration Key</label>
                <input
                  type="password"
                  value={form.registration_key}
                  onChange={e => setForm(prev => ({ ...prev, registration_key: e.target.value }))}
                  placeholder="Enter secure admin registration key"
                  required
                  className={inputCls}
                />
              </div>
            )}

            <div>
              <label className={labelCls}>Full Name</label>
              <input
                type="text"
                value={form.full_name}
                onChange={e => setForm(prev => ({ ...prev, full_name: e.target.value }))}
                placeholder="Jane Smith"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="janesmith"
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="jane@example.com"
                  required
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Min. 8 characters"
                required
                minLength={8}
                className={inputCls}
              />
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 disabled:opacity-50 font-bold text-sm transition-all flex items-center justify-center gap-2 mt-2 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> Creating account...</>
                : <><span>Create Account</span><ArrowRight size={16} /></>
              }
            </button>
          </form>

          <p className="text-sm text-center text-[var(--color-text-muted)] mt-6">
            Already have an account?{' '}
            <Link to="/" className="text-cyan-400 hover:text-cyan-300 font-semibold">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { orchestratorApi } from '@/lib/api'
import { Stethoscope, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react'

interface RoleOption {
  name: string
  label: string
  description?: string
}

const inputCls = "w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-main)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all shadow-sm"
const labelCls = "block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5"

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
          <CheckCircle2 size={48} className="text-teal-600 mx-auto" />
          <h2 className="text-xl font-bold text-[var(--color-text-main)]">Account created!</h2>
          <p className="text-[var(--color-text-muted)] text-sm">Redirecting to sign in...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)] overflow-hidden">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 bg-[#134E4A] flex-col justify-between p-12 relative overflow-hidden shrink-0">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute top-1/2 -right-32 w-72 h-72 rounded-full bg-teal-400/10" />
        <div className="absolute -bottom-16 left-1/3 w-56 h-56 rounded-full bg-white/5" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-400/20 flex items-center justify-center">
            <Stethoscope size={22} className="text-teal-300" />
          </div>
          <span className="text-white font-bold text-2xl tracking-tight">civis</span>
        </div>

        <div className="relative z-10 space-y-4">
          <h2 className="text-4xl font-bold text-white leading-snug">
            Join the<br />clinical AI platform.
          </h2>
          <p className="text-teal-200/70 text-sm leading-relaxed max-w-xs">
            Get structured clinical outputs from audio or text — powered by state-of-the-art medical AI.
          </p>
        </div>

        <div className="relative z-10 space-y-3">
          {['Audio transcription + SOAP notes', 'Differential diagnosis support', 'Lab & medication suggestions'].map(item => (
            <div key={item} className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              <span className="text-teal-200/80 text-xs">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto bg-[var(--color-bg)] flex items-start justify-center p-8">
        <div className="w-full max-w-md py-4">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-[#134E4A] flex items-center justify-center">
              <Stethoscope size={18} className="text-teal-300" />
            </div>
            <span className="text-[#134E4A] dark:text-teal-300 font-bold text-xl">civis</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-main)]">Create account</h1>
            <p className="text-[var(--color-text-muted)] text-sm mt-1">Fill in your details to get started</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Role dropdown */}
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
                <p className="text-xs text-[var(--color-text-muted)] mt-1 pl-1">
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
                placeholder="Dr. Jane Smith"
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
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[#134E4A] text-white rounded-xl hover:bg-teal-800 disabled:opacity-50 font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-md shadow-teal-900/20 mt-2"
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> Creating account...</>
                : <><span>Create Account</span><ArrowRight size={16} /></>
              }
            </button>
          </form>

          <p className="text-sm text-center text-[var(--color-text-muted)] mt-6">
            Already have an account?{' '}
            <Link to="/" className="text-teal-700 hover:text-teal-800 font-semibold">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

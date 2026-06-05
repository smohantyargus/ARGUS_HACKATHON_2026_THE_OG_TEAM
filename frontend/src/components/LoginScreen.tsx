import { useState } from 'react'
import { Link } from 'react-router-dom'
import { orchestratorApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Stethoscope, ArrowRight, Loader2 } from 'lucide-react'

export default function LoginScreen() {
  const { loginWithToken } = useAuth()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await orchestratorApi.post('/auth/login', form)
      loginWithToken(res.data.access_token, res.data.refresh_token)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)] overflow-hidden">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#134E4A] flex-col justify-between p-12 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute top-1/2 -right-32 w-72 h-72 rounded-full bg-teal-400/10" />
        <div className="absolute -bottom-16 left-1/3 w-56 h-56 rounded-full bg-white/5" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/20 flex items-center justify-center">
              <Stethoscope size={22} className="text-teal-300" />
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">haidoc</span>
          </div>
        </div>

        <div className="relative z-10 space-y-4">
          <h2 className="text-4xl font-bold text-white leading-snug">
            Clinical AI,<br />built for clinicians.
          </h2>
          <p className="text-teal-200/70 text-sm leading-relaxed max-w-xs">
            SOAP notes, differential diagnoses, lab suggestions and medication recommendations — powered by Claude and Gemini.
          </p>
        </div>

        <div className="relative z-10 flex gap-6">
          {[['SOAP Notes', 'Structured documentation'], ['Differentials', 'Evidence-ranked'], ['Reasoning', 'Claude-powered']].map(([title, sub]) => (
            <div key={title}>
              <div className="text-teal-300 text-sm font-semibold">{title}</div>
              <div className="text-teal-200/50 text-xs">{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--color-bg)]">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-[#134E4A] flex items-center justify-center">
              <Stethoscope size={18} className="text-teal-300" />
            </div>
            <span className="text-[#134E4A] dark:text-teal-300 font-bold text-xl">haidoc</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-main)]">Welcome back</h1>
            <p className="text-[var(--color-text-muted)] text-sm mt-1">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="your username"
                required
                autoFocus
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-main)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all shadow-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                required
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-main)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all shadow-sm"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#134E4A] text-white rounded-xl hover:bg-teal-800 disabled:opacity-50 font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-md shadow-teal-900/20 mt-2"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Signing in...</>
                : <><span>Sign in</span><ArrowRight size={16} /></>
              }
            </button>
          </form>

          <p className="text-sm text-center text-[var(--color-text-muted)] mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-teal-700 hover:text-teal-800 font-semibold">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

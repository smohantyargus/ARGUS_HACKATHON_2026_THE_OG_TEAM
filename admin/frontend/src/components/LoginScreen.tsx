import { useState } from 'react'
import { Link } from 'react-router-dom'
import { orchestratorApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Network, ArrowRight, Loader2 } from 'lucide-react'

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
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #060A13 0%, #0A1628 60%, #060A13 100%)' }}
      >
        {/* Grid overlay */}
        <div className="absolute inset-0 argus-grid-bg" />
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
        {/* Glowing orbs */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-80 h-80 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute -bottom-20 left-1/4 w-64 h-64 rounded-full bg-cyan-500/4 blur-2xl" />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.12)]">
              <Network size={22} className="text-cyan-400" />
            </div>
            <div>
              <span className="text-white font-black text-2xl tracking-tight font-mono">Civis</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-[10px] font-bold text-cyan-400/50 uppercase tracking-widest">Mission Control</span>
              </div>
            </div>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10 space-y-6">
          <div className="space-y-3">
            <div className="text-[10px] font-bold text-cyan-400/40 uppercase tracking-widest border-l-2 border-cyan-500/30 pl-3 font-mono">
              Multi-Agent Decision Intelligence
            </div>
            <h2 className="text-4xl font-black text-white leading-tight">
              Agents negotiate.<br />
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(90deg, #22D3EE 0%, #818CF8 100%)' }}
              >
                Systems decide.
              </span>
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
              Parallel specialist agents negotiate, conflict-resolve, and synthesise optimal policies — powered by Claude and Gemini.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ['Parallel Agents', 'Fan-out execution', '#22D3EE'],
              ['Conflict Resolution', 'LLM arbitration', '#818CF8'],
              ['Reasoning', 'Claude-powered', '#10B981'],
            ].map(([title, sub, color]) => (
              <div key={title} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="text-xs font-bold mb-0.5 font-mono" style={{ color }}>{title}</div>
                <div className="text-[10px] text-slate-600">{sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <span className="text-[10px] text-slate-700 font-mono">Civis v1.0 — Hackathon 2026</span>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--color-bg)]">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/60 border border-cyan-500/20 flex items-center justify-center">
              <Network size={18} className="text-cyan-400" />
            </div>
            <span className="text-cyan-400 font-black text-xl font-mono tracking-tight">Civis</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-main)]">Welcome back</h1>
            <p className="text-[var(--color-text-muted)] text-sm mt-1">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-1.5 font-mono">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="your username"
                required
                autoFocus
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-main)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-1.5 font-mono">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                required
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-main)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500/50 transition-all"
              />
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 disabled:opacity-50 font-bold text-sm transition-all flex items-center justify-center gap-2 mt-2 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Signing in...</>
                : <><span>Sign in</span><ArrowRight size={16} /></>
              }
            </button>
          </form>

          <p className="text-sm text-center text-[var(--color-text-muted)] mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-cyan-400 hover:text-cyan-300 font-semibold">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { configApi, orchestratorApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import PageHeader from '@/components/PageHeader'

interface Flag {
  key: string
  label: string
  enabled: boolean
  roles: string[]
  description?: string
}

export default function FeatureFlags() {
  const { role } = useAuth()
  const { reload } = useFeatureFlags()
  const [flags, setFlags] = useState<Flag[]>([])
  const [allRoles, setAllRoles] = useState<string[]>(['admin', 'user'])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [flagsRes, rolesRes] = await Promise.all([
        configApi.get('/features/all', { headers: { 'X-User-Role': role ?? 'admin' } }),
        orchestratorApi.get('/v1/roles'),
      ])
      setFlags(flagsRes.data)
      const roleNames: string[] = (rolesRes.data as { name: string }[]).map(r => r.name)
      if (roleNames.length > 0) setAllRoles(roleNames)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleEnabled(key: string, enabled: boolean) {
    await configApi.put(`/features/${key}`, { enabled }, {
      headers: { 'X-User-Role': role ?? 'admin' },
    })
    setFlags((prev) => prev.map((f) => f.key === key ? { ...f, enabled } : f))
    reload()
  }

  async function toggleRole(key: string, r: string, currentRoles: string[]) {
    const roles = currentRoles.includes(r)
      ? currentRoles.filter((x) => x !== r)
      : [...currentRoles, r]
    await configApi.put(`/features/${key}`, { roles }, {
      headers: { 'X-User-Role': role ?? 'admin' },
    })
    setFlags((prev) => prev.map((f) => f.key === key ? { ...f, roles } : f))
    reload()
  }

  return (
    <div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-4 animate-in fade-in duration-200">
        <PageHeader title="Feature Flags" />
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)] font-medium">
            Changes take effect within 60 seconds for all users.
          </p>
        </div>
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-bg)] border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)] text-xs font-semibold uppercase tracking-wider">
              <th className="px-6 py-3.5">Feature</th>
              <th className="px-6 py-3.5">Enabled</th>
              <th className="px-6 py-3.5">Roles</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-[var(--color-text-muted)]">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs">Loading feature configurations...</span>
                  </div>
                </td>
              </tr>
            ) : flags.map((flag) => (
              <tr key={flag.key} className="hover:bg-[var(--color-bg)] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-semibold text-[var(--color-text-main)] text-sm">{flag.label}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">{flag.key}</div>
                  {flag.description && (
                    <div className="text-xs text-[var(--color-text-muted)] mt-1">{flag.description}</div>
                  )}
                </td>

                
                <td className="px-6 py-4">
                  <button
                    onClick={() => toggleEnabled(flag.key, !flag.enabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                      flag.enabled ? 'app-toggle-active' : 'app-toggle-inactive'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        flag.enabled ? 'translate-x-4' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </td>

                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-4">
                    {allRoles.map((r) => (
                      <label key={r} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors">
                        <input
                          type="checkbox"
                          checked={flag.roles.includes(r)}
                          onChange={() => toggleRole(flag.key, r, flag.roles)}
                          
                          className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] accent-teal-600 focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
                        />
                        <span className="capitalize">{r}</span>
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

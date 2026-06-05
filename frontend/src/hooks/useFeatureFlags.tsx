import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from 'react'
import { configApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

interface FeatureFlag {
  key: string
  label: string
  enabled: boolean
  roles: string[]
  description?: string
}

interface FeatureFlagState {
  flags: FeatureFlag[]
  hasFeature: (key: string) => boolean
  reload: () => void
  loading: boolean
}

const FeatureFlagContext = createContext<FeatureFlagState | null>(null)

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, role } = useAuth()
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!isAuthenticated || !role) return
    setLoading(true)
    try {
      const res = await configApi.get('/features/', {
        headers: { 'X-User-Role': role },
      })
      const data: FeatureFlag[] = res.data
      setFlags(data)
      setEnabledKeys(new Set(data.map((f) => f.key)))
    } catch {
      // Fail gracefully — fall back to empty set (deny unknown features)
      setFlags([])
      setEnabledKeys(new Set())
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, role])

  // Fetch on login and whenever role changes
  useEffect(() => {
    if (isAuthenticated) {
      fetch()
    } else {
      setFlags([])
      setEnabledKeys(new Set())
    }
  }, [isAuthenticated, fetch])

  const hasFeature = useCallback((key: string) => enabledKeys.has(key), [enabledKeys])

  return (
    <FeatureFlagContext.Provider value={{ flags, hasFeature, reload: fetch, loading }}>
      {children}
    </FeatureFlagContext.Provider>
  )
}

export function useFeatureFlags() {
  const ctx = useContext(FeatureFlagContext)
  if (!ctx) throw new Error('useFeatureFlags must be inside FeatureFlagProvider')
  return ctx
}

/** Convenience hook — returns whether a single flag is enabled. */
export function useFeature(key: string): boolean {
  return useFeatureFlags().hasFeature(key)
}

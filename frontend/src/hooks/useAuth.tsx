import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

type Role = 'admin' | 'user' | 'superadmin' | (string & {})

interface AuthState {
  token: string | null
  user: Record<string, unknown> | null
  role: Role | null
  isAdmin: boolean
  isSuperadmin: boolean
  isAuthenticated: boolean
  loading: boolean
  loginWithToken: (accessToken: string, refreshToken?: string | null) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

const TOKEN_KEY = 'haidoc_token'

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

function isExpired(payload: Record<string, unknown>): boolean {
  const exp = payload.exp as number | undefined
  return !!exp && exp * 1000 < Date.now()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (stored) {
      const payload = decodePayload(stored)
      if (payload && !isExpired(payload)) {
        return stored
      }
    }
    return null
  })

  const [user, setUser] = useState<Record<string, unknown> | null>(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (stored) {
      const payload = decodePayload(stored)
      if (payload && !isExpired(payload)) {
        return payload
      }
    }
    return null
  })

  const [role, setRole] = useState<Role | null>(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)
    if (stored) {
      const payload = decodePayload(stored)
      if (payload && !isExpired(payload)) {
        return (payload.role as Role) ?? 'user'
      }
    }
    return null
  })

  const [loading, setLoading] = useState(true)

  const persistToken = useCallback((accessToken: string | null) => {
    setTokenState(accessToken)
    if (accessToken) {
      sessionStorage.setItem(TOKEN_KEY, accessToken)
      const payload = decodePayload(accessToken)
      if (payload) {
        setUser(payload)
        setRole((payload.role as Role) ?? 'user')
      } else {
        setUser(null)
        setRole(null)
      }
    } else {
      sessionStorage.removeItem(TOKEN_KEY)
      setUser(null)
      setRole(null)
    }
  }, [])

  
  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY)

    if (stored) {
      const payload = decodePayload(stored)
      if (payload && !isExpired(payload)) {
        setLoading(false)
        return
      }
    }

    
    setLoading(true)
    fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.access_token) {
          persistToken(data.access_token)
        } else {
          persistToken(null)
        }
      })
      .catch(() => persistToken(null))
      .finally(() => setLoading(false))
  
  }, [])

  const loginWithToken = useCallback((accessToken: string, _refreshToken?: string | null) => {
    persistToken(accessToken)
  }, [persistToken])

  const logout = useCallback(() => {
    persistToken(null)
   
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {})
  }, [persistToken])

  return (
    <AuthContext.Provider value={{
      token, user, role,
      isAdmin: role === 'admin' || role === 'superadmin',
      isSuperadmin: role === 'superadmin',
      isAuthenticated: !!token,
      loading,
      loginWithToken,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}

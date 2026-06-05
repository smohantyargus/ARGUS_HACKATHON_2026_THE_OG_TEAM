import axios, { type InternalAxiosRequestConfig } from 'axios'

const TOKEN_KEY = 'civis_token'

/** Orchestrator API (proxied via /api -> localhost:8000) */
export const orchestratorApi = axios.create({ baseURL: '/api', withCredentials: true })

/** ConfigService API (proxied via /config-api -> localhost:8010) */
export const configApi = axios.create({ baseURL: '/config-api', withCredentials: true })

function authInterceptor(config: InternalAxiosRequestConfig) {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.role) config.headers['X-User-Role'] = payload.role
    } catch { /* ignore */ }
  }
  return config
}

orchestratorApi.interceptors.request.use(authInterceptor)
configApi.interceptors.request.use(authInterceptor)

// Silent token refresh on 401 — retries the original request once with the new token
let _refreshing: Promise<string | null> | null = null

async function attemptRefresh(): Promise<string | null> {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    try {
      
      const res = await axios.post('/api/auth/refresh', {}, { withCredentials: true })
      const { access_token } = res.data
      sessionStorage.setItem(TOKEN_KEY, access_token)
      return access_token as string
    } catch {
      sessionStorage.removeItem(TOKEN_KEY)
      return null
    }
  })()
  _refreshing.finally(() => { _refreshing = null })
  return _refreshing
}

function make401Interceptor(instance: typeof orchestratorApi) {
  instance.interceptors.response.use(
    r => r,
    async err => {
      const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean }
      if (err.response?.status === 401 && !original._retry) {
        original._retry = true
        const newToken = await attemptRefresh()
        if (newToken) {
          original.headers.Authorization = `Bearer ${newToken}`
          return instance(original)
        }
        // Refresh failed — redirect to login
        window.location.href = '/login'
      }
      return Promise.reject(err)
    },
  )
}

make401Interceptor(orchestratorApi)
make401Interceptor(configApi)

/** @deprecated Token is now injected per-request via interceptor. No-op kept for compatibility. */
export function setAuthToken(_token: string | null) {
  // Intentional no-op: interceptors read from sessionStorage directly.
}

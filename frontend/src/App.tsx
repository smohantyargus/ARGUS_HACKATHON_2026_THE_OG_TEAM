import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { FeatureFlagProvider } from '@/hooks/useFeatureFlags'
import { ThemeProvider } from '@/hooks/useTheme'
import Layout from '@/components/Layout'
import LoginScreen from '@/components/LoginScreen'
import Register from '@/pages/Register'
import Dashboard from '@/pages/Dashboard'
import JobConsole from '@/pages/JobConsole'
import JobHistory from '@/pages/JobHistory'
import JobDetail from '@/pages/JobDetail'
import Agents from '@/pages/Agents'
import PipelineBuilder from '@/pages/PipelineBuilder'
import Config from '@/pages/Config'
import Prompts from '@/pages/Prompts'
import Webhooks from '@/pages/Webhooks'
import FeatureFlags from '@/pages/FeatureFlags'
import AccessKeys from '@/pages/AccessKeys'
import LLMInstances from '@/pages/LLMInstances'
import Roles from '@/pages/Roles'
import Profile from '@/pages/Profile'
import FailedJobs from '@/pages/FailedJobs'
import Organisations from '@/pages/Organisations'
import Menus from '@/pages/Menus'
import type { ReactElement } from 'react'

/** Redirects non-admins to / — used to protect admin-only pages. */
function AdminRoute({ element }: { element: ReactElement }) {
  const { isAdmin } = useAuth()
  return isAdmin ? element : <Navigate to="/" replace />
}

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/register" element={<Register />} />

      {isAuthenticated ? (
        <Route element={<Layout />}>
          {/* Landing — all authenticated users */}
          <Route path="/" element={<Dashboard />} />

          {/* Shared — all authenticated users */}
          <Route path="/jobs/new" element={<JobConsole />} />
          <Route path="/jobs" element={<JobHistory />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />
          <Route path="/profile" element={<Profile />} />

          {/* Admin-only */}
          <Route path="/agents"        element={<AdminRoute element={<Agents />} />} />
          <Route path="/pipelines"     element={<AdminRoute element={<PipelineBuilder />} />} />
          <Route path="/config"        element={<AdminRoute element={<Config />} />} />
          <Route path="/prompts"       element={<AdminRoute element={<Prompts />} />} />
          <Route path="/webhooks"      element={<AdminRoute element={<Webhooks />} />} />
          <Route path="/feature-flags" element={<AdminRoute element={<FeatureFlags />} />} />
          <Route path="/access-keys"   element={<AdminRoute element={<AccessKeys />} />} />
          <Route path="/llm-instances" element={<AdminRoute element={<LLMInstances />} />} />
          <Route path="/roles"         element={<AdminRoute element={<Roles />} />} />
          <Route path="/failed-jobs"    element={<AdminRoute element={<FailedJobs />} />} />
          <Route path="/organisations"  element={<AdminRoute element={<Organisations />} />} />
          <Route path="/menus"          element={<AdminRoute element={<Menus />} />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<LoginScreen />} />
      )}
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <FeatureFlagProvider>
            <AppRoutes />
          </FeatureFlagProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

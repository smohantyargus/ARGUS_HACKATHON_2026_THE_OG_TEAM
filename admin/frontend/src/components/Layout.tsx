import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useTheme } from '@/hooks/useTheme'
import {
  LayoutDashboard, LogOut, User, Box, ChevronRight,
  GitBranch, Settings, FileText, Search, X, Moon, Sun
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { configApi } from '@/lib/api'
import { DynamicIcon } from '@/components/DynamicIcon'

// Standalone
const DASHBOARD_NAV = { to: '/', icon: LayoutDashboard, label: 'Dashboard' }

interface NavItem {
  to: string
  icon: string
  label: string
  featureKey?: string
  isExternal?: boolean
}

interface NavCategory {
  title: string
  items: NavItem[]
}

export default function Layout() {
  const { role, isAdmin, logout, user } = useAuth()
  const { hasFeature } = useFeatureFlags()
  const { theme, toggle } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const [navCategories, setNavCategories] = useState<NavCategory[]>([])
  const [headerTitle, setHeaderTitle] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeFlyout, setActiveFlyout] = useState<string | null>(null)
  const [isHoveringFlyout, setIsHoveringFlyout] = useState(false)
  const [flyoutTop, setFlyoutTop] = useState(0)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const flyoutRef = useRef<HTMLDivElement>(null)
  const closeTimeout = useRef<any>(null)

  useEffect(() => {
    // Server derives role from JWT — no client-supplied role param
    configApi.get<NavCategory[]>('/navigation')
      .then(res => setNavCategories(res.data))
      .catch(err => console.error("Failed to load navigation from backend", err))
  }, [isAdmin])

  const CATEGORIES = navCategories.map(cat => ({
    ...cat,
    items: cat.items.filter(item => !item.featureKey || hasFeature(item.featureKey))
  })).filter(cat => cat.items.length > 0)

  const searchQuery = search.trim().toLowerCase()
  const searchResults = searchQuery
    ? CATEGORIES.flatMap(cat =>
        cat.items
          .filter(item => item.label.toLowerCase().includes(searchQuery) || item.to.toLowerCase().includes(searchQuery))
          .map(item => ({ ...item, categoryTitle: cat.title }))
      )
    : []

  // Handle hover-to-close logic
  useEffect(() => {
    if (!isExpanded && !isHoveringFlyout) {
      closeTimeout.current = setTimeout(() => {
        setActiveFlyout(null)
      }, 50)
    } else {
      if (closeTimeout.current) clearTimeout(closeTimeout.current)
    }
    return () => {
      if (closeTimeout.current) clearTimeout(closeTimeout.current)
    }
  }, [isExpanded, isHoveringFlyout])

  // Auto-close and reset hover states on path change
  useEffect(() => {
    setActiveFlyout(null)
    setIsHoveringFlyout(false)
    setIsExpanded(false)
    setSearch('')
  }, [pathname])

  const handleToggleFlyout = (e: React.MouseEvent, title: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setFlyoutTop(rect.top)
    setActiveFlyout(prev => prev === title ? null : title)
  }

  const handleHoverCategory = (e: React.MouseEvent, title: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setFlyoutTop(rect.top)
    setActiveFlyout(title)
  }

  const username = (user as Record<string, unknown>)?.username as string
    ?? (user as Record<string, unknown>)?.preferred_username as string
    ?? 'User'

  const getPageTitle = () => {
    if (headerTitle) return headerTitle
    if (pathname === '/') return 'Dashboard'
    const allItems = CATEGORIES.flatMap(c => c.items)
    const activeNav = allItems.find(item => item.to === pathname)
    return activeNav ? activeNav.label : 'Dashboard'
  }

  const selectedCategory = CATEGORIES.find(c => c.title === activeFlyout)
  const sidebarActuallyExpanded = isExpanded || isHoveringFlyout

  return (
    <div className="flex h-screen bg-[var(--color-bg)] dark:bg-[#0F172A] overflow-hidden font-sans relative">

      
      <aside
        className={cn(
          "sidebar-shell flex flex-col transition-all duration-300 ease-in-out z-40 shrink-0 h-screen shadow-xl",
          sidebarActuallyExpanded ? "w-64" : "w-16"
        )}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        {/* Logo Section */}
        <div className="h-16 flex items-center justify-center border-b sidebar-divider">
          <div className="w-8 h-8 sidebar-brand-icon rounded-lg flex items-center justify-center">
            <Box size={20} />
          </div>
          {sidebarActuallyExpanded && (
            <span className="ml-3 font-bold sidebar-primary-text text-lg tracking-tight">
              civis
            </span>
          )}
        </div>

        {/* Search bar */}
        {sidebarActuallyExpanded && (
          <div className="px-3 py-2 border-b sidebar-divider">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 sidebar-icon-muted pointer-events-none" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => { setSearch(e.target.value); setActiveFlyout(null) }}
                placeholder="Search menus..."
                className="w-full sidebar-search-input text-xs rounded-lg pl-8 pr-7 py-2 focus:outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 sidebar-search-clear">
                  <X size={12} />
                </button>
              )}
            </div>
            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="mt-1.5 sidebar-search-results border rounded-xl overflow-hidden">
                {searchResults.map(item => (
                  item.isExternal ? (
                    <a key={item.to} href={item.to} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2.5 px-3 py-2.5 sidebar-search-result transition-colors">
                      <DynamicIcon name={item.icon} size={14} className="sidebar-accent-text shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium sidebar-primary-text">{item.label}</p>
                        <p className="text-[10px] sidebar-secondary-text">{item.categoryTitle}</p>
                      </div>
                      <DynamicIcon name="ExternalLink" size={10} className="sidebar-disabled-text" />
                    </a>
                  ) : (
                    <NavLink key={item.to} to={item.to}
                      className={({ isActive }) => cn(
                        'flex items-center gap-2.5 px-3 py-2.5 transition-colors',
                        isActive ? 'sidebar-search-result-active' : 'sidebar-search-result'
                      )}>
                      <DynamicIcon name={item.icon} size={14} className="sidebar-accent-text shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{item.label}</p>
                        <p className="text-[10px] sidebar-secondary-text">{item.categoryTitle}</p>
                      </div>
                    </NavLink>
                  )
                ))}
              </div>
            )}
            {searchQuery && searchResults.length === 0 && (
              <p className="text-[10px] sidebar-disabled-text mt-1.5 px-1">No results for "{search}"</p>
            )}
          </div>
        )}

        {/* Navigation Section */}
        <nav className="flex-1 px-2 overflow-y-auto overflow-x-hidden scrollbar-hide py-4 flex flex-col gap-2 pointer-events-auto">
          {/* Dashboard Standalone */}
          <NavLink to={DASHBOARD_NAV.to} end
            onMouseEnter={() => {
              setIsExpanded(true)
              setActiveFlyout(null)
            }}
            className={({ isActive }) => cn(
              'flex items-center px-3 py-3 rounded-lg transition-all mb-2',
              sidebarActuallyExpanded ? "gap-4" : "justify-center",
              isActive ? 'sidebar-nav-active shadow-md' : 'sidebar-nav-idle',
            )}
            title={!sidebarActuallyExpanded ? DASHBOARD_NAV.label : ''}
          >
            <div className="w-5 h-5 shrink-0 flex items-center justify-center"><DASHBOARD_NAV.icon size={20} /></div>
            {sidebarActuallyExpanded && (
              <span className="text-sm font-semibold whitespace-nowrap overflow-hidden animate-in fade-in duration-300">
                {DASHBOARD_NAV.label}
              </span>
            )}
          </NavLink>

          {/* Categories */}
          {CATEGORIES.map((cat) => {
            const isFlyoutActive = activeFlyout === cat.title
            const isRouteActive = cat.items.some(item =>
              item.to === pathname || (item.to !== '/' && pathname.startsWith(item.to))
            )

            return (
              <div key={cat.title} className="mb-1 pointer-events-auto">
                <button
                  onMouseEnter={(e) => handleHoverCategory(e, cat.title)}
                  onClick={(e) => handleToggleFlyout(e, cat.title)}
                  className={cn(
                    "w-full flex items-center px-3 py-3 rounded-lg transition-all",
                    sidebarActuallyExpanded ? "gap-4" : "justify-center",
                    isRouteActive
                      ? "sidebar-nav-active shadow-sm font-bold"
                      : isFlyoutActive
                        ? "sidebar-nav-open"
                        : "sidebar-nav-idle",
                  )}
                  title={!sidebarActuallyExpanded ? cat.title : ''}
                >
                  <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                    {cat.title === 'Core Workspace' ? <Box size={20} /> :
                      cat.title === 'AI & Processing' ? <GitBranch size={20} /> :
                        cat.title === 'System & Access Control' ? <Settings size={20} /> :
                          <FileText size={20} />}
                  </div>
                  {sidebarActuallyExpanded && (
                    <div className="flex-1 flex items-center justify-between overflow-hidden text-left animate-in fade-in duration-300">
                      <span className="text-sm font-semibold whitespace-nowrap tracking-tight">{cat.title}</span>
                      <ChevronRight size={14} className={cn("transition-transform duration-200 opacity-40", isFlyoutActive && "rotate-180 opacity-100")} />
                    </div>
                  )}
                </button>
              </div>
            )
          })}
        </nav>

        {/* Bottom Section - Theme + User Profile */}
        <div className="p-3 border-t sidebar-divider flex flex-col gap-1">
          {/* Theme toggle */}
          <button
            onClick={toggle}
            onMouseEnter={() => setIsExpanded(true)}
            className={cn(
              "flex items-center gap-3 p-2 rounded-xl transition-all sidebar-action w-full",
              sidebarActuallyExpanded ? "px-3" : "justify-center"
            )}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <Moon size={17} className="shrink-0" />
            ) : (
              <Sun size={17} className="shrink-0" />
            )}
            {sidebarActuallyExpanded && (
              <span className="text-xs font-medium whitespace-nowrap">
                {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
              </span>
            )}
          </button>

          <div
            onClick={() => navigate('/profile')}
            onMouseEnter={() => {
              setIsExpanded(true)
              setActiveFlyout(null)
            }}
            className={cn(
              "flex items-center gap-3 p-2 rounded-xl transition-all cursor-pointer sidebar-profile",
              sidebarActuallyExpanded ? "sidebar-profile-expanded" : "justify-center"
            )}
            title={sidebarActuallyExpanded ? 'Profile & Mobile Login' : username}
          >
            <div className="w-8 h-8 rounded-lg sidebar-profile-icon flex items-center justify-center shrink-0 shadow-inner">
              <User size={18} />
            </div>
            {sidebarActuallyExpanded && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-bold sidebar-primary-text truncate leading-tight uppercase">{username}</span>
                <span className="text-[10px] sidebar-role-text font-bold uppercase tracking-wider leading-none">{role ?? 'user'}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Flyout Side Box - Perfectly Aligned Style */}
      {activeFlyout && (
        <div
          ref={flyoutRef}
          onMouseEnter={() => setIsHoveringFlyout(true)}
          onMouseLeave={() => setIsHoveringFlyout(false)}
          style={{ top: flyoutTop }}
          className={cn(
            "fixed z-50 transition-all duration-300 ease-out flex flex-col pointer-events-auto",
            sidebarActuallyExpanded ? "left-[16.5rem] w-80" : "left-20 w-80"
          )}
        >
          <div className="sidebar-flyout h-fit max-h-[70vh] rounded-2xl shadow-2xl border flex flex-col py-4 overflow-hidden translate-y-[-10px]">
            <div className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-hide">
              {selectedCategory?.items.map(({ to, icon, label, isExternal }) => {
                const isEndMatch = to === '/jobs'
                if (isExternal) {
                  return (
                    <a key={to} href={to} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all sidebar-flyout-item">
                      <DynamicIcon name={icon} size={18} className="shrink-0" />
                      <span className="text-sm font-medium tracking-tight">{label}</span>
                      <DynamicIcon name="ExternalLink" size={12} className="ml-auto opacity-50" />
                    </a>
                  )
                }
                return (
                  <NavLink key={to} to={to} end={isEndMatch}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                      isActive
                        ? 'sidebar-flyout-item-active font-bold shadow-md'
                        : 'sidebar-flyout-item'
                    )}
                  >
                    <DynamicIcon name={icon} size={18} className="shrink-0" />
                    <span className="text-sm font-medium tracking-tight">{label}</span>
                  </NavLink>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header - Modern White Header */}
        <header className="app-header h-16 flex items-center justify-between px-8 border-b shrink-0 z-20 shadow-sm">
          {/* Left: Page Title */}
          <div className="flex items-center gap-4">
            <h1 className="app-header-title text-xl font-bold tracking-tight">{getPageTitle()}</h1>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-4">
            {/* Sign Out Action */}
            <button
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all font-bold text-xs uppercase tracking-widest border border-slate-100 dark:border-slate-200 shadow-sm group"
              title="Sign out"
            >
              <LogOut size={16} className="group-hover:translate-x-0.5 transition-transform" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg)] dark:bg-[#0F172A] p-8 lg:p-10 scrollbar-hide">
          <div className="max-w-7xl mx-auto">
            <Outlet context={{ setHeaderTitle }} />
          </div>
        </main>
      </div>
    </div>
  )
}
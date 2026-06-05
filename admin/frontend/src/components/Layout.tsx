import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useTheme } from '@/hooks/useTheme'
import {
  LayoutDashboard, LogOut, User, Network,
  GitBranch, FileText, Search, X, Moon, Sun, Shield,
  ChevronDown, ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { configApi } from '@/lib/api'
import { DynamicIcon } from '@/components/DynamicIcon'

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

function getCategoryIcon(title: string) {
  if (title === 'Core Workspace') return <LayoutDashboard size={13} />
  if (title === 'AI & Processing') return <GitBranch size={13} />
  if (title === 'System & Access Control') return <Shield size={13} />
  return <FileText size={13} />
}

export default function Layout() {
  const { role, isAdmin, logout, user } = useAuth()
  const { hasFeature } = useFeatureFlags()
  const { theme, toggle } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const [navCategories, setNavCategories] = useState<NavCategory[]>([])
  const [headerTitle, setHeaderTitle] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())

  useEffect(() => {
    configApi.get<NavCategory[]>('/navigation')
      .then(res => {
        setNavCategories(res.data)
        setOpenCats(new Set(res.data.map((c: NavCategory) => c.title)))
      })
      .catch(err => console.error('Failed to load navigation', err))
  }, [isAdmin])

  const CATEGORIES = navCategories
    .map(cat => ({
      ...cat,
      items: cat.items.filter(item => !item.featureKey || hasFeature(item.featureKey)),
    }))
    .filter(cat => cat.items.length > 0)

  const searchQuery = search.trim().toLowerCase()
  const searchResults = searchQuery
    ? CATEGORIES.flatMap(cat =>
        cat.items
          .filter(i => i.label.toLowerCase().includes(searchQuery))
          .map(i => ({ ...i, categoryTitle: cat.title }))
      )
    : []

  useEffect(() => { setSearch('') }, [pathname])

  const username =
    (user as Record<string, unknown>)?.username as string ??
    (user as Record<string, unknown>)?.preferred_username as string ??
    'User'

  const getPageTitle = () => {
    if (headerTitle) return headerTitle
    if (pathname === '/') return 'Dashboard'
    const all = CATEGORIES.flatMap(c => c.items)
    return all.find(i => i.to === pathname)?.label ?? 'Dashboard'
  }

  const activeCategory = CATEGORIES.find(cat =>
    cat.items.some(i => i.to === pathname || (i.to !== '/' && pathname.startsWith(i.to)))
  )

  function toggleCat(title: string) {
    setOpenCats(prev => {
      const next = new Set(prev)
      next.has(title) ? next.delete(title) : next.add(title)
      return next
    })
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)] overflow-hidden font-sans">

      {/* ── Sidebar — fixed 224px ── */}
      <aside className="w-56 shrink-0 flex flex-col h-screen z-40 border-r border-white/[0.05]"
        style={{ background: 'linear-gradient(180deg, #050912 0%, #040810 100%)' }}
      >
        {/* Brand */}
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-cyan-950/70 border border-cyan-500/20 shadow-[0_0_12px_rgba(34,211,238,0.12)]">
              <Network size={17} className="text-cyan-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-cyan-400 font-mono tracking-tight leading-none">Civis</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-bold text-emerald-400/50 uppercase tracking-widest font-mono">Online</span>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-white/20" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pages..."
              className="w-full text-[11px] rounded-lg pl-7 pr-6 py-1.5 focus:outline-none bg-white/[0.04] border border-white/[0.06] text-white/70 placeholder:text-white/20 focus:border-cyan-500/30 focus:bg-white/[0.06] transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                <X size={10} />
              </button>
            )}
          </div>

          {/* Search results */}
          {searchQuery && (
            <div className="mt-1.5 bg-[#0B1020] border border-white/[0.08] rounded-xl overflow-hidden">
              {searchResults.length === 0 ? (
                <p className="text-[10px] text-white/25 px-3 py-2 font-mono">No results</p>
              ) : searchResults.map(item =>
                item.isExternal ? (
                  <a key={item.to} href={item.to} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors text-white/60 hover:text-white/90">
                    <DynamicIcon name={item.icon} size={12} className="text-cyan-400/70 shrink-0" />
                    <span className="text-[11px] truncate">{item.label}</span>
                  </a>
                ) : (
                  <NavLink key={item.to} to={item.to}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2 px-3 py-2 transition-colors',
                      isActive ? 'bg-cyan-950/60 text-cyan-400' : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90'
                    )}>
                    <DynamicIcon name={item.icon} size={12} className="text-cyan-400/70 shrink-0" />
                    <span className="text-[11px] truncate">{item.label}</span>
                  </NavLink>
                )
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto scrollbar-hide py-3 px-2.5 space-y-0.5">

          {/* Dashboard */}
          <NavLink to={DASHBOARD_NAV.to} end
            className={({ isActive }) => cn(
              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-[12px] font-semibold relative',
              isActive
                ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-500/15 shadow-[inset_0_1px_0_rgba(34,211,238,0.08)]'
                : 'text-white/40 hover:text-white/80 hover:bg-white/[0.04]'
            )}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-cyan-400 rounded-r-full shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                )}
                <DASHBOARD_NAV.icon size={15} className="shrink-0" />
                <span>{DASHBOARD_NAV.label}</span>
              </>
            )}
          </NavLink>

          <div className="my-2 border-t border-white/[0.05]" />

          {/* Categories */}
          {CATEGORIES.map(cat => {
            const isOpen = openCats.has(cat.title)
            const isCatActive = cat.items.some(
              i => i.to === pathname || (i.to !== '/' && pathname.startsWith(i.to))
            )

            return (
              <div key={cat.title} className="mb-1">
                {/* Section label / toggle */}
                <button
                  onClick={() => toggleCat(cat.title)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-1 rounded-md transition-all mb-0.5',
                    isCatActive ? 'text-cyan-400/70' : 'text-white/25 hover:text-white/50'
                  )}
                >
                  <span className="shrink-0">{getCategoryIcon(cat.title)}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest font-mono flex-1 text-left truncate">
                    {cat.title}
                  </span>
                  {isOpen
                    ? <ChevronDown size={10} className="opacity-50 shrink-0" />
                    : <ChevronRight size={10} className="opacity-50 shrink-0" />
                  }
                </button>

                {/* Items */}
                {isOpen && (
                  <div className="pl-1.5 space-y-0.5">
                    {cat.items.map(({ to, icon, label, isExternal }) => {
                      const isEnd = to === '/jobs'
                      if (isExternal) {
                        return (
                          <a key={to} href={to} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-all">
                            <DynamicIcon name={icon} size={13} className="shrink-0 opacity-60" />
                            <span className="truncate">{label}</span>
                            <DynamicIcon name="ExternalLink" size={9} className="ml-auto opacity-30 shrink-0" />
                          </a>
                        )
                      }
                      return (
                        <NavLink key={to} to={to} end={isEnd}
                          className={({ isActive }) => cn(
                            'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-all relative',
                            isActive
                              ? 'bg-cyan-950/50 text-cyan-300 font-semibold border border-cyan-500/10'
                              : 'text-white/40 hover:text-white/80 hover:bg-white/[0.04] font-medium'
                          )}
                        >
                          {({ isActive }) => (
                            <>
                              {isActive && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3 bg-cyan-400 rounded-r-full shadow-[0_0_5px_rgba(34,211,238,0.7)]" />
                              )}
                              <DynamicIcon name={icon} size={13} className={cn('shrink-0', isActive ? 'text-cyan-400' : 'opacity-40')} />
                              <span className="truncate">{label}</span>
                            </>
                          )}
                        </NavLink>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Bottom — user + controls */}
        <div className="px-2.5 pb-3 pt-2 border-t border-white/[0.05] space-y-1.5">
          {/* User row */}
          <button
            onClick={() => navigate('/profile')}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-all group"
          >
            <div className="w-7 h-7 rounded-lg bg-violet-950/70 border border-violet-500/20 flex items-center justify-center shrink-0">
              <User size={13} className="text-violet-400" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[10px] font-black text-white/60 group-hover:text-white/90 truncate uppercase font-mono leading-none">{username}</p>
              <p className="text-[9px] text-violet-400/60 font-bold uppercase tracking-widest font-mono leading-none mt-0.5">{role ?? 'user'}</p>
            </div>
          </button>

          {/* Theme + Logout */}
          <div className="flex gap-1">
            <button
              onClick={toggle}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="flex items-center justify-center gap-1.5 flex-1 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-white/30 hover:text-white/70 transition-all border border-white/[0.05]"
            >
              {theme === 'light' ? <Moon size={12} /> : <Sun size={12} />}
              <span className="text-[9px] font-bold uppercase tracking-widest font-mono">
                {theme === 'light' ? 'Dark' : 'Light'}
              </span>
            </button>
            <button
              onClick={logout}
              className="flex items-center justify-center gap-1.5 flex-1 py-1.5 rounded-lg bg-white/[0.03] hover:bg-red-950/40 text-white/30 hover:text-red-400 transition-all border border-white/[0.05] hover:border-red-900/40"
            >
              <LogOut size={12} />
              <span className="text-[9px] font-bold uppercase tracking-widest font-mono">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top navbar — slim 44px */}
        <header className="h-11 flex items-center justify-between px-6 shrink-0 z-20 border-b border-white/[0.05]"
          style={{ background: 'rgba(8, 13, 27, 0.95)', backdropFilter: 'blur(12px)' }}
        >
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            {activeCategory ? (
              <>
                <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest font-mono shrink-0">
                  {activeCategory.title}
                </span>
                <span className="text-white/15 text-xs shrink-0">/</span>
                <h1 className="text-[12px] font-bold text-white/70 font-mono truncate">{getPageTitle()}</h1>
              </>
            ) : (
              <h1 className="text-[12px] font-bold text-white/70 font-mono">{getPageTitle()}</h1>
            )}
          </div>

          {/* Right */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-900/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400/70 uppercase tracking-widest font-mono">Systems Online</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg)] argus-grid-bg p-8 lg:p-10 scrollbar-hide">
          <div className="max-w-7xl mx-auto">
            <Outlet context={{ setHeaderTitle }} />
          </div>
        </main>
      </div>
    </div>
  )
}

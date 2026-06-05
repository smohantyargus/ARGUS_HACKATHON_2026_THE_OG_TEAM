import { useEffect, useState } from 'react'
import { orchestratorApi, configApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import PageHeader from '@/components/PageHeader'
import { Shield, Plus, Trash2, X, Users, ChevronDown, ChevronUp, Lock, Pencil, UserPlus } from 'lucide-react'
import { Button } from '@/components/custom/Button'
import { CustomDialog } from '@/components/custom/CustomDialog'
import { CustomSelect } from '@/components/custom/CustomSelect'

interface Role {
  name: string
  label: string
  description?: string
  is_system: boolean
  is_registerable: boolean
  created_at: string
}

interface FeatureFlag {
  key: string
  label: string
  enabled: boolean
  roles: string[]
}

interface UserRow {
  id: number
  username: string
  role: string
  isActive: boolean
}

export default function Roles() {
  const { role: callerRole } = useAuth()
  const isSuperadmin = callerRole === 'superadmin'

  const [roles, setRoles] = useState<Role[]>([])
  const [features, setFeatures] = useState<FeatureFlag[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', label: '', description: '', feature_keys: [] as string[] })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // User role change
  const [editingUser, setEditingUser] = useState<number | null>(null)
  const [newRole, setNewRole] = useState('')
  const [savingRole, setSavingRole] = useState(false)

  // Edit features for existing role
  const [editFeaturesRole, setEditFeaturesRole] = useState<Role | null>(null)
  const [editFeatureKeys, setEditFeatureKeys] = useState<string[]>([])
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [deleteRoleName, setDeleteRoleName] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Section toggle
  const [showUsers, setShowUsers] = useState(false)

  // Create user
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [createUserForm, setCreateUserForm] = useState({ username: '', email: '', password: '', full_name: '', role: 'user' })
  const [creatingUser, setCreatingUser] = useState(false)
  const [createUserError, setCreateUserError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [rolesRes, usersRes] = await Promise.all([
        orchestratorApi.get('/v1/roles'),
        orchestratorApi.get('/v1/users'),
      ])
      setRoles(rolesRes.data)
      setUsers(usersRes.data)

      // Load feature flags for create form checkboxes
      const flagsRes = await configApi.get('/features/all', {
        headers: { 'X-User-Role': callerRole ?? 'admin' },
      })
      setFeatures(flagsRes.data)
    } catch (e: unknown) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      await orchestratorApi.post('/v1/roles', createForm)
      setShowCreate(false)
      setCreateForm({ name: '', label: '', description: '', feature_keys: [] })
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCreateError(detail ?? 'Failed to create role')
    } finally {
      setCreating(false)
    }
  }

  function openEditFeatures(r: Role) {
    // Derive which features currently have this role
    const current = features.filter(f => f.roles.includes(r.name)).map(f => f.key)
    setEditFeatureKeys(current)
    setEditFeaturesRole(r)
  }

  async function saveEditFeatures() {
    if (!editFeaturesRole) return
    setSavingFeatures(true)
    try {
      const roleName = editFeaturesRole.name
      const current = features.filter(f => f.roles.includes(roleName)).map(f => f.key)
      const toAdd = editFeatureKeys.filter(k => !current.includes(k))
      const toRemove = current.filter(k => !editFeatureKeys.includes(k))

      await Promise.all([
        toAdd.length > 0 && configApi.post('/features/bulk-role-assign', {
          role_name: roleName, feature_keys: toAdd, action: 'add',
        }),
        toRemove.length > 0 && configApi.post('/features/bulk-role-assign', {
          role_name: roleName, feature_keys: toRemove, action: 'remove',
        }),
      ])
      setEditFeaturesRole(null)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to update features')
    } finally {
      setSavingFeatures(false)
    }
  }

  async function confirmDelete() {
    if (!deleteRoleName) return
    setIsDeleting(true)
    try {
      await orchestratorApi.delete(`/v1/roles/${deleteRoleName}`)
      await load()
      setDeleteRoleName(null)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to delete role')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleRoleChange(userId: number) {
    if (!newRole) return
    setSavingRole(true)
    try {
      await orchestratorApi.patch(`/v1/users/${userId}/role`, { role: newRole })
      setEditingUser(null)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to change role')
    } finally {
      setSavingRole(false)
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setCreateUserError(null)
    setCreatingUser(true)
    try {
      await orchestratorApi.post('/auth/admin/users', createUserForm)
      setShowCreateUser(false)
      setCreateUserForm({ username: '', email: '', password: '', full_name: '', role: 'user' })
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCreateUserError(detail ?? 'Failed to create user')
    } finally {
      setCreatingUser(false)
    }
  }

  function toggleFeature(key: string) {
    setCreateForm(prev => ({
      ...prev,
      feature_keys: prev.feature_keys.includes(key)
        ? prev.feature_keys.filter(k => k !== key)
        : [...prev.feature_keys, key],
    }))
  }

  // Roles a caller can assign to other users
  const assignableRoles = roles.filter(r => {
    if (isSuperadmin) return r.name !== 'superadmin'
    return r.name !== 'admin' && r.name !== 'superadmin'
  })

  const canDelete = (r: Role) => {
    if (r.name === 'superadmin') return false
    if (r.is_system && !isSuperadmin) return false
    return true
  }

  if (loading) return <div className="text-[var(--color-text-muted)] text-sm p-8">Loading...</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-4 animate-in fade-in duration-200">
        <PageHeader title="Roles & Permissions" />
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)] font-medium">
            Manage roles and assign feature access. Use Feature Flags page to fine-tune per-role access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setShowCreate(true)}
            variant="primary"
            size="md"
            icon={<Plus size={16} />}
            className="whitespace-nowrap"
          >
            New Role
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}  

      {/* Roles table */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <h3 className="font-semibold text-[var(--color-text-muted)] text-sm flex items-center gap-2">
            <Shield size={15} className="text-teal-600" /> Roles
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              <th className="text-left px-5 py-3">Name</th>
              <th className="text-left px-5 py-3">Label</th>
              <th className="text-left px-5 py-3">Description</th>
              <th className="text-left px-5 py-3">Type</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {roles.map(r => (
              <tr key={r.name} className="hover:bg-[var(--color-bg)]/50">
                <td className="px-5 py-3 font-mono font-semibold text-[var(--color-text-main)]">{r.name}</td>
                <td className="px-5 py-3 text-[var(--color-text-main)]">{r.label}</td>
                <td className="px-5 py-3 text-[var(--color-text-muted)] text-xs max-w-xs">{r.description || '—'}</td>
                <td className="px-5 py-3">
                  {r.name === 'superadmin' ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 flex items-center gap-1 w-fit">
                      <Lock size={10} /> secret
                    </span>
                  ) : r.is_system ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-[var(--color-text-muted)]">system</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-700">custom</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {r.name !== 'superadmin' && (
                      <button
                        onClick={() => openEditFeatures(r)}
                        className="p-1.5 rounded-lg hover:bg-teal-50 text-[var(--color-text-muted)] hover:text-teal-600 transition"
                        title="Edit features"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {canDelete(r) && (
                      <button
                        onClick={() => setDeleteRoleName(r.name)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-600 transition"
                        title="Delete role"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Users section */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-between">
          <button
            className="flex items-center gap-2 flex-1 text-left"
            onClick={() => setShowUsers(v => !v)}
          >
            <h3 className="font-semibold text-[var(--color-text-muted)] text-sm flex items-center gap-2">
              <Users size={15} className="text-teal-600" /> Users & Role Assignment
            </h3>
            {showUsers ? <ChevronUp size={15} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={15} className="text-[var(--color-text-muted)]" />}
          </button>
          <Button
            onClick={e => { e.stopPropagation(); setShowCreateUser(true) }}
            variant="primary"
            size="sm"
            icon={<UserPlus size={13} />}
          >
            Create User
          </Button>
        </div>

        {showUsers && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                <th className="text-left px-5 py-3">Username</th>
                <th className="text-left px-5 py-3">Current Role</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Change Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {users.map(u => {
                const isProtected = u.role === 'superadmin' || (u.role === 'admin' && !isSuperadmin)
                return (
                  <tr key={u.id} className="hover:bg-[var(--color-bg)]/50">
                    <td className="px-5 py-3 font-semibold text-[var(--color-text-main)]">{u.username}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        u.role === 'superadmin' ? 'bg-purple-100 text-purple-700' :
                        u.role === 'admin' ? 'bg-amber-100 text-amber-700' :
                        'bg-teal-50 text-teal-700'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 active-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                          <span className="w-1.5 h-1.5 rounded-full active-status-dot" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 inactive-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                          <span className="w-1.5 h-1.5 rounded-full inactive-status-dot" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {isProtected ? (
                        <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><Lock size={11} /> protected</span>
                      ) : editingUser === u.id ? (
                        <div className="flex items-center gap-2">
                          <CustomSelect
                            value={newRole}
                            onChange={val => setNewRole(val)}
                            options={[
                              { value: '', label: 'Select role...' },
                              ...assignableRoles.map(r => ({ value: r.name, label: r.label }))
                            ]}
                            className="w-40 shrink-0"
                          />
                          <Button
                            onClick={() => handleRoleChange(u.id)}
                            disabled={savingRole || !newRole}
                            variant="primary"
                            size="sm"
                            className="shrink-0"
                          >
                            Save
                          </Button>
                          <Button
                            onClick={() => setEditingUser(null)}
                            variant="ghost"
                            size="sm"
                            className="shrink-0 p-1 min-h-0 min-w-0"
                            icon={<X size={13} />}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingUser(u.id); setNewRole(u.role) }}
                          className="text-xs text-teal-600 hover:text-teal-800 font-semibold underline underline-offset-2"
                        >
                          Change
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit features modal */}
      {editFeaturesRole && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
              <h3 className="font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <Pencil size={16} className="text-teal-600" />
                Features for <span className="font-mono text-teal-700">{editFeaturesRole.name}</span>
              </h3>
              <button onClick={() => setEditFeaturesRole(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-[var(--color-text-muted)]">
                Check the features this role can access. Changes apply within 60 seconds.
              </p>
              <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] max-h-72 overflow-y-auto">
                {features.map(f => (
                  <label key={f.key} className="flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--color-bg)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editFeatureKeys.includes(f.key)}
                      onChange={() => setEditFeatureKeys(prev =>
                        prev.includes(f.key) ? prev.filter(k => k !== f.key) : [...prev, f.key]
                      )}
                      className="mt-0.5 rounded border-[var(--color-border)] text-teal-600 accent-teal-600 focus:ring-teal-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-[var(--color-text-main)]">{f.label}</div>
                      <div className="text-xs text-[var(--color-text-muted)] font-mono">{f.key}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditFeaturesRole(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={saveEditFeatures}
                  disabled={savingFeatures}
                  variant="primary"
                  size="sm"
                >
                  {savingFeatures ? 'Saving…' : 'Save Features'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <UserPlus size={16} className="text-teal-600" /> Create User
              </h3>
              <button onClick={() => { setShowCreateUser(false); setCreateUserError(null) }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              {createUserError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{createUserError}</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Username</label>
                  <input required type="text" value={createUserForm.username}
                    onChange={e => setCreateUserForm(p => ({ ...p, username: e.target.value }))}
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="johndoe" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Full Name</label>
                  <input type="text" value={createUserForm.full_name}
                    onChange={e => setCreateUserForm(p => ({ ...p, full_name: e.target.value }))}
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="John Doe" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Email</label>
                <input required type="email" value={createUserForm.email}
                  onChange={e => setCreateUserForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="john@example.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Password</label>
                <input required type="password" value={createUserForm.password} minLength={8}
                  onChange={e => setCreateUserForm(p => ({ ...p, password: e.target.value }))}
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="Min 8 characters" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Role</label>
                <CustomSelect
                  value={createUserForm.role}
                  onChange={val => setCreateUserForm(p => ({ ...p, role: val }))}
                  options={assignableRoles.map(r => ({ value: r.name, label: `${r.label} (${r.name})` }))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => { setShowCreateUser(false); setCreateUserError(null) }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creatingUser} variant="primary" size="sm">
                  {creatingUser ? 'Creating…' : 'Create User'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
              <h3 className="font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <Plus size={16} className="text-teal-600" /> New Role
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                    Role key <span className="text-[var(--color-text-muted)] normal-case font-normal">(lowercase, underscores)</span>
                  </label>
                  <input
                    type="text"
                    required
                    pattern="[a-z0-9_]+"
                    value={createForm.name}
                    onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. nurse"
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Display label</label>
                  <input
                    type="text"
                    required
                    value={createForm.label}
                    onChange={e => setCreateForm(p => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Nurse"
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Description</label>
                <input
                  type="text"
                  value={createForm.description}
                  onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional description"
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Features <span className="text-[var(--color-text-muted)] normal-case font-normal">(select features to enable for this role)</span>
                </label>
                <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] max-h-52 overflow-y-auto">
                  {features.map(f => (
                    <label key={f.key} className="flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--color-bg)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createForm.feature_keys.includes(f.key)}
                        onChange={() => toggleFeature(f.key)}
                        className="mt-0.5 rounded border-[var(--color-border)] text-teal-600 accent-teal-600 focus:ring-teal-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text-main)]">{f.label}</div>
                        <div className="text-xs text-[var(--color-text-muted)] font-mono">{f.key}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Selected: {createForm.feature_keys.length} feature{createForm.feature_keys.length !== 1 ? 's' : ''}
                </p>
              </div>

              {createError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{createError}</div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={creating}
                  variant="primary"
                  size="sm"
                >
                  {creating ? 'Creating…' : 'Create Role'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CustomDialog
        isOpen={deleteRoleName !== null}
        onClose={() => setDeleteRoleName(null)}
        onConfirm={confirmDelete}
        title="Delete Role"
        description="Are you sure you want to delete this role? This removes it from all feature flags."
        itemName={deleteRoleName || undefined}
        isDeleting={isDeleting}
        type="delete"
      />
    </div>
  )
}

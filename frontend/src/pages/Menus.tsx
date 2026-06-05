import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, X, GripVertical, ExternalLink } from 'lucide-react'
import { configApi } from '@/lib/api'
import PageHeader from '@/components/PageHeader'
import { DynamicIcon } from '@/components/DynamicIcon'
import { Button } from '@/components/custom/Button'
import { CustomDialog } from '@/components/custom/CustomDialog'
import { CustomSelect } from '@/components/custom/CustomSelect'

interface NavItem {
  id: number; label: string; path: string; icon_name: string
  feature_key: string | null; order: number; is_external: boolean; category_id: number
}

interface NavCategory {
  id: number; title: string; order: number; is_admin_only: boolean; items: NavItem[]
}

const inputCls = "w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
const labelCls = "block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1"

const COMMON_ICONS = [
  'LayoutDashboard','Settings','Users','KeyRound','FileText','GitBranch','Cpu',
  'BrainCircuit','ToggleLeft','Webhook','Building2','History','FlaskConical',
  'BarChart2','Activity','AlertCircle','Database','Globe','Lock','ShieldCheck',
  'Zap','Box','BookOpen','Code','Terminal','ExternalLink','LineChart','Gauge',
]

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = COMMON_ICONS.filter(i => i.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={inputCls + " flex items-center gap-2 text-left"}>
        <DynamicIcon name={value || 'Box'} size={16} className="text-teal-600 shrink-0" />
        <span className="flex-1">{value || 'Pick icon'}</span>
        <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xl p-3">
          <input autoFocus placeholder="Search icons..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs mb-2 bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
          <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto">
            {filtered.map(icon => (
              <button key={icon} type="button" title={icon}
                onClick={() => { onChange(icon); setOpen(false); setSearch('') }}
                className={`p-2 rounded-lg flex items-center justify-center transition-all hover:bg-teal-50 ${value === icon ? 'bg-teal-100 ring-2 ring-teal-400' : ''}`}>
                <DynamicIcon name={icon} size={18} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Menus() {
  const [categories, setCategories] = useState<NavCategory[]>([])
  const [loading, setLoading] = useState(true)

  // Category form state
  const [showCatForm, setShowCatForm] = useState(false)
  const [editCat, setEditCat] = useState<NavCategory | null>(null)
  const [catForm, setCatForm] = useState({ title: '', order: 0, is_admin_only: false })

  // Item form state
  const [showItemForm, setShowItemForm] = useState(false)
  const [editItem, setEditItem] = useState<NavItem | null>(null)
  const [itemCatId, setItemCatId] = useState<number | null>(null)
  const [itemForm, setItemForm] = useState({
    label: '', path: '', icon_name: 'Box', feature_key: '', order: 0, is_external: false,
  })

  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [deleteCategoryId, setDeleteCategoryId] = useState<number | null>(null)
  const [isDeletingCat, setIsDeletingCat] = useState(false)
  const [deleteItemId, setDeleteItemId] = useState<number | null>(null)
  const [isDeletingItem, setIsDeletingItem] = useState(false)

  async function load() {
    setLoading(true)
    const res = await configApi.get('/navigation/admin/categories')
    setCategories(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function toggleExpand(id: number) {
    setExpandedCats(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // ── Category CRUD ───────────────────────────────────────────────────────────

  function openCreateCat() {
    setEditCat(null)
    setCatForm({ title: '', order: categories.length + 1, is_admin_only: true })
    setShowCatForm(true)
  }

  function openEditCat(cat: NavCategory) {
    setEditCat(cat)
    setCatForm({ title: cat.title, order: cat.order, is_admin_only: cat.is_admin_only })
    setShowCatForm(true)
  }

  async function saveCat(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editCat) {
        await configApi.patch(`/navigation/admin/categories/${editCat.id}`, catForm)
      } else {
        await configApi.post('/navigation/admin/categories', catForm)
      }
      setShowCatForm(false)
      await load()
    } finally { setSaving(false) }
  }

  async function confirmDeleteCat() {
    if (deleteCategoryId === null) return
    setIsDeletingCat(true)
    try {
      await configApi.delete(`/navigation/admin/categories/${deleteCategoryId}`)
      await load()
      setDeleteCategoryId(null)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDeletingCat(false)
    }
  }

  // ── Item CRUD ───────────────────────────────────────────────────────────────

  function openCreateItem(catId: number) {
    setEditItem(null)
    setItemCatId(catId)
    const cat = categories.find(c => c.id === catId)
    setItemForm({ label: '', path: '', icon_name: 'Box', feature_key: '', order: (cat?.items.length ?? 0) + 1, is_external: false })
    setShowItemForm(true)
  }

  function openEditItem(item: NavItem) {
    setEditItem(item)
    setItemCatId(item.category_id)
    setItemForm({
      label: item.label, path: item.path, icon_name: item.icon_name,
      feature_key: item.feature_key ?? '', order: item.order, is_external: item.is_external,
    })
    setShowItemForm(true)
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...itemForm, feature_key: itemForm.feature_key || null }
      if (editItem) {
        await configApi.patch(`/navigation/admin/items/${editItem.id}`, { ...payload, category_id: itemCatId })
      } else {
        await configApi.post(`/navigation/admin/categories/${itemCatId}/items`, payload)
      }
      setShowItemForm(false)
      await load()
    } finally { setSaving(false) }
  }

  async function confirmDeleteItem() {
    if (deleteItemId === null) return
    setIsDeletingItem(true)
    try {
      await configApi.delete(`/navigation/admin/items/${deleteItemId}`)
      await load()
      setDeleteItemId(null)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDeletingItem(false)
    }
  }

  return (
    <div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-4 animate-in fade-in duration-200">
        <PageHeader title="Menus" />
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)] font-medium">
            Manage sidebar navigation — categories and menu items. Changes take effect on next page load.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={openCreateCat}
            variant="primary"
            size="md"
            icon={<Plus size={16} />}
            className="whitespace-nowrap"
          >
            New Category
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--color-text-muted)] py-8 text-center">Loading...</div>
      ) : (
        <div className="space-y-4">
          {categories.map(cat => (
            <div key={cat.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
              
              <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
                <GripVertical size={16} className="text-[var(--color-text-muted)]" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-text-main)]">{cat.title}</span>
                    {cat.is_admin_only && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold uppercase">Admin only</span>
                    )}
                    <span className="text-[10px] text-[var(--color-text-muted)]">order: {cat.order} · {cat.items.length} item{cat.items.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <Button onClick={() => openCreateItem(cat.id)}
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={12} />}
                  className="!rounded-lg"
                >
                  Add Item
                </Button>
                <Button onClick={() => openEditCat(cat)}
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                >
                  Edit
                </Button>
                <button onClick={() => setDeleteCategoryId(cat.id)}
                  className="text-[var(--color-text-muted)] hover:text-red-500"><Trash2 size={14} /></button>
                <button onClick={() => toggleExpand(cat.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                  {expandedCats.has(cat.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              {/* Items list */}
              {expandedCats.has(cat.id) && (
                <div className="divide-y divide-slate-50">
                  {cat.items.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)] px-4 py-3">No items yet.</p>
                  ) : cat.items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-bg)] group">
                      <GripVertical size={14} className="text-[var(--color-text-muted)] shrink-0" />
                      <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center shrink-0">
                        <DynamicIcon name={item.icon_name} size={14} className="text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--color-text-main)]">{item.label}</span>
                          {item.is_external && <ExternalLink size={11} className="text-[var(--color-text-muted)]" />}
                          {item.feature_key && (
                            <code className="text-[10px] bg-[var(--color-bg)] text-[var(--color-text-muted)] px-1 rounded">{item.feature_key}</code>
                          )}
                        </div>
                        <span className="text-xs text-[var(--color-text-muted)] font-mono">{item.path}</span>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-muted)]">#{item.order}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditItem(item)}
                          className="text-xs px-2 py-1 bg-[var(--color-bg)] text-[var(--color-text-muted)] rounded hover:bg-[var(--color-border)]">Edit</button>
                        <button onClick={() => setDeleteItemId(item.id)}
                          className="text-[var(--color-text-muted)] hover:text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Category form modal */}
      {showCatForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h2 className="font-bold text-[var(--color-text-main)]">{editCat ? 'Edit Category' : 'New Category'}</h2>
              <button onClick={() => setShowCatForm(false)}><X size={18} className="text-[var(--color-text-muted)]" /></button>
            </div>
            <form onSubmit={saveCat} className="px-6 py-5 space-y-4">
              <div>
                <label className={labelCls}>Title *</label>
                <input required value={catForm.title} onChange={e => setCatForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="AI & Processing" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Order</label>
                  <input type="number" value={catForm.order} onChange={e => setCatForm(p => ({ ...p, order: Number(e.target.value) }))}
                    className={inputCls} />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={catForm.is_admin_only}
                      onChange={e => setCatForm(p => ({ ...p, is_admin_only: e.target.checked }))}
                      className="w-4 h-4 text-teal-600 accent-teal-600 focus:ring-teal-500 rounded cursor-pointer" />
                    <span className="text-sm text-[var(--color-text-muted)] font-medium">Admin only</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCatForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} variant="primary" size="sm">
                  {saving ? 'Saving...' : editCat ? 'Save' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      
      {showItemForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h2 className="font-bold text-[var(--color-text-main)]">{editItem ? 'Edit Menu Item' : 'New Menu Item'}</h2>
              <button onClick={() => setShowItemForm(false)}><X size={18} className="text-[var(--color-text-muted)]" /></button>
            </div>
            <form onSubmit={saveItem} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Label *</label>
                  <input required value={itemForm.label} onChange={e => setItemForm(p => ({ ...p, label: e.target.value }))}
                    placeholder="Grafana" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Order</label>
                  <input type="number" value={itemForm.order} onChange={e => setItemForm(p => ({ ...p, order: Number(e.target.value) }))}
                    className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Path / URL *</label>
                <input required value={itemForm.path} onChange={e => setItemForm(p => ({ ...p, path: e.target.value }))}
                  placeholder="/pipelines  or  http://localhost:3001" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Icon</label>
                <IconPicker value={itemForm.icon_name} onChange={v => setItemForm(p => ({ ...p, icon_name: v }))} />
              </div>
              <div>
                <label className={labelCls}>Feature Flag Key (optional)</label>
                <input value={itemForm.feature_key} onChange={e => setItemForm(p => ({ ...p, feature_key: e.target.value }))}
                  placeholder="pipeline_management" className={inputCls} />
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Item hidden if flag is off for this user's role</p>
              </div>
              <div>
                <label className={labelCls}>Category</label>
                <CustomSelect
                  value={itemCatId ? String(itemCatId) : ''}
                  onChange={val => setItemCatId(val ? Number(val) : null)}
                  options={categories.map(c => ({ value: String(c.id), label: c.title }))}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={itemForm.is_external}
                  onChange={e => setItemForm(p => ({ ...p, is_external: e.target.checked }))}
                  className="w-4 h-4 text-teal-600 accent-teal-600 focus:ring-teal-500 rounded cursor-pointer" />
                <div>
                  <span className="text-sm font-medium text-[var(--color-text-main)]">External link</span>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Opens in new tab (use full URL)</p>
                </div>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowItemForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} variant="primary" size="sm">
                  {saving ? 'Saving...' : editItem ? 'Save' : 'Add Item'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CustomDialog
        isOpen={deleteCategoryId !== null}
        onClose={() => setDeleteCategoryId(null)}
        onConfirm={confirmDeleteCat}
        title="Delete Category"
        description="Are you sure you want to permanently delete this category and all its items? This action is irreversible."
        itemName={deleteCategoryId !== null ? categories.find(c => c.id === deleteCategoryId)?.title : undefined}
        isDeleting={isDeletingCat}
        type="delete"
      />

      <CustomDialog
        isOpen={deleteItemId !== null}
        onClose={() => setDeleteItemId(null)}
        onConfirm={confirmDeleteItem}
        title="Delete Menu Item"
        description="Are you sure you want to permanently delete this menu item? This action is irreversible."
        itemName={deleteItemId !== null ? categories.flatMap(c => c.items).find(i => i.id === deleteItemId)?.label : undefined}
        isDeleting={isDeletingItem}
        type="delete"
      />
    </div>
  )
}

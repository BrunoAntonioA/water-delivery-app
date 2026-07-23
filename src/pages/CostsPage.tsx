import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  createCost,
  createCostCategory,
  deleteCost,
  deleteCostCategory,
  listCostCategories,
  listCosts,
  updateCost,
  type CostInput,
} from '../api/costs'
import type { CostWithCategory } from '../types/db'
import { formatMoney } from '../lib/format'
import { Modal } from '../components/Modal'
import {
  Button,
  Card,
  EmptyState,
  Label,
  Pagination,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui'

const PAGE_SIZE = 12

function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// "YYYY-MM-DD" -> "DD-MM-YYYY" (compacto para la tabla).
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

interface FormState {
  name: string
  description: string
  issue_date: string
  category_id: string
  amount: string
}

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  issue_date: today(),
  category_id: '',
  amount: '',
})

export default function CostsPage() {
  const qc = useQueryClient()
  const { data: costs, isLoading } = useQuery({
    queryKey: ['costs'],
    queryFn: listCosts,
  })
  const { data: categories } = useQuery({
    queryKey: ['cost_categories'],
    queryFn: listCostCategories,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [editing, setEditing] = useState<CostWithCategory | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [newCat, setNewCat] = useState('')
  const [page, setPage] = useState(1)

  // Filtros. categoryFilter: '' = todas, '__none__' = sin categoría, o un id.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const invalidateCosts = () =>
    qc.invalidateQueries({ queryKey: ['costs'] })
  const invalidateCats = () =>
    qc.invalidateQueries({ queryKey: ['cost_categories'] })

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: CostInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        issue_date: form.issue_date,
        category_id: form.category_id || null,
        amount: Number(form.amount) || 0,
      }
      return editing ? updateCost(editing.id, input) : createCost(input)
    },
    onSuccess: () => {
      invalidateCosts()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCost(id),
    onSuccess: invalidateCosts,
  })

  const addCatMutation = useMutation({
    mutationFn: () => createCostCategory(newCat.trim()),
    onSuccess: () => {
      invalidateCats()
      setNewCat('')
    },
  })

  const delCatMutation = useMutation({
    mutationFn: (id: string) => deleteCostCategory(id),
    onSuccess: () => {
      invalidateCats()
      invalidateCosts()
    },
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  function openEdit(c: CostWithCategory) {
    setEditing(c)
    setForm({
      name: c.name,
      description: c.description ?? '',
      issue_date: c.issue_date,
      category_id: c.category_id ?? '',
      amount: String(c.amount),
    })
    setModalOpen(true)
  }

  const filtered = useMemo(() => {
    return (costs ?? []).filter((c) => {
      if (fromDate && c.issue_date < fromDate) return false
      if (toDate && c.issue_date > toDate) return false
      if (categoryFilter === '') return true
      if (categoryFilter === '__none__') return c.category_id == null
      return c.category_id === categoryFilter
    })
  }, [costs, fromDate, toDate, categoryFilter])

  const totalSum = useMemo(
    () => filtered.reduce((s, c) => s + Number(c.amount), 0),
    [filtered]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const hasFilters = Boolean(fromDate || toDate || categoryFilter)
  function clearFilters() {
    setFromDate('')
    setToDate('')
    setCategoryFilter('')
    setPage(1)
  }

  const canSave = form.name.trim() && Number(form.amount) >= 0 && form.amount !== ''

  return (
    <div>
      <PageHeader
        title="Costos"
        subtitle="Registra los costos del negocio y clasifícalos por categoría."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCatModalOpen(true)}>
              Categorías
            </Button>
            <Button onClick={openNew}>+ Nuevo costo</Button>
          </div>
        }
      />

      {/* --- Filtros --- */}
      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Rango de fechas</Label>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPage(1)
                }}
                className="w-full sm:w-auto"
                aria-label="Desde"
              />
              <span className="hidden text-sm text-slate-400 sm:inline">a</span>
              <TextInput
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => {
                  setToDate(e.target.value)
                  setPage(1)
                }}
                className="w-full sm:w-auto"
                aria-label="Hasta"
              />
            </div>
          </div>
          <div>
            <Label>Categoría</Label>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">Todas</option>
              <option value="__none__">Sin categoría</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {hasFilters && (
          <div className="mt-3">
            <Button variant="ghost" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          </div>
        )}
      </Card>

      {/* --- Resumen --- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">
          {filtered.length} {filtered.length === 1 ? 'costo' : 'costos'}
        </span>
        <span className="font-semibold text-slate-900">
          Total: {formatMoney(totalSum)}
        </span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !costs || costs.length === 0 ? (
        <EmptyState>
          Aún no tienes costos. Agrega el primero con “Nuevo costo”.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No hay costos con esos filtros.</EmptyState>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                    <th className="w-px px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-slate-100 last:border-0 [&>td]:align-middle"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {shortDate(c.issue_date)}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {c.name}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.category?.name ?? 'Sin categoría'}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {c.description || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-800">
                        {formatMoney(c.amount)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="secondary"
                            onClick={() => openEdit(c)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => {
                              if (confirm(`¿Eliminar el costo "${c.name}"?`))
                                deleteMutation.mutate(c.id)
                            }}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPage={setPage}
          />
        </>
      )}

      {/* --- Modal crear/editar costo --- */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar costo' : 'Nuevo costo'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Nombre *</Label>
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Bencina camioneta"
              required
            />
          </div>
          <div>
            <Label>Descripción (opcional)</Label>
            <TextArea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={2}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Fecha *</Label>
              <TextInput
                type="date"
                value={form.issue_date}
                onChange={(e) =>
                  setForm({ ...form, issue_date: e.target.value })
                }
                required
              />
            </div>
            <div>
              <Label>Monto *</Label>
              <TextInput
                type="number"
                min="0"
                step="1"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
          </div>
          <div>
            <Label>Categoría</Label>
            <select
              value={form.category_id}
              onChange={(e) =>
                setForm({ ...form, category_id: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">Sin categoría</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            {categories && categories.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">
                No tienes categorías. Créalas con el botón “Categorías”.
              </p>
            )}
          </div>

          {saveMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(saveMutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave || saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --- Modal gestionar categorías --- */}
      <Modal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        title="Categorías de costo"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newCat.trim()) addCatMutation.mutate()
          }}
          className="mb-4 flex gap-2"
        >
          <TextInput
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            placeholder="Nueva categoría (ej: Combustible)"
          />
          <Button type="submit" disabled={!newCat.trim() || addCatMutation.isPending}>
            Agregar
          </Button>
        </form>

        {!categories || categories.length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay categorías.</p>
        ) : (
          <ul className="space-y-1">
            {categories.map((cat) => (
              <li
                key={cat.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="text-slate-800">{cat.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `¿Eliminar la categoría "${cat.name}"? Los costos con esta categoría quedarán sin categoría.`
                      )
                    )
                      delCatMutation.mutate(cat.id)
                  }}
                  className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  aria-label="Eliminar categoría"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}

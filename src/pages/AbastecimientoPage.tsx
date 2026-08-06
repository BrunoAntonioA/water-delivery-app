import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  createProvider,
  createSupplyPurchase,
  deleteProvider,
  deleteSupplyPurchase,
  listProviders,
  listSupplyPurchases,
  updateProvider,
  updateSupplyPurchase,
  type PurchaseInput,
} from '../api/abastecimiento'
import { createSupply, listSupplies } from '../api/supplies'
import type { Provider, SupplyPurchaseDetail } from '../types/db'
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
import { DateRangeFilter } from '../components/DateRangeFilter'

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

interface ItemRow {
  supply_id: string
  quantity: string
  unit_price: string
}

const emptyItem = (): ItemRow => ({ supply_id: '', quantity: '1', unit_price: '' })

interface FormState {
  provider_id: string
  purchase_date: string
  notes: string
  items: ItemRow[]
}

const emptyForm = (): FormState => ({
  provider_id: '',
  purchase_date: today(),
  notes: '',
  items: [emptyItem()],
})

function lineTotal(it: ItemRow): number {
  return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
}

export default function AbastecimientoPage() {
  const qc = useQueryClient()

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['supply_purchases'],
    queryFn: listSupplyPurchases,
  })
  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: listProviders,
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [provModalOpen, setProvModalOpen] = useState(false)
  const [editing, setEditing] = useState<SupplyPurchaseDetail | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [page, setPage] = useState(1)

  // Filtros.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [providerFilter, setProviderFilter] = useState('')

  // Alta rápida de proveedor dentro del formulario de abastecimiento.
  const [addingProvider, setAddingProvider] = useState(false)
  const [newProvName, setNewProvName] = useState('')
  const [newProvPhone, setNewProvPhone] = useState('')

  // Alta rápida de insumo (por si el insumo comprado aún no existe).
  const [newSupply, setNewSupply] = useState('')

  const invalidatePurchases = () =>
    qc.invalidateQueries({ queryKey: ['supply_purchases'] })
  const invalidateProviders = () =>
    qc.invalidateQueries({ queryKey: ['providers'] })
  const invalidateSupplies = () =>
    qc.invalidateQueries({ queryKey: ['supplies'] })

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: PurchaseInput = {
        provider_id: form.provider_id || null,
        purchase_date: form.purchase_date,
        notes: form.notes,
        items: form.items
          .filter((it) => it.supply_id && Number(it.quantity) > 0)
          .map((it) => ({
            supply_id: it.supply_id,
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price) || 0,
          })),
      }
      return editing
        ? updateSupplyPurchase(editing.id, input)
        : createSupplyPurchase(input)
    },
    onSuccess: () => {
      invalidatePurchases()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSupplyPurchase(id),
    onSuccess: invalidatePurchases,
  })

  // Alta de proveedor desde el formulario: lo crea y lo deja seleccionado.
  const addProviderMutation = useMutation({
    mutationFn: () => createProvider(newProvName, newProvPhone),
    onSuccess: (prov: Provider) => {
      invalidateProviders()
      setForm((f) => ({ ...f, provider_id: prov.id }))
      setAddingProvider(false)
      setNewProvName('')
      setNewProvPhone('')
    },
  })

  const addSupplyMutation = useMutation({
    mutationFn: () => createSupply(newSupply),
    onSuccess: (id: string) => {
      invalidateSupplies()
      // Coloca el insumo recién creado en la primera línea vacía (o agrega una).
      setForm((f) => {
        const idx = f.items.findIndex((it) => !it.supply_id)
        const items = [...f.items]
        if (idx >= 0) items[idx] = { ...items[idx], supply_id: id }
        else items.push({ ...emptyItem(), supply_id: id })
        return { ...f, items }
      })
      setNewSupply('')
    },
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm())
    setAddingProvider(false)
    setModalOpen(true)
  }

  function openEdit(p: SupplyPurchaseDetail) {
    setEditing(p)
    setForm({
      provider_id: p.provider_id ?? '',
      purchase_date: p.purchase_date,
      notes: p.notes ?? '',
      items:
        p.items.length > 0
          ? p.items.map((it) => ({
              supply_id: it.supply_id ?? '',
              quantity: String(it.quantity),
              unit_price: String(it.unit_price),
            }))
          : [emptyItem()],
    })
    setAddingProvider(false)
    setModalOpen(true)
  }

  function setItem(idx: number, patch: Partial<ItemRow>) {
    setForm((f) => {
      const items = [...f.items]
      items[idx] = { ...items[idx], ...patch }
      return { ...f, items }
    })
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }))
  }

  function removeItem(idx: number) {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }))
  }

  const modalTotal = useMemo(
    () => form.items.reduce((s, it) => s + lineTotal(it), 0),
    [form.items]
  )

  const filtered = useMemo(() => {
    return (purchases ?? []).filter((p) => {
      if (fromDate && p.purchase_date < fromDate) return false
      if (toDate && p.purchase_date > toDate) return false
      if (providerFilter === '') return true
      if (providerFilter === '__none__') return p.provider_id == null
      return p.provider_id === providerFilter
    })
  }, [purchases, fromDate, toDate, providerFilter])

  const totalSum = useMemo(
    () => filtered.reduce((s, p) => s + Number(p.total), 0),
    [filtered]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const hasFilters = Boolean(fromDate || toDate || providerFilter)
  function clearFilters() {
    setFromDate('')
    setToDate('')
    setProviderFilter('')
    setPage(1)
  }

  const validItems = form.items.filter(
    (it) => it.supply_id && Number(it.quantity) > 0
  )
  const canSave = Boolean(form.provider_id) && validItems.length > 0

  return (
    <div>
      <PageHeader
        title="Abastecimiento"
        subtitle="Registra las compras de insumos: proveedor, cantidad y precio de cada uno."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setProvModalOpen(true)}>
              Proveedores
            </Button>
            <Button onClick={openNew}>+ Nuevo abastecimiento</Button>
          </div>
        }
      />

      {/* --- Filtros --- */}
      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <DateRangeFilter
            from={fromDate}
            to={toDate}
            onChange={(f, t) => {
              setFromDate(f)
              setToDate(t)
              setPage(1)
            }}
            label="Fecha"
          />
          <div>
            <Label>Proveedor</Label>
            <select
              value={providerFilter}
              onChange={(e) => {
                setProviderFilter(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">Todos</option>
              <option value="__none__">Sin proveedor</option>
              {providers?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
          {filtered.length}{' '}
          {filtered.length === 1 ? 'abastecimiento' : 'abastecimientos'}
        </span>
        <span className="font-semibold text-slate-900">
          Total: {formatMoney(totalSum)}
        </span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !purchases || purchases.length === 0 ? (
        <EmptyState>
          Aún no registras abastecimientos. Agrega el primero con “Nuevo
          abastecimiento”.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No hay abastecimientos con esos filtros.</EmptyState>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-center text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Proveedor</th>
                    <th className="px-3 py-2 text-left">Insumos</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="w-px px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-slate-100 last:border-0 [&>td]:align-middle [&>td]:text-center"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {shortDate(p.purchase_date)}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {p.provider?.name ?? 'Sin proveedor'}
                      </td>
                      <td className="px-3 py-2 text-left text-slate-600">
                        <ul className="space-y-0.5">
                          {p.items.map((it) => (
                            <li key={it.id}>
                              <span className="text-slate-800">
                                {it.supply?.name ?? 'Insumo'}
                              </span>{' '}
                              <span className="text-slate-400">
                                · {it.quantity} × {formatMoney(it.unit_price)} ={' '}
                                {formatMoney(it.quantity * it.unit_price)}
                              </span>
                            </li>
                          ))}
                          {p.items.length === 0 && <li>—</li>}
                        </ul>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">
                        {formatMoney(p.total)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-center gap-1">
                          <Button variant="secondary" onClick={() => openEdit(p)}>
                            Editar
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => {
                              if (
                                confirm(
                                  `¿Eliminar el abastecimiento del ${shortDate(p.purchase_date)}${
                                    p.provider ? ` (${p.provider.name})` : ''
                                  }?`
                                )
                              )
                                deleteMutation.mutate(p.id)
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
          <Pagination page={currentPage} pageCount={pageCount} onPage={setPage} />
        </>
      )}

      {/* --- Modal crear/editar abastecimiento --- */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar abastecimiento' : 'Nuevo abastecimiento'}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) saveMutation.mutate()
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Fecha *</Label>
              <TextInput
                type="date"
                value={form.purchase_date}
                onChange={(e) =>
                  setForm({ ...form, purchase_date: e.target.value })
                }
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Proveedor *</Label>
                <button
                  type="button"
                  onClick={() => setAddingProvider((v) => !v)}
                  className="text-xs font-medium text-sky-600 hover:underline"
                >
                  {addingProvider ? 'Elegir existente' : '+ Nuevo'}
                </button>
              </div>
              {addingProvider ? (
                <div className="space-y-2">
                  <TextInput
                    value={newProvName}
                    onChange={(e) => setNewProvName(e.target.value)}
                    placeholder="Nombre del proveedor"
                  />
                  <TextInput
                    value={newProvPhone}
                    onChange={(e) => setNewProvPhone(e.target.value)}
                    placeholder="Teléfono (opcional)"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addProviderMutation.mutate()}
                    disabled={!newProvName.trim() || addProviderMutation.isPending}
                  >
                    {addProviderMutation.isPending
                      ? 'Creando…'
                      : 'Crear y seleccionar'}
                  </Button>
                </div>
              ) : (
                <select
                  value={form.provider_id}
                  onChange={(e) =>
                    setForm({ ...form, provider_id: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                >
                  <option value="">Selecciona un proveedor…</option>
                  {providers?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* --- Insumos --- */}
          <div>
            <Label>Insumos *</Label>

            {/* Encabezados de columna (sólo en pantallas medianas o más). */}
            <div className="mb-1 hidden grid-cols-[minmax(0,1fr)_5rem_8rem_10rem] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 sm:grid">
              <span></span>
              <span>Cantidad</span>
              <span>Precio c/u</span>
              <span className="text-right">Total</span>
            </div>

            <div className="space-y-2">
              {form.items.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_10rem] sm:items-center sm:border-0 sm:p-0"
                >
                  <select
                    value={it.supply_id}
                    onChange={(e) => setItem(idx, { supply_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="">Insumo…</option>
                    {supplies?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <TextInput
                    type="number"
                    min="1"
                    step="1"
                    value={it.quantity}
                    onChange={(e) => setItem(idx, { quantity: e.target.value })}
                    placeholder="Cantidad"
                    aria-label="Cantidad"
                  />
                  <TextInput
                    type="number"
                    min="0"
                    step="1"
                    value={it.unit_price}
                    onChange={(e) => setItem(idx, { unit_price: e.target.value })}
                    placeholder="Precio c/u"
                    aria-label="Precio unitario"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <span className="flex-1 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-slate-800 sm:flex-none">
                      {formatMoney(lineTotal(it))}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-40"
                      disabled={form.items.length <= 1}
                      aria-label="Quitar insumo"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M6 6l12 12M18 6L6 18"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <Button type="button" variant="ghost" onClick={addItem}>
                + Agregar insumo
              </Button>
              <span className="text-base font-bold text-slate-900">
                Total: {formatMoney(modalTotal)}
              </span>
            </div>

            {/* Alta rápida de un insumo que aún no existe. */}
            <div className="mt-3 flex gap-2">
              <TextInput
                value={newSupply}
                onChange={(e) => setNewSupply(e.target.value)}
                placeholder="¿Falta un insumo? Créalo aquí"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => addSupplyMutation.mutate()}
                disabled={!newSupply.trim() || addSupplyMutation.isPending}
              >
                {addSupplyMutation.isPending ? 'Creando…' : 'Crear insumo'}
              </Button>
            </div>
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <TextArea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
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

      {/* --- Modal gestionar proveedores --- */}
      <ProvidersModal
        open={provModalOpen}
        onClose={() => setProvModalOpen(false)}
        providers={providers ?? []}
        purchases={purchases ?? []}
        onChanged={() => {
          invalidateProviders()
          invalidatePurchases()
        }}
      />

      {/* Aviso si no hay insumos aún. */}
      {supplies && supplies.length === 0 && (
        <p className="mt-4 text-xs text-slate-400">
          Aún no tienes insumos. Puedes crearlos al registrar un abastecimiento o
          desde el módulo Productos.
        </p>
      )}
    </div>
  )
}

// --- Gestión de proveedores (crear / editar / eliminar) ---

function ProvidersModal({
  open,
  onClose,
  providers,
  purchases,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  providers: Provider[]
  purchases: SupplyPurchaseDetail[]
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  function reset() {
    setName('')
    setPhone('')
    setEditingId(null)
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? updateProvider(editingId, { name, phone })
        : createProvider(name, phone).then(() => undefined),
    onSuccess: () => {
      onChanged()
      reset()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProvider(id),
    onSuccess: onChanged,
  })

  const usageCount = (id: string) =>
    purchases.filter((p) => p.provider_id === id).length

  return (
    <Modal open={open} onClose={onClose} title="Proveedores">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) saveMutation.mutate()
        }}
        className="mb-4 space-y-2"
      >
        <div className="flex flex-wrap gap-2">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del proveedor"
            className="min-w-40 flex-1"
          />
          <TextInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Teléfono (opcional)"
            className="min-w-40 flex-1"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!name.trim() || saveMutation.isPending}>
            {saveMutation.isPending
              ? 'Guardando…'
              : editingId
                ? 'Guardar cambios'
                : 'Agregar proveedor'}
          </Button>
          {editingId && (
            <Button type="button" variant="secondary" onClick={reset}>
              Cancelar
            </Button>
          )}
        </div>
      </form>

      {providers.length === 0 ? (
        <p className="text-sm text-slate-400">Aún no hay proveedores.</p>
      ) : (
        <ul className="space-y-1">
          {providers.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-slate-800">{p.name}</span>
                {p.phone && (
                  <span className="ml-2 text-slate-400">{p.phone}</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(p.id)
                    setName(p.name)
                    setPhone(p.phone ?? '')
                  }}
                  className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const n = usageCount(p.id)
                    if (
                      confirm(
                        n > 0
                          ? `"${p.name}" está en ${n} abastecimiento(s). Si lo eliminas, esos quedarán "Sin proveedor". ¿Continuar?`
                          : `¿Eliminar el proveedor "${p.name}"?`
                      )
                    )
                      deleteMutation.mutate(p.id)
                  }}
                  className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  aria-label="Eliminar proveedor"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

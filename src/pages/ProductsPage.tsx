import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
  uploadProductImage,
  type ProductInput,
} from '../api/products'
import { createSupply, listSupplies } from '../api/supplies'
import type { Product } from '../types/db'
import { useAuth } from '../lib/auth'
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

// Cuántas tarjetas por fila (en pantallas grandes). Las clases deben ser
// literales para que Tailwind las incluya en el build.
const COL_OPTIONS = [3, 4, 6] as const
type Cols = (typeof COL_OPTIONS)[number]
const COL_CLASSES: Record<Cols, string> = {
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
}

interface SupplyRow {
  supply_id: string
  quantity: string
}

interface FormState {
  name: string
  description: string
  price: string
  image_url: string | null
  supplies: SupplyRow[]
  newSupply: string
}

const emptyForm: FormState = {
  name: '',
  description: '',
  price: '',
  image_url: null,
  supplies: [],
  newSupply: '',
}

export default function ProductsPage() {
  const qc = useQueryClient()
  const { company } = useAuth()
  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [uploading, setUploading] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState<Cols>(4)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = products ?? []
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all
  }, [products, search])

  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const invalidate = () => qc.invalidateQueries({ queryKey: ['products'] })

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: ProductInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        image_url: form.image_url,
        supplies: form.supplies
          .filter((s) => s.supply_id)
          .map((s) => ({
            supply_id: s.supply_id,
            quantity: Math.max(1, Math.trunc(Number(s.quantity) || 1)),
          })),
      }
      return editing ? updateProduct(editing.id, input) : createProduct(input)
    },
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  // Crear un insumo nuevo al vuelo desde el formulario del producto.
  const addSupplyMutation = useMutation({
    mutationFn: (name: string) => createSupply(name.trim()),
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['supplies'] })
      // Lo dejamos seleccionado en una fila nueva.
      setForm((f) => ({
        ...f,
        supplies: [...f.supplies, { supply_id: newId, quantity: '1' }],
        newSupply: '',
      }))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      image_url: p.image_url,
      supplies: (p.supplies ?? []).map((s) => ({
        supply_id: s.supply_id,
        quantity: String(s.quantity),
      })),
      newSupply: '',
    })
    setModalOpen(true)
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!company?.id) {
      alert('No se pudo determinar tu empresa. Vuelve a iniciar sesión.')
      return
    }
    setUploading(true)
    try {
      const url = await uploadProductImage(file, company.id)
      setForm((f) => ({ ...f, image_url: url }))
    } catch (err) {
      alert('Error al subir la imagen: ' + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const canSave = form.name.trim() && Number(form.price) >= 0

  function addSupplyRow() {
    setForm((f) => ({
      ...f,
      supplies: [...f.supplies, { supply_id: '', quantity: '1' }],
    }))
  }
  function updateSupplyRow(i: number, patch: Partial<SupplyRow>) {
    setForm((f) => ({
      ...f,
      supplies: f.supplies.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }))
  }
  function removeSupplyRow(i: number) {
    setForm((f) => ({
      ...f,
      supplies: f.supplies.filter((_, idx) => idx !== i),
    }))
  }

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle="Tu catálogo de bidones y productos de agua."
        action={<Button onClick={openNew}>+ Nuevo producto</Button>}
      />

      {isLoading ? (
        <Spinner />
      ) : !products || products.length === 0 ? (
        <EmptyState>
          Aún no tienes productos. Agrega el primero con “Nuevo producto”.
        </EmptyState>
      ) : (
        <>
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="w-full sm:max-w-xs">
              <Label>Buscar por nombre</Label>
              <TextInput
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Nombre del producto…"
                className="w-full"
              />
            </div>
            <div className="hidden lg:block">
              <Label>Por fila</Label>
              <div className="flex gap-1">
                {COL_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCols(n)}
                    className={`w-10 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      cols === n
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
        {filtered.length === 0 ? (
          <EmptyState>No hay productos con ese nombre.</EmptyState>
        ) : (
        <>
        <div className={`grid grid-cols-1 gap-4 ${COL_CLASSES[cols]}`}>
          {pageItems.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="flex h-40 items-center justify-center bg-slate-100">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-5xl">💧</span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="shrink-0 font-bold text-sky-700">
                    {formatMoney(p.price)}
                  </p>
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => openEdit(p)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`¿Eliminar ${p.name}?`))
                        deleteMutation.mutate(p.id)
                    }}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPage={setPage}
          />
        </>
        )}
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar producto' : 'Nuevo producto'}
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
              placeholder="Bidón 5 galones"
              required
            />
          </div>

          <div>
            <Label>Descripción</Label>
            <TextArea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={3}
            />
          </div>

          <div>
            <Label>Precio *</Label>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </div>

          <div>
            <Label>Insumos (para la carga de ruta)</Label>
            <div className="space-y-2">
              {form.supplies.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.supply_id}
                    onChange={(e) =>
                      updateSupplyRow(i, { supply_id: e.target.value })
                    }
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">Elegir insumo…</option>
                    {supplies?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={row.quantity}
                    onChange={(e) =>
                      updateSupplyRow(i, { quantity: e.target.value })
                    }
                    className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-right text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    aria-label="Cantidad"
                  />
                  <button
                    type="button"
                    onClick={() => removeSupplyRow(i)}
                    className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    aria-label="Quitar insumo"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addSupplyRow}
              className="mt-2 text-sm font-medium text-sky-600 hover:underline"
            >
              + Agregar insumo
            </button>

            <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
              <TextInput
                value={form.newSupply}
                onChange={(e) =>
                  setForm({ ...form, newSupply: e.target.value })
                }
                placeholder="¿Falta un insumo? Créalo (ej: Bidón 20L)"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={
                  !form.newSupply.trim() || addSupplyMutation.isPending
                }
                onClick={() => addSupplyMutation.mutate(form.newSupply)}
              >
                Crear
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Un producto puede tener varios insumos (ej: dispensador + bidón) o
              el mismo varias veces (ej: pack de 4). La carga de ruta se descuenta
              por insumo × cantidad.
            </p>
          </div>

          <div>
            <Label>Imagen</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                {form.image_url ? (
                  <img
                    src={form.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-3xl">💧</span>
                )}
              </div>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  disabled={uploading}
                  className="text-sm"
                />
                {uploading && (
                  <p className="mt-1 text-xs text-slate-500">Subiendo…</p>
                )}
                {form.image_url && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, image_url: null })}
                    className="mt-1 block text-xs text-red-600 hover:underline"
                  >
                    Quitar imagen
                  </button>
                )}
              </div>
            </div>
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
            <Button
              type="submit"
              disabled={!canSave || saveMutation.isPending || uploading}
            >
              {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

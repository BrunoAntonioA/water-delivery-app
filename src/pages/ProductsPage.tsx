import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
  uploadProductImage,
  type ProductInput,
} from '../api/products'
import type { Product } from '../types/db'
import { formatMoney } from '../lib/format'
import { Modal } from '../components/Modal'
import {
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui'

interface FormState {
  name: string
  description: string
  price: string
  image_url: string | null
}

const emptyForm: FormState = {
  name: '',
  description: '',
  price: '',
  image_url: null,
}

export default function ProductsPage() {
  const qc = useQueryClient()
  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [uploading, setUploading] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['products'] })

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: ProductInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        image_url: form.image_url,
      }
      return editing ? updateProduct(editing.id, input) : createProduct(input)
    },
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
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
    })
    setModalOpen(true)
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadProductImage(file)
      setForm((f) => ({ ...f, image_url: url }))
    } catch (err) {
      alert('Error al subir la imagen: ' + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const canSave = form.name.trim() && Number(form.price) >= 0

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
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

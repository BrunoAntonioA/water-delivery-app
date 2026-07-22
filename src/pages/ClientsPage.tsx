import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  createClient,
  deleteClient,
  listClients,
  updateClient,
  type AddressInput,
  type ClientInput,
} from '../api/clients'
import type { ClientWithAddresses } from '../types/db'
import { useAuth } from '../lib/auth'
import {
  buildContactMessage,
  clientTemplateContext,
  renderTemplate,
} from '../lib/whatsapp'
import { Modal } from '../components/Modal'
import { TemplatePicker } from '../components/TemplatePicker'
import {
  Button,
  Card,
  EmptyState,
  Label,
  Pagination,
  PageHeader,
  Spinner,
  TextInput,
} from '../components/ui'

const PAGE_SIZE = 15

const emptyAddress: AddressInput = {
  label: '',
  address: '',
  comuna: '',
  observation: '',
}

const emptyForm: ClientInput = {
  name: '',
  surname: '',
  national_id: '',
  phone: '',
  addresses: [{ ...emptyAddress }],
}

export default function ClientsPage() {
  const qc = useQueryClient()
  const { company } = useAuth()
  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ClientWithAddresses | null>(null)
  const [form, setForm] = useState<ClientInput>(emptyForm)

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [contactClient, setContactClient] = useState<ClientWithAddresses | null>(
    null
  )

  const filtered = useMemo(() => {
    const qStr = search.trim().toLowerCase()
    if (!qStr) return clients ?? []
    const qDigits = qStr.replace(/\D/g, '')
    return (clients ?? []).filter((c) => {
      const fullName = `${c.name} ${c.surname}`.toLowerCase()
      const phone = c.phone.toLowerCase()
      const phoneDigits = c.phone.replace(/\D/g, '')
      return (
        fullName.includes(qStr) ||
        phone.includes(qStr) ||
        (qDigits.length > 0 && phoneDigits.includes(qDigits))
      )
    })
  }, [clients, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['clients'] })

  const saveMutation = useMutation({
    mutationFn: () =>
      editing ? updateClient(editing.id, form) : createClient(form),
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClient(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(c: ClientWithAddresses) {
    setEditing(c)
    setForm({
      name: c.name,
      surname: c.surname,
      national_id: c.national_id ?? '',
      phone: c.phone,
      addresses:
        c.addresses.length > 0
          ? c.addresses.map((a) => ({
              id: a.id,
              label: a.label ?? '',
              address: a.address,
              comuna: a.comuna ?? '',
              observation: a.observation ?? '',
            }))
          : [{ ...emptyAddress }],
    })
    setModalOpen(true)
  }

  function updateAddress(i: number, patch: Partial<AddressInput>) {
    setForm((f) => ({
      ...f,
      addresses: f.addresses.map((a, idx) =>
        idx === i ? { ...a, ...patch } : a
      ),
    }))
  }

  function addAddressRow() {
    setForm((f) => ({
      ...f,
      addresses: [...f.addresses, { ...emptyAddress }],
    }))
  }

  function removeAddressRow(i: number) {
    setForm((f) => ({
      ...f,
      addresses: f.addresses.filter((_, idx) => idx !== i),
    }))
  }

  // Requiere al menos una dirección completa (dirección + comuna).
  const hasCompleteAddress = form.addresses.some(
    (a) => a.address.trim() && a.comuna.trim()
  )
  const canSave = Boolean(
    form.name.trim() &&
      form.surname.trim() &&
      form.phone.trim() &&
      hasCompleteAddress
  )

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Administra tus clientes y sus direcciones de entrega."
        action={<Button onClick={openNew}>+ Nuevo cliente</Button>}
      />

      {!isLoading && clients && clients.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TextInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Buscar por nombre o teléfono…"
            className="w-full sm:max-w-xs"
          />
          {search && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('')
                setPage(1)
              }}
            >
              Limpiar
            </Button>
          )}
          <span className="ml-auto text-sm text-slate-400">
            {filtered.length}{' '}
            {filtered.length === 1 ? 'cliente' : 'clientes'}
          </span>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : !clients || clients.length === 0 ? (
        <EmptyState>
          Aún no tienes clientes. Crea el primero con “Nuevo cliente”.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No hay clientes que coincidan con la búsqueda.</EmptyState>
      ) : (
        <>
          <div className="grid gap-3">
          {pageItems.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {c.name} {c.surname}
                  </p>
                  <p className="text-sm text-slate-500">
                    📞 {c.phone}
                    {c.national_id ? ` · 🪪 ${c.national_id}` : ''}
                  </p>
                  {c.addresses.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {c.addresses.map((a) => (
                        <li key={a.id}>
                          📍 {a.label ? `${a.label}: ` : ''}
                          {a.address}
                          {a.comuna ? `, ${a.comuna}` : ''}
                          {a.observation && (
                            <span className="block pl-5 text-xs italic text-slate-400">
                              {a.observation}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    onClick={() => setContactClient(c)}
                  >
                    Contactar
                  </Button>
                  <Button variant="secondary" onClick={() => openEdit(c)}>
                    Editar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (
                        confirm(`¿Eliminar a ${c.name} ${c.surname}?`)
                      )
                        deleteMutation.mutate(c.id)
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar cliente' : 'Nuevo cliente'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Nombre *</Label>
              <TextInput
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                required
              />
            </div>
            <div>
              <Label>Apellido *</Label>
              <TextInput
                value={form.surname}
                onChange={(e) =>
                  setForm({ ...form, surname: e.target.value })
                }
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Identificación (opcional)</Label>
              <TextInput
                value={form.national_id}
                onChange={(e) =>
                  setForm({ ...form, national_id: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Teléfono *</Label>
              <TextInput
                value={form.phone}
                onChange={(e) =>
                  setForm({ ...form, phone: e.target.value })
                }
                placeholder="+50688887777"
                required
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Direcciones *</Label>
              <button
                type="button"
                onClick={addAddressRow}
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                + Agregar dirección
              </button>
            </div>
            <div className="space-y-3">
              {form.addresses.map((a, i) => (
                <div
                  key={i}
                  className="relative rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                >
                  {form.addresses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeAddressRow(i)}
                      className="absolute right-2 top-2 rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Quitar dirección"
                    >
                      ✕
                    </button>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <TextInput
                      value={a.label}
                      onChange={(e) =>
                        updateAddress(i, { label: e.target.value })
                      }
                      placeholder="Etiqueta (Casa)"
                    />
                    <TextInput
                      value={a.comuna}
                      onChange={(e) =>
                        updateAddress(i, { comuna: e.target.value })
                      }
                      placeholder="Comuna *"
                    />
                  </div>
                  <TextInput
                    value={a.address}
                    onChange={(e) =>
                      updateAddress(i, { address: e.target.value })
                    }
                    placeholder="Dirección completa *"
                    className="mt-2"
                  />
                  <TextInput
                    value={a.observation}
                    onChange={(e) =>
                      updateAddress(i, { observation: e.target.value })
                    }
                    placeholder="Observaciones (opcional)"
                    className="mt-2"
                  />
                </div>
              ))}
            </div>
            {!hasCompleteAddress && (
              <p className="mt-2 text-sm text-amber-700">
                Agrega al menos una dirección con comuna.
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

      <TemplatePicker
        open={contactClient != null}
        onClose={() => setContactClient(null)}
        phone={contactClient?.phone ?? ''}
        title="Contactar por WhatsApp"
        buildMessage={(t) =>
          contactClient
            ? t
              ? renderTemplate(
                  t.content,
                  clientTemplateContext(
                    contactClient,
                    contactClient.addresses[0],
                    company?.name
                  )
                )
              : buildContactMessage(contactClient, company?.name)
            : ''
        }
      />
    </div>
  )
}

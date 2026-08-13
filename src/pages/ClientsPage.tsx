import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  createClient,
  eraseClientData,
  listClients,
  updateClient,
  type AddressInput,
  type ClientInput,
} from '../api/clients'
import type { ClientWithAddresses, PaymentPeriod } from '../types/db'
import { PAYMENT_PERIOD_LABELS } from '../types/db'
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
  payment_period: null,
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
  // Cliente pendiente de eliminación (confirmación en modal) y aviso posterior.
  const [eraseTarget, setEraseTarget] = useState<ClientWithAddresses | null>(
    null
  )
  const [notice, setNotice] = useState<string | null>(null)

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
    mutationFn: async () => {
      if (editing) await updateClient(editing.id, form)
      else await createClient(form)
    },
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const eraseMutation = useMutation({
    mutationFn: (id: string) => eraseClientData(id),
    onSuccess: (result) => {
      invalidate()
      setNotice(
        result === 'deleted'
          ? 'Cliente eliminado.'
          : 'Se eliminaron los datos personales del cliente. Se conservó su historial de pedidos, ya anonimizado.'
      )
      setEraseTarget(null)
    },
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
      payment_period: c.payment_period,
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
    form.name.trim() && form.phone.trim() && hasCompleteAddress
  )

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Administra tus clientes y sus direcciones de entrega."
        action={<Button onClick={openNew}>+ Nuevo cliente</Button>}
      />

      {notice && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span>✓ {notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 text-emerald-600 hover:text-emerald-800"
          >
            ✕
          </button>
        </div>
      )}

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
          {pageItems.map((c) => {
            const erased = Boolean(c.anonymized_at)
            return (
            <Card key={c.id} className={`p-4 ${erased ? 'opacity-60' : ''}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0 sm:flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    <span className="break-words">
                      {c.name} {c.surname}
                    </span>
                    {erased && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Datos eliminados
                      </span>
                    )}
                    {c.payment_period && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                        🗓️ {PAYMENT_PERIOD_LABELS[c.payment_period]}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-500 break-words">
                    📞 {c.phone || '—'}
                    {c.national_id ? ` · 🪪 ${c.national_id}` : ''}
                  </p>
                  {c.addresses.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {c.addresses.map((a) => (
                        <li key={a.id} className="break-words">
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
                {!erased && (
                  <div className="flex flex-wrap gap-2 sm:shrink-0">
                    <Button
                      variant="success"
                      onClick={() => setContactClient(c)}
                    >
                      Contactar
                    </Button>
                    <Button variant="secondary" onClick={() => openEdit(c)}>
                      Editar
                    </Button>
                    <Button variant="danger" onClick={() => setEraseTarget(c)}>
                      Eliminar datos
                    </Button>
                  </div>
                )}
              </div>
            </Card>
            )
          })}
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
              <Label>Apellido</Label>
              <TextInput
                value={form.surname}
                onChange={(e) =>
                  setForm({ ...form, surname: e.target.value })
                }
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
            <Label>Período de cobro (opcional)</Label>
            <select
              value={form.payment_period ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  payment_period: (e.target.value || null) as
                    | PaymentPeriod
                    | null,
                })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Sin período (cobro al momento)</option>
              {(
                Object.keys(PAYMENT_PERIOD_LABELS) as PaymentPeriod[]
              ).map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
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
                  <TextInput
                    value={a.address}
                    onChange={(e) =>
                      updateAddress(i, { address: e.target.value })
                    }
                    placeholder="Dirección completa *"
                  />
                  <TextInput
                    value={a.comuna}
                    onChange={(e) =>
                      updateAddress(i, { comuna: e.target.value })
                    }
                    placeholder="Comuna *"
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

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
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

      {/* Eliminar datos del cliente (derecho de supresión) */}
      <Modal
        open={eraseTarget != null}
        onClose={() => setEraseTarget(null)}
        title="Eliminar datos del cliente"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Vas a eliminar los datos personales de{' '}
            <span className="font-semibold">
              {eraseTarget ? `${eraseTarget.name} ${eraseTarget.surname}` : ''}
            </span>{' '}
            (nombre, teléfono, identificación y direcciones).
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Si el cliente tiene pedidos, el historial se conserva pero queda
            anonimizado (no se puede borrar por razones contables). Si no tiene
            pedidos, se elimina por completo. Esta acción no se puede deshacer.
          </p>
          {eraseMutation.isError && (
            <p className="text-sm text-red-600">
              Error: {(eraseMutation.error as Error).message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEraseTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={eraseMutation.isPending}
              onClick={() => eraseTarget && eraseMutation.mutate(eraseTarget.id)}
            >
              {eraseMutation.isPending ? 'Eliminando…' : 'Eliminar datos'}
            </Button>
          </div>
        </div>
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

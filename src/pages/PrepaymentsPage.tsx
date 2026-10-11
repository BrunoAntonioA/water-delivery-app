import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listClients } from '../api/clients'
import { listProducts } from '../api/products'
import {
  cancelPrepaymentPending,
  createPrepayment,
  listPrepaymentUsage,
  listPrepayments,
  prepaymentLines,
  refundPrepayment,
  updatePrepayment,
  type PrepaymentLine,
} from '../api/prepayments'
import type { PaymentMethod, Prepayment } from '../types/db'
import { formatDatePart, formatMoney } from '../lib/format'
import { invalidateOrdersAndRoutes } from '../lib/queryInvalidation'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { ClientCombobox } from '../components/ClientCombobox'
import { QuickClientForm } from '../components/QuickClientForm'
import { Modal } from '../components/Modal'
import { PAYMENT_LABELS } from '../components/StatusBadge'
import {
  Button,
  Card,
  EmptyState,
  Label,
  NumberInput,
  PageHeader,
  Spinner,
  TextArea,
} from '../components/ui'

interface DraftLine {
  product_id: string
  quantity: number
}

type StatusFilter = 'active' | 'all'

/** Estado de un prepago según su saldo. */
function statusOf(p: Prepayment, lines: PrepaymentLine[]) {
  if (p.refunded_at) return 'refunded' as const
  const open = lines.some((l) => l.available > 0 || l.scheduled > 0)
  return open ? ('active' as const) : ('completed' as const)
}

/**
 * Prepagos: el cliente paga productos por adelantado y se le entregan de a poco.
 * Aquí se registran (ingreso del día), se ve el saldo por producto y se cancelan
 * entregas pendientes o se anula el prepago con devolución.
 */
export default function PrepaymentsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const offline = !useOnlineStatus()

  const { data: prepayments, isLoading, error } = useQuery({
    queryKey: ['prepayments'],
    queryFn: listPrepayments,
  })
  const { data: usage } = useQuery({
    queryKey: ['prepayment-usage'],
    queryFn: listPrepaymentUsage,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [filterClientId, setFilterClientId] = useState('')

  const rows = useMemo(() => {
    return (prepayments ?? [])
      .map((p) => {
        const lines = prepaymentLines(p, usage ?? [])
        return { p, lines, status: statusOf(p, lines) }
      })
      .filter((r) => !filterClientId || r.p.client_id === filterClientId)
      .filter((r) => statusFilter === 'all' || r.status === 'active')
  }, [prepayments, usage, filterClientId, statusFilter])

  // Tras cancelar/anular: refrescar prepagos y TODAS las vistas de pedidos y
  // rutas (se eliminan o modifican pedidos).
  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['prepayments'] })
    invalidateOrdersAndRoutes(qc)
  }

  // --- Nuevo / editar prepago ---
  const [modalOpen, setModalOpen] = useState(false)
  // Prepago en edición (null = nuevo) y cuánto ya se usó de cada producto
  // (entregado + programado): es el mínimo al que se puede bajar.
  const [editing, setEditing] = useState<Prepayment | null>(null)
  const [usedByProduct, setUsedByProduct] = useState<Map<string, number>>(
    () => new Map()
  )
  const [clientId, setClientId] = useState('')
  // Lo escrito en el buscador al elegir "Registrar cliente nuevo"; null = cerrado.
  const [newClientQuery, setNewClientQuery] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [amount, setAmount] = useState(0)
  const [amountTouched, setAmountTouched] = useState(false)
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [notes, setNotes] = useState('')

  const priceOf = useMemo(() => {
    const m = new Map<string, number>()
    products?.forEach((p) => m.set(p.id, Number(p.price)))
    return m
  }, [products])

  const validDraft = draft.filter((d) => d.product_id && d.quantity > 0)
  const listTotal = validDraft.reduce(
    (s, d) => s + d.quantity * (priceOf.get(d.product_id) ?? 0),
    0
  )
  // El monto pagado parte en el total de lista; se puede ajustar (descuento).
  const paidAmount = amountTouched ? amount : listTotal
  const usedOf = (productId: string) => usedByProduct.get(productId) ?? 0
  // Al editar: el cliente queda fijo si el prepago ya tiene entregas.
  const hasUsage = Array.from(usedByProduct.values()).some((n) => n > 0)
  // Ningún producto con uso puede faltar ni quedar por debajo de lo usado.
  const coversUsage = Array.from(usedByProduct).every(
    ([pid, used]) =>
      used === 0 ||
      validDraft
        .filter((d) => d.product_id === pid)
        .reduce((s, d) => s + d.quantity, 0) >= used
  )
  const canSave =
    Boolean(clientId) &&
    validDraft.length > 0 &&
    paidAmount >= 0 &&
    (paidAmount === 0 || Boolean(method)) &&
    coversUsage

  function openNew() {
    setEditing(null)
    setUsedByProduct(new Map())
    setNewClientQuery(null)
    setClientId(filterClientId)
    setDraft([{ product_id: '', quantity: 1 }])
    setAmount(0)
    setAmountTouched(false)
    setMethod('')
    setNotes('')
    setModalOpen(true)
  }

  function openEdit(p: Prepayment, lines: PrepaymentLine[]) {
    setEditing(p)
    setNewClientQuery(null)
    setUsedByProduct(
      new Map(lines.map((l) => [l.product_id, l.delivered + l.scheduled]))
    )
    setClientId(p.client_id)
    setDraft(
      p.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity }))
    )
    setAmount(Number(p.total))
    setAmountTouched(true)
    setMethod(p.payments[0]?.method ?? '')
    setNotes(p.notes ?? '')
    setModalOpen(true)
  }

  // "Crear entrega": abre el formulario de Pedidos con el cliente elegido y su
  // prepago listo. Al crear se queda en Pedidos; al cancelar vuelve aquí.
  function createDelivery(p: Prepayment) {
    navigate('/pedidos', { state: { prepaidOrderClientId: p.client_id } })
  }

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setDraft((l) => l.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const input = {
        client_id: clientId,
        items: validDraft,
        total: paidAmount,
        payments:
          paidAmount > 0 && method
            ? [{ method: method as PaymentMethod, amount: paidAmount }]
            : [],
        notes,
      }
      if (editing) await updatePrepayment(editing.id, input)
      else await createPrepayment(input)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prepayments'] })
      qc.invalidateQueries({ queryKey: ['prepayment-usage'] })
      setModalOpen(false)
    },
  })

  // --- Cancelar entregas pendientes / anular ---
  const [cancelTarget, setCancelTarget] = useState<{
    p: Prepayment
    lines: PrepaymentLine[]
  } | null>(null)
  const [refundTarget, setRefundTarget] = useState<{
    p: Prepayment
    lines: PrepaymentLine[]
  } | null>(null)

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelPrepaymentPending(id),
    onSuccess: () => {
      refreshAll()
      setCancelTarget(null)
    },
  })
  const refundMutation = useMutation({
    mutationFn: (id: string) => refundPrepayment(id),
    onSuccess: () => {
      refreshAll()
      setRefundTarget(null)
    },
  })

  const clientName = (p: Prepayment) =>
    p.client ? `${p.client.name} ${p.client.surname}`.trim() : 'Cliente'
  const methodsText = (p: Prepayment) =>
    p.payments.map((x) => PAYMENT_LABELS[x.method]).join(' + ') ||
    'Sin pago'
  const sum = (lines: PrepaymentLine[], k: 'delivered' | 'scheduled') =>
    lines.reduce((s, l) => s + l[k], 0)

  return (
    <div>
      <Link
        to="/pedidos"
        className="mb-4 inline-block text-sm text-sky-600 hover:underline"
      >
        ← Volver a pedidos
      </Link>
      <PageHeader
        title="Prepagos"
        subtitle="Productos pagados por adelantado que se entregan de a poco."
        action={
          <Button
            onClick={openNew}
            disabled={!products?.length || offline}
            title={offline ? 'Sin conexión' : undefined}
          >
            + Nuevo prepago
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Cliente</Label>
            <ClientCombobox
              clients={clients ?? []}
              value={filterClientId}
              onChange={setFilterClientId}
            />
          </div>
          <div>
            <Label>Mostrar</Label>
            <div className="flex gap-1">
              {(
                [
                  ['active', 'Vigentes'],
                  ['all', 'Todos'],
                ] as [StatusFilter, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStatusFilter(v)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    statusFilter === v
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          No se pudieron cargar los prepagos: {(error as Error).message}
        </p>
      ) : isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>
          {statusFilter === 'active'
            ? 'No hay prepagos vigentes.'
            : 'No hay prepagos registrados.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map(({ p, lines, status }) => (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {clientName(p)}
                  </p>
                  <p className="text-sm text-slate-500">
                    Pagado {formatDatePart(p.paid_at)} ·{' '}
                    <span className="font-medium text-slate-700">
                      {formatMoney(Number(p.total))}
                    </span>{' '}
                    · {methodsText(p)}
                  </p>
                  {p.notes && (
                    <p className="mt-0.5 text-sm italic text-slate-500">
                      “{p.notes}”
                    </p>
                  )}
                </div>
                {status === 'refunded' ? (
                  <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-semibold text-white">
                    Anulado · devolución {formatMoney(Number(p.refund_amount))}{' '}
                    el {formatDatePart(p.refunded_at!)}
                  </span>
                ) : status === 'completed' ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Completado
                  </span>
                ) : (
                  <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                    Vigente
                  </span>
                )}
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="py-1.5 pr-3">Producto</th>
                      <th className="px-2 py-1.5 text-right">Comprado</th>
                      <th className="px-2 py-1.5 text-right">Entregado</th>
                      <th className="px-2 py-1.5 text-right">Programado</th>
                      <th className="py-1.5 pl-2 text-right">Disponible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr
                        key={l.product_id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="py-1.5 pr-3 text-slate-700">
                          {l.productName}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {l.purchased}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {l.delivered}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {l.scheduled}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-semibold tabular-nums text-violet-700">
                          {l.available}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {status !== 'refunded' && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button
                    onClick={() => createDelivery(p)}
                    disabled={!lines.some((l) => l.available > 0) || offline}
                    title={
                      lines.some((l) => l.available > 0)
                        ? undefined
                        : 'No queda saldo disponible'
                    }
                  >
                    + Crear entrega
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => openEdit(p, lines)}
                    disabled={offline}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setCancelTarget({ p, lines })}
                    disabled={sum(lines, 'scheduled') === 0 || offline}
                    title={
                      sum(lines, 'scheduled') === 0
                        ? 'No hay entregas pendientes'
                        : undefined
                    }
                  >
                    Cancelar entregas pendientes
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setRefundTarget({ p, lines })}
                    disabled={offline}
                    className="text-red-700"
                  >
                    Eliminar prepago (devolución)
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Nuevo / editar prepago */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar prepago' : 'Nuevo prepago'}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) createMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Cliente *</Label>
            {editing && hasUsage ? (
              // Con entregas, el prepago queda amarrado a su cliente.
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {clientName(editing)}
                </span>
                <span className="block text-xs text-slate-500">
                  No se puede cambiar: el prepago ya tiene entregas.
                </span>
              </div>
            ) : newClientQuery !== null ? (
              <QuickClientForm
                initialQuery={newClientQuery}
                onCreated={({ id }) => {
                  setClientId(id)
                  setNewClientQuery(null)
                }}
                onCancel={() => setNewClientQuery(null)}
              />
            ) : (
              <ClientCombobox
                clients={clients ?? []}
                value={clientId}
                onChange={setClientId}
                onCreateNew={(q) => setNewClientQuery(q)}
              />
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Productos pagados *</Label>
              <button
                type="button"
                onClick={() =>
                  setDraft((l) => [...l, { product_id: '', quantity: 1 }])
                }
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                + Agregar producto
              </button>
            </div>
            <div className="space-y-2">
              {draft.map((d, i) => {
                // Línea con entregas (al editar): el producto queda fijo y la
                // cantidad no puede bajar de lo ya entregado + programado.
                const used =
                  editing &&
                  i === draft.findIndex((x) => x.product_id === d.product_id)
                    ? usedOf(d.product_id)
                    : 0
                return (
                <div key={i}>
                <div className="flex items-center gap-2">
                  <select
                    value={d.product_id}
                    onChange={(e) => updateLine(i, { product_id: e.target.value })}
                    disabled={used > 0}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-600"
                  >
                    <option value="">Producto…</option>
                    {products?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatMoney(p.price)})
                      </option>
                    ))}
                  </select>
                  <div className="w-20 shrink-0">
                    <NumberInput
                      min={Math.max(1, used)}
                      value={d.quantity}
                      onValueChange={(n) =>
                        updateLine(i, { quantity: Math.max(n, used) })
                      }
                      className="text-center"
                    />
                  </div>
                  {draft.length > 1 && used === 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((l) => l.filter((_, idx) => idx !== i))
                      }
                      className="shrink-0 rounded-lg px-2 py-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Quitar producto"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {used > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Mínimo {used}: ya entregados o programados.
                  </p>
                )}
                </div>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Monto pagado *</Label>
              <NumberInput
                min={0}
                value={paidAmount}
                onValueChange={(n) => {
                  setAmount(n)
                  setAmountTouched(true)
                }}
              />
              <p className="mt-1 text-xs text-slate-500">
                Precio de lista: {formatMoney(listTotal)}
                {amountTouched && paidAmount !== listTotal && (
                  <>
                    {' '}
                    ·{' '}
                    <button
                      type="button"
                      onClick={() => setAmountTouched(false)}
                      className="text-sky-600 hover:underline"
                    >
                      usar precio de lista
                    </button>
                  </>
                )}
              </p>
            </div>
            <div>
              <Label>Método de pago {paidAmount > 0 ? '*' : ''}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['efectivo', 'transferencia', 'tarjeta'] as PaymentMethod[]).map(
                  (m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                        method === m
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {PAYMENT_LABELS[m]}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {editing
              ? `Es una corrección: si cambias el monto, el ingreso se ajusta en su fecha de pago original (${formatDatePart(editing.paid_at)}).`
              : 'El ingreso se registra hoy. Después, al crear un pedido para este cliente, podrás agregar estos productos sin cobrarlos.'}
          </p>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(createMutation.error as Error).message}
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
            <Button
              type="submit"
              disabled={!canSave || createMutation.isPending || offline}
            >
              {createMutation.isPending
                ? 'Guardando…'
                : editing
                  ? 'Guardar cambios'
                  : 'Registrar prepago'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmar: cancelar entregas pendientes */}
      <Modal
        open={cancelTarget != null}
        onClose={() => setCancelTarget(null)}
        title="Cancelar entregas pendientes"
      >
        {cancelTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Se cancelarán las{' '}
              <strong>{sum(cancelTarget.lines, 'scheduled')} unidades</strong>{' '}
              programadas y aún no entregadas del prepago de{' '}
              <strong>{clientName(cancelTarget.p)}</strong>.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>
                Los pedidos que sólo tenían productos de este prepago se
                eliminan (y salen de sus rutas).
              </li>
              <li>
                Los pedidos que además tenían otros productos se conservan, sin
                las líneas del prepago.
              </li>
              <li>Lo ya entregado y el dinero no cambian.</li>
            </ul>
            {cancelMutation.isError && (
              <p className="text-sm text-red-600">
                Error: {(cancelMutation.error as Error).message}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" onClick={() => setCancelTarget(null)}>
                Volver
              </Button>
              <Button
                onClick={() => cancelMutation.mutate(cancelTarget.p.id)}
                disabled={cancelMutation.isPending || offline}
              >
                {cancelMutation.isPending ? 'Cancelando…' : 'Cancelar pendientes'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmar: eliminar prepago completo (devolución) */}
      <Modal
        open={refundTarget != null}
        onClose={() => setRefundTarget(null)}
        title="Eliminar prepago"
      >
        {refundTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Se eliminará el prepago de{' '}
              <strong>{clientName(refundTarget.p)}</strong> y se registrará una{' '}
              <strong>
                devolución de {formatMoney(Number(refundTarget.p.total))}
              </strong>{' '}
              con fecha de hoy.
            </p>
            <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">
              ⚠️ También se eliminarán <strong>todas</strong> sus entregas:{' '}
              {sum(refundTarget.lines, 'scheduled')} unidades pendientes y{' '}
              <strong>
                {sum(refundTarget.lines, 'delivered')} ya entregadas
              </strong>
              . Los pedidos que además tenían otros productos se conservan, sin
              las líneas del prepago. Esto no se puede deshacer.
            </div>
            {refundMutation.isError && (
              <p className="text-sm text-red-600">
                Error: {(refundMutation.error as Error).message}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" onClick={() => setRefundTarget(null)}>
                Volver
              </Button>
              <Button
                variant="danger"
                onClick={() => refundMutation.mutate(refundTarget.p.id)}
                disabled={refundMutation.isPending || offline}
              >
                {refundMutation.isPending
                  ? 'Eliminando…'
                  : 'Eliminar y registrar devolución'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createRoute,
  deleteRoute,
  listRoutes,
  type RouteInput,
  type RouteSummary,
} from '../api/routes'
import { formatDateOnly } from '../lib/format'
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

const PAGE_SIZE = 10

function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function RoutesPage() {
  const qc = useQueryClient()
  const { data: routes, isLoading } = useQuery({
    queryKey: ['routes'],
    queryFn: listRoutes,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<RouteInput>({
    name: '',
    route_date: today(),
    driver: '',
    notes: '',
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['routes'] })

  const createMutation = useMutation({
    mutationFn: () => createRoute(form),
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoute(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setForm({ name: '', route_date: today(), driver: '', notes: '' })
    setModalOpen(true)
  }

  const [dateFilter, setDateFilter] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(
    () =>
      (routes ?? []).filter((r) => !dateFilter || r.route_date === dateFilter),
    [routes, dateFilter]
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  return (
    <div>
      <PageHeader
        title="Rutas"
        subtitle="Organiza los pedidos por ruta de reparto y ordénalos arrastrando."
        action={<Button onClick={openNew}>+ Nueva ruta</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Filtrar por día:</span>
        <TextInput
          type="date"
          value={dateFilter}
          onChange={(e) => {
            setDateFilter(e.target.value)
            setPage(1)
          }}
          className="w-auto"
        />
        {dateFilter && (
          <Button
            variant="ghost"
            onClick={() => {
              setDateFilter('')
              setPage(1)
            }}
          >
            Limpiar
          </Button>
        )}
        <span className="ml-auto text-sm text-slate-400">
          {filtered.length} {filtered.length === 1 ? 'ruta' : 'rutas'}
        </span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState>
          {dateFilter
            ? 'No hay rutas para ese día.'
            : 'Aún no tienes rutas. Crea la primera con “Nueva ruta”.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3">
            {pageItems.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link to={`/rutas/${r.id}`} className="min-w-0 flex-1 group">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 group-hover:text-sky-700">
                        {r.name || 'Ruta sin nombre'}
                      </p>
                      <RouteStatusBadge route={r} />
                    </div>
                    <p className="text-sm capitalize text-slate-500">
                      📅 {formatDateOnly(r.route_date)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                      {r.driver && <span>🚚 {r.driver}</span>}
                      <CountChip
                        label="Entregados"
                        done={r.deliveredCount}
                        total={r.stopCount}
                      />
                      <CountChip
                        label="Pagados"
                        done={r.paidCount}
                        total={r.stopCount}
                      />
                    </div>
                  </Link>
                  <div className="flex gap-2">
                    <Link to={`/rutas/${r.id}`}>
                      <Button variant="secondary">Abrir</Button>
                    </Link>
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (confirm('¿Eliminar esta ruta?'))
                          deleteMutation.mutate(r.id)
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
        title="Nueva ruta"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nombre</Label>
              <TextInput
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ruta Norte"
              />
            </div>
            <div>
              <Label>Fecha *</Label>
              <TextInput
                type="date"
                value={form.route_date}
                onChange={(e) =>
                  setForm({ ...form, route_date: e.target.value })
                }
                required
              />
            </div>
          </div>

          <div>
            <Label>Repartidor</Label>
            <TextInput
              value={form.driver}
              onChange={(e) => setForm({ ...form, driver: e.target.value })}
              placeholder="Nombre del repartidor"
            />
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <TextArea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              Error al crear: {(createMutation.error as Error).message}
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
              disabled={!form.route_date || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creando…' : 'Crear ruta'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

/** Estado general de la ruta según sus pedidos. */
function RouteStatusBadge({ route }: { route: RouteSummary }) {
  const { stopCount, deliveredCount, paidCount } = route
  let label: string
  let cls: string
  if (stopCount === 0) {
    label = 'Sin pedidos'
    cls = 'bg-slate-100 text-slate-500'
  } else if (paidCount === stopCount) {
    label = 'Todo pagado'
    cls = 'bg-emerald-100 text-emerald-800'
  } else if (deliveredCount === stopCount) {
    label = 'Todo entregado'
    cls = 'bg-sky-100 text-sky-800'
  } else if (deliveredCount > 0) {
    label = 'En reparto'
    cls = 'bg-amber-100 text-amber-800'
  } else {
    label = 'Pendiente'
    cls = 'bg-slate-100 text-slate-600'
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

/** Chip "Entregados 3/5" que se pone verde al completarse. */
function CountChip({
  label,
  done,
  total,
}: {
  label: string
  done: number
  total: number
}) {
  const complete = total > 0 && done === total
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        complete ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {label} {done}/{total}
    </span>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  listRouteLoadEvents,
  saveRouteLoads,
  type RouteLoadKind,
} from '../api/routes'
import type { ProductSupplyLink, RouteDetail, Supply } from '../types/db'
import { Button, Card, EmptyState } from './ui'

const KIND_LABEL: Record<RouteLoadKind, string> = {
  inicial: 'Carga inicial',
  adicional: 'Carga adicional',
  ajuste: 'Ajuste de carga',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Carga inicial de la ruta: qué y cuánto salió en el camión, por INSUMO. Muestra
 * cargado, entregado y restante por insumo, y permite registrar/editar la carga.
 */
export function RouteLoadSection({
  route,
  supplies,
  soldBySupply,
  onSaved,
  startEditing,
  canEdit,
  addOnly = false,
}: {
  route: RouteDetail
  supplies: Supply[]
  soldBySupply: Map<string, number>
  onSaved: () => void
  startEditing: boolean
  /** Si es false, sólo se muestra el resumen (sin registrar/editar). */
  canEdit: boolean
  /**
   * Si es true, el formulario SÓLO suma a la carga actual (no permite reducir
   * ni sobrescribir). Se usa para el repartidor: puede agregar más carga, pero
   * no modificar la existente.
   */
  addOnly?: boolean
}) {
  const loadMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of route.loads ?? []) m.set(l.supply_id, l.quantity)
    return m
  }, [route.loads])

  const qc = useQueryClient()
  // Modo del panel: resumen, editar (fijar el total) o agregar (sumar). El
  // repartidor (addOnly) sólo puede agregar; el admin puede editar Y agregar.
  const [mode, setMode] = useState<'summary' | 'edit' | 'add'>(
    startEditing && canEdit ? (addOnly ? 'add' : 'edit') : 'summary'
  )
  const editing = mode !== 'summary'
  const isAdd = mode === 'add'
  const [draft, setDraft] = useState<Record<string, string>>({})

  // Historial de cargas de esta ruta (inicial + adicionales).
  const { data: events } = useQuery({
    queryKey: ['route-load-events', route.id],
    queryFn: () => listRouteLoadEvents(route.id),
  })

  const supplyNames = useMemo(
    () => new Map(supplies.map((s) => [s.id, s.name])),
    [supplies]
  )

  // Al entrar en modo edición precargamos: en "editar" (admin) las cantidades
  // actuales; en "agregar" (repartidor) se parte de vacío (lo que se suma).
  useEffect(() => {
    if (!editing) return
    const d: Record<string, string> = {}
    for (const s of supplies) {
      d[s.id] = isAdd ? '' : String(loadMap.get(s.id) ?? 0)
    }
    setDraft(d)
  }, [editing, supplies, loadMap, isAdd])

  const saveMutation = useMutation({
    mutationFn: () => {
      // Cantidades tecleadas en esta acción (para el historial).
      const entered = supplies
        .map((s) => ({
          supply_id: s.id,
          quantity: Math.max(0, Math.trunc(Number(draft[s.id]) || 0)),
        }))
        .filter((it) => it.quantity > 0)
      // Total resultante que se guarda en route_loads.
      const finalItems = supplies.map((s) => {
        const typed = Math.max(0, Math.trunc(Number(draft[s.id]) || 0))
        const current = loadMap.get(s.id) ?? 0
        // "Agregar" suma a lo que ya había; "editar" fija el valor absoluto.
        return { supply_id: s.id, quantity: isAdd ? current + typed : typed }
      })
      // Tipo de carga: adicional (se suma), inicial (primera vez) o ajuste
      // (se edita una carga ya confirmada).
      const kind: RouteLoadKind = isAdd
        ? 'adicional'
        : route.load_confirmed
          ? 'ajuste'
          : 'inicial'
      return saveRouteLoads(route.id, finalItems, { kind, items: entered })
    },
    onSuccess: () => {
      onSaved()
      qc.invalidateQueries({ queryKey: ['route-load-events', route.id] })
      setMode('summary')
    },
    onError: (err) =>
      alert(`No se pudo guardar la carga: ${(err as Error).message}`),
  })

  const rows = useMemo(() => {
    const ids = new Set<string>([...loadMap.keys(), ...soldBySupply.keys()])
    const nameMap = new Map(supplies.map((s) => [s.id, s.name]))
    return Array.from(ids)
      .map((id) => {
        const loaded = loadMap.get(id) ?? 0
        const sold = soldBySupply.get(id) ?? 0
        return {
          id,
          name: nameMap.get(id) ?? 'Insumo',
          loaded,
          sold,
          remaining: loaded - sold,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [loadMap, soldBySupply, supplies])

  // --- Modo edición / registro ---
  if (editing) {
    return (
      <Card className="p-4">
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
          <span aria-hidden>🛒</span>{' '}
          {isAdd
            ? 'Agregar a la carga'
            : route.load_confirmed
              ? 'Editar la carga'
              : 'Carga inicial de la ruta'}
        </h2>
        <p className="mb-3 text-sm text-slate-500">
          {isAdd
            ? 'Indica cuántas unidades ADICIONALES salieron en el camión. Se sumarán a la carga actual.'
            : 'Indica cuántas unidades de cada insumo salieron en el camión.'}
        </p>
        {supplies.length === 0 ? (
          <EmptyState>
            No hay insumos. Crea insumos y asígnalos a tus productos en la
            sección Productos.
          </EmptyState>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              saveMutation.mutate()
            }}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {supplies.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-slate-700">
                    {s.name}
                    {isAdd && (
                      <span className="ml-1 text-xs text-slate-400">
                        (actual: {loadMap.get(s.id) ?? 0})
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft[s.id] ?? (isAdd ? '' : '0')}
                    placeholder={isAdd ? '0' : undefined}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [s.id]: e.target.value }))
                    }
                    className="w-20 shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {route.load_confirmed && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode('summary')}
                >
                  Cancelar
                </Button>
              )}
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending
                  ? 'Guardando…'
                  : isAdd
                    ? 'Agregar a la carga'
                    : 'Guardar carga'}
              </Button>
            </div>
          </form>
        )}
      </Card>
    )
  }

  // --- Modo resumen ---
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <span className="flex items-center gap-2 font-semibold text-slate-900">
          <span aria-hidden>🛒</span> Carga de la ruta
        </span>
        {canEdit &&
          (addOnly ? (
            // Repartidor: sólo puede sumar carga.
            <Button variant="secondary" onClick={() => setMode('add')}>
              Agregar carga
            </Button>
          ) : !route.load_confirmed ? (
            // Aún sin carga: registrar la inicial.
            <Button variant="secondary" onClick={() => setMode('edit')}>
              Registrar carga
            </Button>
          ) : (
            // Admin con carga ya confirmada: puede agregar o editar el total.
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMode('add')}>
                Agregar carga
              </Button>
              <Button variant="secondary" onClick={() => setMode('edit')}>
                Editar carga
              </Button>
            </div>
          ))}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-500">
          Aún no se registró la carga inicial.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2">Insumo</th>
                <th className="px-4 py-2 text-right">Cargado</th>
                <th className="px-4 py-2 text-right">Entregado</th>
                <th className="px-4 py-2 text-right">Restante</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-2 text-slate-800">{r.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                    {r.loaded}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {r.sold}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-medium tabular-nums ${
                      r.remaining < 0 ? 'text-red-600' : 'text-slate-900'
                    }`}
                  >
                    {r.remaining}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-slate-700">
            Historial de cargas
          </p>
          <ul className="space-y-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    {KIND_LABEL[ev.kind]}
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtDateTime(ev.created_at)}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-slate-600">
                  {ev.items
                    .map(
                      (it) =>
                        `${supplyNames.get(it.supply_id) ?? 'Insumo'}: ${it.quantity}`
                    )
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/**
 * Calcula cuánto se entregó de cada insumo en una ruta, a partir de sus paradas
 * y del mapa producto→insumos (cada uno con su cantidad). Sólo cuenta pedidos
 * entregados o pagados. Entregar N de un producto descuenta N × cantidad de cada
 * insumo que lo compone.
 */
export function soldBySupplyOf(
  route: RouteDetail,
  productSupply: Map<string, ProductSupplyLink[]>
): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of route.stops ?? []) {
    const o = s.order
    if (!o || o.status !== 'delivered') continue
    for (const it of o.items) {
      const links = productSupply.get(it.product_id)
      if (!links) continue
      for (const link of links) {
        m.set(
          link.supply_id,
          (m.get(link.supply_id) ?? 0) + it.quantity * link.quantity
        )
      }
    }
  }
  return m
}

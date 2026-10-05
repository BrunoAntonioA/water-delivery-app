import { useMemo } from 'react'
import type { ProductSupplyLink, RouteStopWithOrder } from '../types/db'
import { routeSupplyNeeds } from '../lib/order'
import { Card } from './ui'

/**
 * Tabla de insumos que necesita una ruta: por insumo, el TOTAL de todos los
 * pedidos y el RESTANTE por entregar (total − entregados). Se calcula en el
 * cliente a partir del BOM de los productos; no hace consultas. No muestra nada
 * si la ruta no consume insumos.
 */
export function RouteSupplyNeeds({
  stops,
  productSupplies,
  supplyName,
  className,
}: {
  stops: RouteStopWithOrder[]
  productSupplies: Map<string, ProductSupplyLink[]>
  supplyName: Map<string, string>
  className?: string
}) {
  const needs = useMemo(
    () =>
      routeSupplyNeeds(stops, productSupplies).sort((a, b) =>
        (supplyName.get(a.supply_id) ?? '').localeCompare(
          supplyName.get(b.supply_id) ?? ''
        )
      ),
    [stops, productSupplies, supplyName]
  )

  if (needs.length === 0) return null

  return (
    <section className={className}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <span aria-hidden>🧰</span>
        <span>Insumos necesarios para la ruta</span>
      </h2>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2 text-right">Total ruta</th>
                <th className="px-3 py-2 text-right">Entregados</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">
                  Restante por entregar
                </th>
              </tr>
            </thead>
            <tbody>
              {needs.map((n) => (
                <tr
                  key={n.supply_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-3 py-2 text-slate-700">
                    {supplyName.get(n.supply_id) ?? 'Insumo'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {n.total}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {n.total - n.remaining}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {n.remaining}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  )
}

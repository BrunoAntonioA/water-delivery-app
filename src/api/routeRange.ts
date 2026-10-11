import { supabase } from '../lib/supabase'
import type { DateRange } from '../lib/dateRange'

// Para filtrar por FECHA DE RUTA en el servidor se resuelven primero los ids de
// las rutas del rango (filtro simple por columna) y luego se consultan sus
// paradas/cargas con `in`. Así se evitan filtros sobre tablas anidadas.

const PAGE = 1000
// Ids por consulta `in` (la URL tiene un largo máximo).
export const ID_CHUNK = 100

/** Ids de las rutas cuya fecha de ruta cae en el rango ('' = sin límite). */
export async function routeIdsInRange(range: DateRange): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('routes').select('id')
    if (range.from) q = q.gte('route_date', range.from)
    if (range.to) q = q.lte('route_date', range.to)
    const { data, error } = await q
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as { id: string }[]
    ids.push(...batch.map((r) => r.id))
    if (batch.length < PAGE) break
  }
  return ids
}

/** Parte una lista en tandas de `size`. */
export function chunks<T>(list: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

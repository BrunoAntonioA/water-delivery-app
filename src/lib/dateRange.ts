// Rangos de fechas de los reportes. Las fechas son 'YYYY-MM-DD' en hora LOCAL
// (la misma convención que toLocalDateStr) y '' = sin límite. Los reportes
// arrancan en el mes actual y filtran EN EL SERVIDOR: así cada apertura baja
// ~1 mes de datos en vez de todo el historial (ahorro de egress).

export interface DateRange {
  from: string
  to: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Mes calendario completo: 0 = el actual, -1 = el anterior. */
export function monthRange(offset = 0, now = new Date()): DateRange {
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: ymd(first), to: ymd(last) }
}

export const currentMonthRange = () => monthRange(0)

/** Sin límite de fechas: todo el historial (descarga todo). */
export const ALL_TIME: DateRange = { from: '', to: '' }

export const sameRange = (a: DateRange, b: DateRange) =>
  a.from === b.from && a.to === b.to

/**
 * 00:00 LOCAL del día 'YYYY-MM-DD', en ISO, para filtrar columnas timestamp
 * (created_at) con el mismo corte de día que se usa en pantalla.
 */
export function localDayStartISO(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** 00:00 LOCAL del día SIGUIENTE (límite exclusivo del "hasta"). */
export function localNextDayStartISO(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d + 1).toISOString()
}

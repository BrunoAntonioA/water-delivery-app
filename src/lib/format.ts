const CURRENCY = (import.meta.env.VITE_CURRENCY as string) || 'USD'
const LOCALE = (import.meta.env.VITE_LOCALE as string) || 'es-CR'

export function formatMoney(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
  }).format(value ?? 0)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

/** Para fechas sin hora ("YYYY-MM-DD"), evitando corrimientos de zona horaria. */
export function formatDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full' }).format(date)
}

/** Devuelve la fecha local ("YYYY-MM-DD") de un timestamp ISO. */
export function toLocalDateStr(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

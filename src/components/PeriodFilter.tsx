import { useState } from 'react'
import { ALL_TIME, monthRange, type DateRange } from '../lib/dateRange'
import { formatDateShort, formatMonthYear } from '../lib/format'
import { InfoHint, TextInput } from './ui'

const PRESETS: [string, () => DateRange][] = [
  ['Este mes', () => monthRange(0)],
  ['Mes anterior', () => monthRange(-1)],
  ['Todo', () => ALL_TIME],
]

// Mismo estilo que los demás filtros de "pastillas" (Estado, Pago, Método).
const chip = (active: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium transition-colors ${
    active
      ? 'bg-sky-600 text-white'
      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  }`

/** ¿El rango es un mes calendario completo? */
function isWholeMonth(from: string, to: string): boolean {
  if (!from || !to) return false
  const [y, m] = from.split('-').map(Number)
  const r = monthRange(0, new Date(y, m - 1, 1))
  return r.from === from && r.to === to
}

/** Texto del período elegido: "Octubre de 2026", "01-10-2026 – 15-10-2026"… */
function periodText(from: string, to: string): string {
  if (!from && !to) return 'Todo el historial (puede tardar más en cargar)'
  if (isWholeMonth(from, to)) {
    const t = formatMonthYear(from)
    return t.charAt(0).toUpperCase() + t.slice(1)
  }
  if (from && to) return `${formatDateShort(from)} – ${formatDateShort(to)}`
  return from ? `Desde ${formatDateShort(from)}` : `Hasta ${formatDateShort(to)}`
}

/**
 * Filtro de PERÍODO de los reportes: atajos (Este mes / Mes anterior / Todo) y
 * "Personalizado" para elegir fechas. `from`/`to` son 'YYYY-MM-DD' ('' = sin
 * límite). Las fechas sólo se muestran en "Personalizado"; si no, se muestra el
 * período elegido en texto.
 */
export function PeriodFilter({
  from,
  to,
  onChange,
  label = 'Período',
  hint,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  label?: string
  hint?: string
}) {
  const matched =
    PRESETS.find(([, r]) => {
      const range = r()
      return range.from === from && range.to === to
    })?.[0] ?? null
  // "Personalizado" queda abierto aunque las fechas coincidan con un atajo
  // mientras el usuario las está eligiendo.
  const [custom, setCustom] = useState(() => !matched)
  const showCustom = custom || !matched

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {hint && <InfoHint text={hint} />}
      </div>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([name, r]) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setCustom(false)
              const range = r()
              onChange(range.from, range.to)
            }}
            className={chip(!showCustom && matched === name)}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustom(true)
            // Desde "Todo" se parte con el mes actual para no dejar fechas vacías.
            if (!from && !to) {
              const m = monthRange(0)
              onChange(m.from, m.to)
            }
          }}
          className={chip(showCustom)}
        >
          Personalizado
        </button>
      </div>

      {showCustom ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TextInput
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onChange(e.target.value, to)}
            className="w-full sm:w-auto"
            aria-label="Desde"
          />
          <span className="hidden text-sm text-slate-400 sm:inline">a</span>
          <TextInput
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onChange(from, e.target.value)}
            className="w-full sm:w-auto"
            aria-label="Hasta"
          />
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500">{periodText(from, to)}</p>
      )}
    </div>
  )
}

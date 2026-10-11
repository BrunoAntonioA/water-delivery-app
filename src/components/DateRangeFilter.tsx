import { useState } from 'react'
import { ALL_TIME, monthRange, type DateRange } from '../lib/dateRange'
import { InfoHint, TextInput } from './ui'

/**
 * Filtro de fecha con un interruptor "Rango":
 * - Apagado → un solo selector (un día): from y to quedan iguales.
 * - Encendido → dos selectores (desde / hasta).
 * El consumidor mantiene `from` y `to` como strings 'YYYY-MM-DD' (o '').
 * Con `presets` muestra atajos: Este mes / Mes anterior / Todo.
 */
export function DateRangeFilter({
  from,
  to,
  onChange,
  label = 'Fecha',
  hint,
  presets = false,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  label?: string
  hint?: string
  presets?: boolean
}) {
  // Se infiere el modo inicial: si hay un "hasta" distinto del "desde", o no
  // hay fechas (todo el período), es rango.
  const [range, setRange] = useState(
    () => Boolean(from && to && from !== to) || (presets && !from && !to)
  )

  const presetList: [string, DateRange][] = [
    ['Este mes', monthRange(0)],
    ['Mes anterior', monthRange(-1)],
    ['Todo', ALL_TIME],
  ]

  function toggle() {
    const next = !range
    setRange(next)
    // Al volver a "un día", se colapsa a una sola fecha (la de "desde").
    if (!next) {
      const day = from || to
      onChange(day, day)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {hint && <InfoHint text={hint} />}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={range}
          onClick={toggle}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500"
          title="Alternar entre un día y un rango de fechas"
        >
          <span>Rango</span>
          <span
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              range ? 'bg-sky-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                range ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
      </div>

      {presets && (
        <div className="mb-2 flex flex-wrap gap-1">
          {presetList.map(([name, r]) => {
            const active = from === r.from && to === r.to
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setRange(true)
                  onChange(r.from, r.to)
                }}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={
                  r === ALL_TIME
                    ? 'Todo el historial (descarga más datos)'
                    : undefined
                }
              >
                {name}
              </button>
            )
          })}
        </div>
      )}

      {range ? (
        <div className="flex flex-wrap items-center gap-2">
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
        <TextInput
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, e.target.value)}
          className="w-full sm:w-auto"
          aria-label="Día"
        />
      )}
    </div>
  )
}

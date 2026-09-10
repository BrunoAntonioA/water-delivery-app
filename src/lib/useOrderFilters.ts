import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { OrderStatus, PaymentMethod, PaymentPeriod } from '../types/db'

// Filtros del módulo de Pedidos guardados EN LA URL (query params), no en memoria.
// Así, cuando el teléfono descarta y recarga la página al volver desde WhatsApp,
// los filtros y la página se reconstruyen solos desde la URL. Además, quedan
// enlazables y sobreviven a un refresco manual.

export type StatusFilter = 'all' | OrderStatus
export type PaidFilter = 'all' | 'paid' | 'unpaid'
export type PaymentFilter = 'all' | PaymentMethod
export type PeriodFilter = 'all' | 'none' | PaymentPeriod

export interface OrderFilters {
  q: string
  clientId: string
  from: string
  to: string
  status: StatusFilter
  paid: PaidFilter
  method: PaymentFilter
  period: PeriodFilter
  page: number
}

const DEFAULTS: OrderFilters = {
  q: '',
  clientId: '',
  from: '',
  to: '',
  status: 'all',
  paid: 'all',
  method: 'all',
  period: 'all',
  page: 1,
}

// Nombre de cada filtro como parámetro de la URL (más corto y legible).
const PARAM: Record<keyof OrderFilters, string> = {
  q: 'q',
  clientId: 'cliente',
  from: 'desde',
  to: 'hasta',
  status: 'estado',
  paid: 'pago',
  method: 'metodo',
  period: 'periodo',
  page: 'pagina',
}

export function useOrderFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = useMemo<OrderFilters>(() => {
    const pageRaw = Number.parseInt(searchParams.get(PARAM.page) ?? '', 10)
    return {
      q: searchParams.get(PARAM.q) ?? DEFAULTS.q,
      clientId: searchParams.get(PARAM.clientId) ?? DEFAULTS.clientId,
      from: searchParams.get(PARAM.from) ?? DEFAULTS.from,
      to: searchParams.get(PARAM.to) ?? DEFAULTS.to,
      status: (searchParams.get(PARAM.status) as StatusFilter) ?? DEFAULTS.status,
      paid: (searchParams.get(PARAM.paid) as PaidFilter) ?? DEFAULTS.paid,
      method: (searchParams.get(PARAM.method) as PaymentFilter) ?? DEFAULTS.method,
      period: (searchParams.get(PARAM.period) as PeriodFilter) ?? DEFAULTS.period,
      page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : DEFAULTS.page,
    }
  }, [searchParams])

  // Aplica varios cambios de filtro en UNA sola escritura a la URL. Importante:
  // react-router entrega al updater los params del render actual, así que hay que
  // agrupar todos los cambios de un handler aquí (varias llamadas se pisarían).
  // replace: true → no llena el historial del navegador con cada cambio.
  const setFilters = useCallback(
    (patch: Partial<OrderFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const key of Object.keys(patch) as (keyof OrderFilters)[]) {
            const value = patch[key]
            const param = PARAM[key]
            const str = String(value)
            if (value === DEFAULTS[key] || str === '') next.delete(param)
            else next.set(param, str)
          }
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const reset = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const param of Object.values(PARAM)) next.delete(param)
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const hasFilters =
    filters.q !== DEFAULTS.q ||
    filters.clientId !== DEFAULTS.clientId ||
    filters.from !== DEFAULTS.from ||
    filters.to !== DEFAULTS.to ||
    filters.status !== DEFAULTS.status ||
    filters.paid !== DEFAULTS.paid ||
    filters.method !== DEFAULTS.method ||
    filters.period !== DEFAULTS.period

  return { filters, setFilters, reset, hasFilters }
}

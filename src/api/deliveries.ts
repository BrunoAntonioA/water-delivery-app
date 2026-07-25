import { supabase } from '../lib/supabase'

/** Una fila del resumen: cuánto entregó un repartidor de un producto. */
export interface DeliverySummaryRow {
  driver_id: string
  driver_name: string
  product_id: string
  product_name: string
  total_quantity: number
}

/**
 * Resumen de entregas por repartidor y producto, filtrado por rango de fechas
 * (de la ruta). El backend aplica el aislamiento por rol: un repartidor sólo
 * recibe sus propias entregas aunque pase otro `driverId`.
 */
export async function getDeliverySummary(params: {
  driverId?: string | null
  from?: string | null
  to?: string | null
}): Promise<DeliverySummaryRow[]> {
  const { data, error } = await supabase.rpc('delivery_summary', {
    p_driver_id: params.driverId || null,
    p_from: params.from || null,
    p_to: params.to || null,
  })
  if (error) throw error
  return (data ?? []) as DeliverySummaryRow[]
}

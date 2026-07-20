import type { OrderDetail } from '../types/db'
import { formatMoney } from './format'

// Nombre de tu empresa que aparecerá en el mensaje de cobro.
const COMPANY_NAME =
  (import.meta.env.VITE_COMPANY_NAME as string) || 'Distribuidora de Agua'

/** Deja sólo dígitos del teléfono (wa.me no acepta "+", espacios ni guiones). */
export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '')
}

/** Construye el texto de cobro con el detalle del pedido. */
export function buildChargeMessage(order: OrderDetail): string {
  const clientName = order.client
    ? `${order.client.name} ${order.client.surname}`.trim()
    : 'Cliente'

  const lines: string[] = []
  lines.push(`Hola ${clientName}, le saluda *${COMPANY_NAME}*.`)
  lines.push('')
  lines.push(
    order.status === 'delivered'
      ? 'Le compartimos el detalle de su pedido *entregado*:'
      : 'Le compartimos el detalle de su pedido:'
  )
  lines.push('')

  for (const item of order.items) {
    const productName = item.product?.name ?? 'Producto'
    const lineTotal = item.quantity * item.unit_price
    lines.push(
      `• ${item.quantity} x ${productName} — ${formatMoney(lineTotal)}`
    )
  }

  lines.push('')
  lines.push(`*Total a pagar: ${formatMoney(order.total)}*`)

  if (order.address) {
    const comuna = order.address.comuna ? `, ${order.address.comuna}` : ''
    lines.push('')
    lines.push(`Dirección de entrega: ${order.address.address}${comuna}`)
  }

  lines.push('')
  lines.push('¡Gracias por su preferencia! 💧')

  return lines.join('\n')
}

/** URL de WhatsApp (wa.me) con el mensaje de cobro pre-cargado. */
export function buildWhatsAppUrl(order: OrderDetail): string | null {
  const phone = normalizePhone(order.client?.phone ?? '')
  if (!phone) return null
  const text = encodeURIComponent(buildChargeMessage(order))
  return `https://wa.me/${phone}?text=${text}`
}

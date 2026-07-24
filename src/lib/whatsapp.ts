import type { Address, Client, OrderDetail } from '../types/db'
import { formatMoney } from './format'

// Nombre de empresa por defecto (si aún no se cargó la empresa del usuario).
const FALLBACK_COMPANY =
  (import.meta.env.VITE_COMPANY_NAME as string) || 'nuestra empresa'

/** Deja sólo dígitos del teléfono (wa.me no acepta "+", espacios ni guiones). */
export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '')
}

/** Variables que se pueden usar en las plantillas. */
export const TEMPLATE_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: '{cliente}', label: 'Nombre del cliente' },
  { key: '{empresa}', label: 'Nombre de la empresa' },
  { key: '{telefono}', label: 'Teléfono del cliente' },
  { key: '{direccion}', label: 'Dirección' },
  { key: '{detalle}', label: 'Detalle de productos (pedidos)' },
  { key: '{total}', label: 'Total del pedido (pedidos)' },
]

export interface TemplateContext {
  cliente: string
  empresa: string
  telefono: string
  direccion: string
  detalle: string
  total: string
}

/** Reemplaza las variables {..} de una plantilla con los valores del contexto. */
export function renderTemplate(content: string, ctx: TemplateContext): string {
  return content
    .replaceAll('{cliente}', ctx.cliente)
    .replaceAll('{empresa}', ctx.empresa)
    .replaceAll('{telefono}', ctx.telefono)
    .replaceAll('{direccion}', ctx.direccion)
    .replaceAll('{detalle}', ctx.detalle)
    .replaceAll('{total}', ctx.total)
}

function addressText(a: Address | null | undefined): string {
  if (!a) return ''
  return [a.address, a.comuna].filter(Boolean).join(', ')
}

/** Contexto de plantilla a partir de un pedido. */
export function orderTemplateContext(
  order: OrderDetail,
  companyName?: string
): TemplateContext {
  const detalle = order.items
    .map(
      (it) =>
        `• ${it.quantity} x ${it.product?.name ?? 'Producto'} — ${formatMoney(
          it.quantity * it.unit_price
        )}`
    )
    .join('\n')
  return {
    cliente: order.client
      ? `${order.client.name} ${order.client.surname}`.trim()
      : order.customer_name?.trim() || 'Cliente',
    empresa: companyName || FALLBACK_COMPANY,
    telefono: order.client?.phone ?? '',
    direccion: addressText(order.address),
    detalle,
    total: formatMoney(order.total),
  }
}

/** Contexto de plantilla a partir de un cliente (sin pedido). */
export function clientTemplateContext(
  client: Client,
  address?: Address | null,
  companyName?: string
): TemplateContext {
  return {
    cliente: `${client.name} ${client.surname}`.trim(),
    empresa: companyName || FALLBACK_COMPANY,
    telefono: client.phone ?? '',
    direccion: addressText(address),
    detalle: '',
    total: '',
  }
}

/** Mensaje por defecto para contactar a un cliente (sin plantilla). */
export function buildContactMessage(client: Client, companyName?: string): string {
  const name = `${client.name} ${client.surname}`.trim() || 'Cliente'
  return `Hola ${name}, le saluda *${companyName || FALLBACK_COMPANY}*.`
}

/** Arma la URL de wa.me a partir de un teléfono y un texto ya construido. */
export function buildWaUrl(phone: string, text: string): string | null {
  const digits = normalizePhone(phone)
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

/**
 * Abre la app de WhatsApp (móvil o escritorio) con el mensaje ya escrito, usando
 * el deep link `whatsapp://`. No abre WhatsApp Web ni una pestaña nueva: lanza la
 * app instalada y deja AquaGestión cargado atrás. Requiere tener la app de
 * WhatsApp instalada. Devuelve false si no hay teléfono válido.
 */
export function openWhatsApp(phone: string, text: string): boolean {
  const digits = normalizePhone(phone)
  if (!digits) return false
  const encoded = encodeURIComponent(text)
  window.location.href = `whatsapp://send?phone=${digits}&text=${encoded}`
  return true
}

/** Construye el texto de cobro con el detalle del pedido. */
export function buildChargeMessage(
  order: OrderDetail,
  companyName?: string
): string {
  const clientName = order.client
    ? `${order.client.name} ${order.client.surname}`.trim()
    : order.customer_name?.trim() || 'Cliente'

  const lines: string[] = []
  lines.push(`Hola ${clientName}, le saluda *${companyName || FALLBACK_COMPANY}*.`)
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

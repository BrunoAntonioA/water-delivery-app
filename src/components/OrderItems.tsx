import type { OrderItemWithProduct } from '../types/db'

/**
 * Lista compacta de productos de un pedido, una línea por producto con la
 * cantidad en una "pastilla" para que se lea de un vistazo.
 */
export function OrderItemsList({
  items,
  className = '',
}: {
  items: OrderItemWithProduct[]
  className?: string
}) {
  if (!items.length) return <span className="text-slate-400">—</span>
  return (
    <ul className={`space-y-1 ${className}`}>
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-2">
          <span className="inline-flex min-w-[1.75rem] shrink-0 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600 tabular-nums">
            {it.quantity}×
          </span>
          <span className="text-slate-700">
            {it.product?.name ?? 'Producto'}
          </span>
        </li>
      ))}
    </ul>
  )
}

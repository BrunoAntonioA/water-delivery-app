import { useState } from 'react'
import type { Subscription } from '../types/billing'
import { accessDaysLeft } from '../types/billing'

// Color del texto según los días que quedan: más de 5 verde, de 5 a 3 amarillo,
// menos de 3 rojo.
function daysClass(days: number): string {
  if (days > 5) return 'text-emerald-600'
  if (days >= 3) return 'text-yellow-600'
  return 'text-red-600'
}

function fmtLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Ícono de la membresía junto al nombre del usuario. Al pasar el mouse (o tocarlo
 * en móvil) muestra cuánto falta para que venza la suscripción de la empresa.
 */
export function MembershipBadge({
  subscription,
}: {
  subscription: Subscription
}) {
  const [open, setOpen] = useState(false)
  const days = accessDaysLeft(subscription)
  const planName = subscription.plan?.name

  const message =
    days == null
      ? 'Sin fecha de vencimiento'
      : days === 0
        ? 'Tu membresía venció'
        : days === 1
          ? 'Te queda 1 día'
          : `Te quedan ${days} días`

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        aria-label={`Membresía: ${message}`}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100"
      >
        <img
          src="/membership-icon.png"
          alt=""
          className="h-7 w-7 object-contain"
        />
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Membresía{planName ? ` · Plan ${planName}` : ''}
          </p>
          <p
            className={`mt-1 text-sm font-semibold ${
              days == null ? 'text-slate-700' : daysClass(days)
            }`}
          >
            {message}
          </p>
          {subscription.access_until && (
            <p className="mt-0.5 text-xs text-slate-500">
              {days === 0 ? 'Venció' : 'Vence'} el{' '}
              {fmtLongDate(subscription.access_until)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

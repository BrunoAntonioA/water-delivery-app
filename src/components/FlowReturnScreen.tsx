import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { subscriptionActive } from '../types/billing'
import { Button, Spinner } from './ui'

/**
 * Pantalla que se muestra al volver de Flow (…/suscripcion?flow=return). El
 * webhook (flow-confirm) confirma el pago de forma asíncrona, así que aquí se
 * refresca el perfil/suscripción cada pocos segundos hasta que la suscripción
 * queda vigente, y luego se deja continuar.
 */
export function FlowReturnScreen() {
  const { subscription, reloadProfile } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [retry, setRetry] = useState(0)

  // reloadProfile se recrea en cada render; se usa vía ref para no reiniciar el
  // intervalo continuamente.
  const reloadRef = useRef(reloadProfile)
  reloadRef.current = reloadProfile

  const active = subscriptionActive(subscription)

  // Refresco único al volver de Flow: en una RENOVACIÓN la suscripción ya estaba
  // vigente, así que sin esto no se vería el nuevo vencimiento.
  useEffect(() => {
    reloadRef.current()
  }, [])

  useEffect(() => {
    if (active) {
      setChecking(false)
      return
    }
    setChecking(true)
    let n = 0
    const id = setInterval(async () => {
      n++
      await reloadRef.current()
      if (n >= 7) {
        clearInterval(id)
        setChecking(false)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [active, retry])

  const goToApp = () => navigate('/suscripcion', { replace: true })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {active ? (
          <>
            <div className="mb-4 text-5xl">✅</div>
            <h1 className="text-xl font-bold text-slate-900">Pago confirmado</h1>
            <p className="mt-2 text-sm text-slate-600">
              Tu suscripción quedó activa. ¡Gracias!
            </p>
            <Button className="mt-6 w-full" onClick={goToApp}>
              Continuar
            </Button>
          </>
        ) : checking ? (
          <>
            <div className="mb-4 flex justify-center">
              <Spinner />
            </div>
            <h1 className="text-xl font-bold text-slate-900">
              Confirmando tu pago…
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Esto puede tardar unos segundos. No cierres esta ventana.
            </p>
          </>
        ) : (
          <>
            <div className="mb-4 text-5xl">⏳</div>
            <h1 className="text-xl font-bold text-slate-900">
              Aún no confirmamos tu pago
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Si ya pagaste, la confirmación puede tardar un momento. Puedes
              reintentar o revisar tu suscripción.
            </p>
            <div className="mt-6 space-y-2">
              <Button
                className="w-full"
                onClick={() => setRetry((r) => r + 1)}
              >
                Reintentar
              </Button>
              <Button variant="secondary" className="w-full" onClick={goToApp}>
                Ir a mi suscripción
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

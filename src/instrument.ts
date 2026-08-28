import * as Sentry from '@sentry/react'

// Inicialización de Sentry (monitoreo de errores). Debe importarse ANTES que
// cualquier otro código en main.tsx.
//
// Sólo se activa si hay DSN (variable VITE_SENTRY_DSN, que se configura en
// Vercel). Sin DSN, el SDK queda inerte y no envía nada — así el desarrollo
// local no reporta errores a Sentry.
//
// Configurado en MODO PRIVADO por la Ley 21.719: no se envían datos personales
// (sin IP/headers del usuario), Session Replay está DESACTIVADO (no se graban
// pantallas de clientes), y un filtro extra limpia teléfonos/correos/RUT que
// pudieran colarse en el texto de un error.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION as string | undefined,

    // No enviar datos personales (IP, headers). Es el default, explícito por claridad.
    sendDefaultPii: false,

    integrations: [
      // Rendimiento básico (carga de página y navegación). Session Replay NO se
      // incluye a propósito.
      Sentry.browserTracingIntegration(),
    ],

    // Tracing ligero (10% de las transacciones) para no consumir cuota ni egress.
    tracesSampleRate: 0.1,
    // No propagamos cabeceras de traza a orígenes externos (evita sorpresas de
    // CORS con Supabase); sólo al mismo origen local.
    tracePropagationTargets: ['localhost'],

    // Filtro final: quita datos personales de mensajes de error y breadcrumbs.
    beforeSend: scrubEvent,
  })
}

// Diagnóstico SÓLO en desarrollo: avisa en la consola si Sentry quedó activo o
// no, y expone `window.Sentry` para poder probar de forma confiable con
// `Sentry.captureException(new Error('prueba'))` (más fiable que un `throw`
// tecleado en la consola, que el navegador no siempre reporta).
if (import.meta.env.DEV) {
  if (dsn) {
    console.info('[Sentry] inicializado ✓ — prueba: Sentry.captureException(new Error("prueba"))')
  } else {
    console.warn('[Sentry] SIN DSN: define VITE_SENTRY_DSN en .env y REINICIA el dev server.')
  }
  ;(window as unknown as { Sentry: typeof Sentry }).Sentry = Sentry
}

const PII_RULES: [RegExp, string][] = [
  [/\+?56\s?9[\s-]?\d{4}[\s-]?\d{4}/g, '[teléfono]'], // teléfonos chilenos
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]'], // correos
  [/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/g, '[rut]'], // RUT con puntos
]

function scrubText(s: string): string {
  return PII_RULES.reduce((acc, [re, rep]) => acc.replace(re, rep), s)
}

/** Limpia PII de los campos de texto de un evento antes de enviarlo. */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) event.message = scrubText(event.message)
  event.exception?.values?.forEach((v) => {
    if (v.value) v.value = scrubText(v.value)
  })
  event.breadcrumbs?.forEach((b) => {
    if (typeof b.message === 'string') b.message = scrubText(b.message)
  })
  return event
}

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  getGuardState,
  recordFailure,
  recordSuccess,
  LOCK_MINUTES,
} from '../lib/loginGuard'
import { Turnstile, turnstileConfigured } from '../components/Turnstile'
import { Logo } from '../components/Logo'
import { Button, Card, Label, TextInput } from '../components/ui'

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [humanChecked, setHumanChecked] = useState(false)

  // Recuperar contraseña.
  const [forgot, setForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function onReset(e: React.FormEvent) {
    e.preventDefault()
    setResetLoading(true)
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/nueva-clave`,
      })
    } catch (err) {
      console.error(err)
    }
    // Mensaje genérico: no revelamos si el correo existe.
    setResetSent(true)
    setResetLoading(false)
  }

  // "now" avanza cada segundo para actualizar el estado del bloqueo y el conteo.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const guard = useMemo(() => getGuardState(email, now), [email, now])
  const captchaSolved = turnstileConfigured ? Boolean(captchaToken) : humanChecked

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const g = getGuardState(email)
    if (g.status === 'locked') {
      setError(
        `Demasiados intentos. Espera ${mmss(g.remainingMs)} antes de reintentar.`
      )
      return
    }
    if (g.status === 'captcha' && !captchaSolved) {
      setError('Confirma que no eres un robot para continuar.')
      return
    }

    setError('')
    setLoading(true)
    try {
      await signIn(email.trim(), password, captchaToken ?? undefined)
      recordSuccess(email)
    } catch (err) {
      const next = recordFailure(email)
      // Reiniciar el captcha para el siguiente intento.
      setCaptchaToken(null)
      setHumanChecked(false)
      window.turnstile?.reset()
      setNow(Date.now())
      if (next.status === 'locked') {
        setError(
          `Demasiados intentos fallidos. Espera ${LOCK_MINUTES} minutos antes de reintentar.`
        )
      } else if (next.status === 'captcha') {
        setError(
          `Contraseña incorrecta. Completa el captcha; te quedan ${next.triesLeft} ` +
            `intento${next.triesLeft === 1 ? '' : 's'} antes del bloqueo.`
        )
      } else {
        setError(
          `Correo o contraseña incorrectos. Te quedan ${next.triesLeft} ` +
            `intento${next.triesLeft === 1 ? '' : 's'} antes de pedir un captcha.`
        )
      }
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const locked = guard.status === 'locked'
  const needsCaptcha = guard.status === 'captcha'
  const canSubmit =
    !loading && !locked && (!needsCaptcha || captchaSolved)

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <Logo className="mx-auto mb-3 w-40 max-w-full" />
          <h1 className="text-2xl font-bold text-slate-900">Gestiona Agua</h1>
          <p className="mt-1 text-sm text-slate-500">
            Bienvenido de vuelta 👋
          </p>
        </div>

        {!isSupabaseConfigured && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Supabase no está configurado. Revisa tu archivo <code>.env</code>.
          </p>
        )}

        {forgot ? (
          <div className="space-y-4">
            {resetSent ? (
              <>
                <p className="text-sm text-slate-600">
                  Si existe una cuenta con ese correo, te enviamos un enlace para
                  restablecer la contraseña. Revisa tu bandeja (y el spam).
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setForgot(false)
                    setResetSent(false)
                  }}
                >
                  Volver a iniciar sesión
                </Button>
              </>
            ) : (
              <form onSubmit={onReset} className="space-y-4">
                <p className="text-sm text-slate-500">
                  Ingresa tu correo y te enviaremos un enlace para crear una
                  nueva contraseña.
                </p>
                <div>
                  <Label>Correo</Label>
                  <TextInput
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    required
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={resetLoading || !email.trim()}
                >
                  {resetLoading ? 'Enviando…' : 'Enviar enlace'}
                </Button>
                <button
                  type="button"
                  onClick={() => setForgot(false)}
                  className="w-full text-center text-sm text-slate-500 hover:underline"
                >
                  Volver a iniciar sesión
                </button>
              </form>
            )}
          </div>
        ) : (
          <>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Correo</Label>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
              autoFocus
              disabled={locked}
            />
          </div>
          <div>
            <Label>Contraseña</Label>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={locked}
            />
          </div>

          {/* Captcha tras 3 fallos (y hasta el bloqueo). */}
          {needsCaptcha &&
            (turnstileConfigured ? (
              <Turnstile onToken={setCaptchaToken} />
            ) : (
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={humanChecked}
                  onChange={(e) => setHumanChecked(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                No soy un robot
              </label>
            ))}

          {locked && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
              🔒 Cuenta bloqueada temporalmente. Reintenta en{' '}
              <span className="font-semibold tabular-nums">
                {mmss(guard.remainingMs)}
              </span>
              .
            </p>
          )}

          {error && !locked && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? 'Entrando…' : locked ? 'Bloqueado' : 'Entrar'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setForgot(true)}
          className="mt-3 w-full text-center text-sm text-sky-600 hover:underline"
        >
          ¿Olvidaste tu contraseña?
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          ¿No tienes cuenta?{' '}
          <a href="/registro" className="font-medium text-sky-600 hover:underline">
            Crea tu empresa gratis
          </a>
        </p>
          </>
        )}
      </Card>
    </div>
  )
}

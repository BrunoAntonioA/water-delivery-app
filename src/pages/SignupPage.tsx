import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTrialPlan, signupCompany } from '../api/billing'
import { supabase } from '../lib/supabase'
import { Turnstile, turnstileConfigured } from '../components/Turnstile'
import { Button, Card, Label, TextInput } from '../components/ui'

export default function SignupPage() {
  // Días de prueba definidos en el plan "Prueba" (editable en el módulo Planes).
  const { data: trialPlan } = useQuery({
    queryKey: ['trial-plan'],
    queryFn: getTrialPlan,
    staleTime: 5 * 60_000,
  })
  const trialDays = trialPlan?.trial_days ?? 10

  const [email, setEmail] = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [rut, setRut] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const emailsMatch = email.trim() !== '' && email.trim() === emailConfirm.trim()
  const passwordValid = password.length >= 8
  const passwordsMatch = password !== '' && password === passwordConfirm
  const captchaSolved = turnstileConfigured ? Boolean(captchaToken) : true

  const canSubmit =
    !loading &&
    emailValid &&
    emailsMatch &&
    passwordValid &&
    passwordsMatch &&
    name.trim() !== '' &&
    lastName.trim() !== '' &&
    phone.trim() !== '' &&
    rut.trim() !== '' &&
    razonSocial.trim() !== '' &&
    captchaSolved

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError('')
    setLoading(true)
    try {
      await signupCompany({
        email: email.trim(),
        password,
        full_name: name.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        rut: rut.trim(),
        razon_social: razonSocial.trim(),
        captchaToken,
      })
      // No se inicia sesión: primero debe verificar su correo. Disparamos el
      // correo de verificación (la cuenta se creó sin confirmar).
      await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
      window.turnstile?.reset()
      setCaptchaToken(null)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-sm p-6 text-center">
          <div className="mb-2 text-4xl">📩</div>
          <h1 className="text-xl font-bold text-slate-900">Revisa tu correo</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enviamos un enlace de verificación a{' '}
            <span className="font-medium text-slate-700">{email.trim()}</span>.
            Ábrelo para activar tu cuenta e iniciar tu prueba de {trialDays} días.
          </p>
          <p className="mt-4 text-xs text-slate-400">
            ¿No lo ves? Revisa el spam. El enlace te llevará de vuelta a la
            aplicación.
          </p>
          <a
            href="/"
            className="mt-5 inline-block text-sm font-medium text-sky-600 hover:underline"
          >
            Volver a iniciar sesión
          </a>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-2xl p-6 sm:p-8">
        <div className="mb-6 text-center">
          <div className="mb-2 text-4xl">💧</div>
          <h1 className="text-2xl font-bold text-slate-900">
            Crea tu empresa gratis
          </h1>
          <p className="text-sm text-slate-500">
            {trialDays} días de prueba con todo incluido, sin tarjeta.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Plan de prueba (sin elección: todos parten con la prueba) */}
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
            <p className="font-semibold text-sky-900">
              🎁 Prueba gratis de {trialDays} días
            </p>
            <p className="mt-1 text-sm text-sky-800">
              Empiezas con el <strong>plan de prueba</strong>, que incluye casi
              todo lo del plan <strong>Pro</strong>. Al terminar la prueba eliges
              el plan que más te acomode. Sin tarjeta.
            </p>
          </div>

          {/* Datos de acceso */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Correo *</Label>
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                required
              />
              {email !== '' && !emailValid && (
                <p className="mt-1 text-sm text-red-600">Correo inválido.</p>
              )}
            </div>
            <div>
              <Label>Confirma tu correo *</Label>
              <TextInput
                type="email"
                value={emailConfirm}
                onChange={(e) => setEmailConfirm(e.target.value)}
                required
              />
              {emailConfirm !== '' && !emailsMatch && (
                <p className="mt-1 text-sm text-red-600">
                  Los correos no coinciden.
                </p>
              )}
            </div>
            <div>
              <Label>Contraseña *</Label>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {password !== '' && !passwordValid && (
                <p className="mt-1 text-sm text-red-600">
                  Mínimo 8 caracteres.
                </p>
              )}
            </div>
            <div>
              <Label>Confirma la contraseña *</Label>
              <TextInput
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
              />
              {passwordConfirm !== '' && !passwordsMatch && (
                <p className="mt-1 text-sm text-red-600">
                  Las contraseñas no coinciden.
                </p>
              )}
            </div>
          </div>

          {/* Datos de la persona y la empresa */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Nombre *</Label>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Apellido *</Label>
              <TextInput
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Teléfono *</Label>
              <TextInput
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+56 9 1234 5678"
                required
              />
            </div>
            <div>
              <Label>RUT *</Label>
              <TextInput
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                placeholder="12.345.678-9"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Razón social *</Label>
              <TextInput
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Distribuidora de Agua SpA"
                required
              />
            </div>
          </div>

          {turnstileConfigured && <Turnstile onToken={setCaptchaToken} />}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <p className="text-center text-xs text-slate-500">
            Al crear tu cuenta aceptas los{' '}
            <a
              href="/terminos"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sky-600 hover:underline"
            >
              Términos y Condiciones y la Política de Privacidad
            </a>
            , incluida la transferencia internacional de datos.
          </p>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? 'Creando tu cuenta…' : `Empezar prueba de ${trialDays} días`}
          </Button>

          <p className="text-center text-sm text-slate-500">
            ¿Ya tienes cuenta?{' '}
            <a href="/" className="font-medium text-sky-600 hover:underline">
              Inicia sesión
            </a>
          </p>
        </form>
      </Card>
    </div>
  )
}

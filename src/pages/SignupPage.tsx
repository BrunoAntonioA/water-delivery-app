import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { listPlans, signupCompany } from '../api/billing'
import { useAuth } from '../lib/auth'
import { formatMoney } from '../lib/format'
import { Turnstile, turnstileConfigured } from '../components/Turnstile'
import { Button, Card, Label, TextInput } from '../components/ui'

const TRIAL_DAYS = 10

export default function SignupPage() {
  const { signIn } = useAuth()
  const [params] = useSearchParams()
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: listPlans })

  const [email, setEmail] = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [rut, setRut] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [planId, setPlanId] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Plan preseleccionado desde la landing (?plan=pro) o el primero disponible.
  const selectedPlan = useMemo(() => {
    if (!plans?.length) return null
    const fromQuery = params.get('plan')
    const byQuery = fromQuery && plans.find((p) => p.key === fromQuery)
    const byState = planId && plans.find((p) => p.id === planId)
    return byState || byQuery || plans[0]
  }, [plans, params, planId])

  const effectivePlanId = planId || selectedPlan?.id || ''

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
    Boolean(effectivePlanId) &&
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
        plan_id: effectivePlanId,
        captchaToken,
      })
      setDone(true)
      // Inicia sesión automáticamente: la app pasa a la vista autenticada.
      await signIn(email.trim(), password)
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
          <div className="mb-2 text-4xl">✅</div>
          <h1 className="text-xl font-bold text-slate-900">¡Cuenta creada!</h1>
          <p className="mt-2 text-sm text-slate-500">
            Entrando a tu cuenta…
          </p>
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
            {TRIAL_DAYS} días de prueba con todo incluido, sin tarjeta.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Plan */}
          <div>
            <Label>Elige tu plan</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              {(plans ?? []).map((p) => {
                const on = p.id === effectivePlanId
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPlanId(p.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      on
                        ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-100'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="text-sm text-slate-500">
                      {formatMoney(p.price)}/mes
                    </p>
                  </button>
                )
              })}
            </div>
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

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? 'Creando tu cuenta…' : `Empezar prueba de ${TRIAL_DAYS} días`}
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

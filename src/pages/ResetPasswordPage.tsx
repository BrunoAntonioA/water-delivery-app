import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Card, Label, TextInput } from '../components/ui'

/**
 * Página pública de nueva contraseña. Se llega desde el enlace del correo de
 * recuperación, que crea una sesión temporal (evento PASSWORD_RECOVERY). Con esa
 * sesión se permite cambiar la contraseña con updateUser.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>(
    'checking'
  )
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let settled = false
    const markReady = () => {
      settled = true
      setStatus('ready')
    }
    // La sesión puede establecerse al procesar el token del enlace (o justo
    // después, vía el evento de recuperación).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) markReady()
    })
    const t = setTimeout(() => {
      if (!settled) setStatus('invalid')
    }, 4000)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [])

  const valid = password.length >= 8 && password === confirm

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mb-2 text-4xl">🔑</div>
          <h1 className="text-xl font-bold text-slate-900">Nueva contraseña</h1>
        </div>

        {done ? (
          <div className="text-center">
            <p className="mb-4 text-sm text-slate-600">
              Tu contraseña se actualizó correctamente.
            </p>
            <Button
              className="w-full"
              onClick={() => navigate('/', { replace: true })}
            >
              Ir a la aplicación
            </Button>
          </div>
        ) : status === 'checking' ? (
          <p className="text-center text-sm text-slate-500">
            Validando el enlace…
          </p>
        ) : status === 'invalid' ? (
          <div className="text-center">
            <p className="mb-4 text-sm text-slate-600">
              El enlace no es válido o expiró. Solicita uno nuevo desde “¿Olvidaste
              tu contraseña?”.
            </p>
            <a
              href="/"
              className="text-sm font-medium text-sky-600 hover:underline"
            >
              Volver a iniciar sesión
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label>Nueva contraseña *</Label>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              {password !== '' && password.length < 8 && (
                <p className="mt-1 text-sm text-red-600">Mínimo 8 caracteres.</p>
              )}
            </div>
            <div>
              <Label>Confirma la contraseña *</Label>
              <TextInput
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {confirm !== '' && password !== confirm && (
                <p className="mt-1 text-sm text-red-600">
                  Las contraseñas no coinciden.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" className="w-full" disabled={!valid || loading}>
              {loading ? 'Guardando…' : 'Cambiar contraseña'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}

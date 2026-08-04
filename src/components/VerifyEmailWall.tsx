import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button } from './ui'

/**
 * Pantalla de bloqueo mientras el correo no está verificado. Permite reenviar el
 * correo de verificación o cerrar sesión.
 */
export function VerifyEmailWall({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function resend() {
    setError('')
    setSending(true)
    try {
      const { error: err } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      if (err) throw err
      setSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-5xl">📩</div>
        <h1 className="text-xl font-bold text-slate-900">Verifica tu correo</h1>
        <p className="mt-2 text-sm text-slate-500">
          Te enviamos un enlace de verificación a{' '}
          <span className="font-medium text-slate-700">{email}</span>. Ábrelo para
          activar tu cuenta y entrar.
        </p>

        {sent ? (
          <p className="mt-5 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
            Correo reenviado. Revisa tu bandeja (y el spam).
          </p>
        ) : (
          <Button className="mt-5 w-full" onClick={resend} disabled={sending}>
            {sending ? 'Enviando…' : 'Reenviar correo de verificación'}
          </Button>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <p className="mt-4 text-xs text-slate-400">
          Cuando lo confirmes, recarga esta página.
        </p>
      </div>

      <Button variant="ghost" onClick={onSignOut}>
        Cerrar sesión
      </Button>
    </div>
  )
}

import type { Session } from '@supabase/supabase-js'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { getCompanySubscription } from '../api/billing'
import type { Company, Profile } from '../types/auth'
import type { Subscription } from '../types/billing'

interface AuthState {
  session: Session | null
  profile: Profile | null
  company: Company | null
  subscription: Subscription | null
  loading: boolean
  /** true mientras se está cargando el perfil de una sesión existente. */
  profileLoading: boolean
  signIn: (
    email: string,
    password: string,
    captchaToken?: string
  ) => Promise<void>
  signOut: () => Promise<void>
  reloadProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('Error cargando perfil:', error.message)
    return null
  }
  return data as Profile | null
}

async function fetchCompany(companyId: string): Promise<Company | null> {
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle()
  return (data as Company | null) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const qc = useQueryClient()
  // Último usuario cuyos datos se cargaron. Sirve para limpiar el caché cuando
  // cambia de cuenta (o se cierra sesión) y no mostrar info del usuario anterior.
  const loadedUserId = useRef<string | undefined>(undefined)

  async function loadProfileFor(userId: string | undefined) {
    if (!userId) {
      setProfile(null)
      setCompany(null)
      setSubscription(null)
      return
    }
    setProfileLoading(true)
    try {
      const p = await fetchProfile(userId)
      setProfile(p)
      if (p?.company_id) {
        const [c, sub] = await Promise.all([
          fetchCompany(p.company_id),
          getCompanySubscription(p.company_id),
        ])
        setCompany(c)
        setSubscription(sub)
      } else {
        setCompany(null)
        setSubscription(null)
      }
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      loadedUserId.current = data.session?.user.id
      setSession(data.session)
      await loadProfileFor(data.session?.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Si cambió el usuario (login de otra cuenta o cierre de sesión), se
      // vacía todo el caché de datos para no filtrar información entre cuentas.
      const newUserId = s?.user?.id
      if (newUserId !== loadedUserId.current) {
        qc.clear()
        loadedUserId.current = newUserId
      }
      setSession(s)
      loadProfileFor(s?.user.id)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
    // qc es estable (una sola instancia de QueryClient); el efecto corre una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signIn(email: string, password: string, captchaToken?: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      // Si Supabase Auth tiene el captcha activado, se verifica en el servidor.
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
    // Vaciar el caché de datos para no dejar información del usuario que sale.
    qc.clear()
    loadedUserId.current = undefined
    setProfile(null)
    setCompany(null)
    setSubscription(null)
  }

  async function reloadProfile() {
    await loadProfileFor(session?.user.id)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        company,
        subscription,
        loading,
        profileLoading,
        signIn,
        signOut,
        reloadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}

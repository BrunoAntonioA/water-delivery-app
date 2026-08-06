import { supabase } from '../lib/supabase'
import type { Company, Profile, Role } from '../types/auth'

// --- Empresas (superadmin) ---

export interface CompanySummary extends Company {
  userCount: number
}

export async function listCompanies(): Promise<CompanySummary[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*, members:profiles(id)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((c) => {
    const { members, ...company } = c as Company & { members: { id: string }[] }
    return { ...company, userCount: members?.length ?? 0 }
  })
}

export async function getCompany(id: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Company | null) ?? null
}

export async function createCompany(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('companies')
    .insert({ name })
    .select()
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateCompany(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .update({ name })
    .eq('id', id)
  if (error) throw error
}

/** Habilita/deshabilita módulos de una empresa (sólo superadmin, por RLS + trigger). */
export async function updateCompanyModules(
  id: string,
  modules: string[]
): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .update({ modules })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCompany(id: string): Promise<void> {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

// --- Usuarios ---

export async function listUsers(): Promise<Profile[]> {
  // RLS ya limita: el admin sólo ve los de su empresa; el superadmin ve todos.
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Profile[]
}

/** Usuarios de una empresa específica (para el detalle de Empresas). */
export async function listUsersByCompany(
  companyId: string
): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Profile[]
}

export interface NewUserInput {
  email: string
  password: string
  full_name: string
  role: Role
  company_id: string | null
}

/**
 * Crea un usuario: la cuenta de Auth (con un cliente temporal para no cerrar la
 * sesión del admin) y su perfil. Si el correo ya pertenece a un usuario
 * desactivado de la empresa, lo REACTIVA en vez de crear otra cuenta (evita el
 * error de "rate limit" al reusar un correo).
 */
export interface CreateUserResult {
  status: 'created' | 'reactivated'
  /** true sólo si se envió realmente el correo de verificación. */
  emailSent: boolean
}

/**
 * Crea (o reactiva) un usuario. Devuelve qué ocurrió y si se envió el correo de
 * verificación, para que la UI muestre el mensaje adecuado.
 */
export async function createUser(
  input: NewUserInput
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase()

  // ¿Existe ya un perfil (posiblemente desactivado) con este correo? Si está
  // desactivado lo reactivamos (esto es una simple actualización de perfil,
  // autorizada por RLS para el admin de la empresa).
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, active')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    if (existing.active) {
      throw new Error('Ya existe un usuario activo con ese correo.')
    }
    const { error } = await supabase
      .from('profiles')
      .update({
        active: true,
        role: input.role,
        full_name: input.full_name || null,
        company_id: input.company_id,
      })
      .eq('id', existing.id)
    if (error) throw error
    return { status: 'reactivated', emailSent: false }
  }

  // Alta nueva: la realiza la Edge Function "admin-create-user" con el service
  // role. Así el registro público (signup) puede estar DESACTIVADO en Supabase
  // y sólo un admin/superadmin autenticado puede crear cuentas.
  const { error } = await supabase.functions.invoke('admin-create-user', {
    body: {
      email,
      password: input.password,
      full_name: input.full_name,
      role: input.role,
      company_id: input.company_id,
    },
  })
  if (error) {
    // La Edge Function devuelve el detalle del error en el cuerpo de la respuesta.
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        if (body?.error) message = body.error
      } catch {
        /* sin cuerpo JSON: se usa el mensaje genérico */
      }
    }
    throw new Error(message)
  }

  // La cuenta se creó sin confirmar: se le intenta enviar el correo de
  // verificación. Si el envío falla (p. ej. la cuenta ya estaba confirmada, o
  // no hay SMTP/límite de correos), no se revierte la creación: sólo se informa
  // que no se envió el correo.
  let emailSent = false
  try {
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    emailSent = !resendErr
    if (resendErr) {
      console.warn('No se pudo enviar el correo de verificación:', resendErr)
    }
  } catch (e) {
    console.warn('No se pudo enviar el correo de verificación:', e)
  }
  return { status: 'created', emailSent }
}

/**
 * Actualiza la contraseña y/o el nombre de un usuario. El cambio de contraseña
 * lo hace la Edge Function "admin-update-user" con el service role.
 */
export async function updateUser(
  id: string,
  input: { password?: string; full_name?: string }
): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-update-user', {
    body: { id, ...input },
  })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const bodyErr = await context.json()
        if (bodyErr?.error) message = bodyErr.error
      } catch {
        /* sin cuerpo JSON */
      }
    }
    throw new Error(message)
  }
}

export async function updateUserRole(id: string, role: Role): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', id)
  if (error) throw error
}

/** Desactiva un usuario: conserva la cuenta pero le quita todo el acceso. */
export async function deactivateUser(id: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ active: false })
    .eq('id', id)
  if (error) throw error
}

/** Reactiva un usuario desactivado. */
export async function reactivateUser(id: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ active: true })
    .eq('id', id)
  if (error) throw error
}

/**
 * Elimina al usuario del sistema (borra su perfil). Desaparece de la lista y
 * pierde todo acceso. La cuenta de inicio de sesión (Supabase Auth) permanece;
 * para reutilizar ese correo hay que borrarla también en el panel de Supabase
 * (Authentication → Users).
 */
export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', id)
  if (error) throw error
}

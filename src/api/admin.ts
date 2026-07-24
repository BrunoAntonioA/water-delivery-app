import { createTempAuthClient, supabase } from '../lib/supabase'
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
export async function createUser(input: NewUserInput): Promise<void> {
  const email = input.email.trim().toLowerCase()

  // ¿Existe ya un perfil (posiblemente desactivado) con este correo?
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, active')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    if (existing.active) {
      throw new Error('Ya existe un usuario activo con ese correo.')
    }
    // Reactivar y actualizar rol/nombre. (La contraseña sigue siendo la anterior;
    // el usuario puede restablecerla si la olvidó.)
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
    return
  }

  const temp = createTempAuthClient()
  const { data, error } = await temp.auth.signUp({
    email,
    password: input.password,
  })
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      throw new Error(
        'Ese correo ya tiene una cuenta en Supabase. Bórrala en Authentication → Users (o usa otro correo).'
      )
    }
    throw error
  }
  const userId = data.user?.id
  if (!userId) {
    throw new Error(
      'No se pudo crear la cuenta. Revisa que los registros (signups) estén habilitados en Supabase.'
    )
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    company_id: input.company_id,
    role: input.role,
    full_name: input.full_name || null,
    email,
  })
  if (profileError) throw profileError
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

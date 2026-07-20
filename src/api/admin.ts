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

export interface NewUserInput {
  email: string
  password: string
  full_name: string
  role: Role
  company_id: string | null
}

/**
 * Crea un usuario: primero la cuenta de Supabase Auth (con un cliente temporal
 * para no cerrar la sesión del admin) y luego su perfil (empresa + rol).
 */
export async function createUser(input: NewUserInput): Promise<void> {
  const temp = createTempAuthClient()
  const { data, error } = await temp.auth.signUp({
    email: input.email,
    password: input.password,
  })
  if (error) throw error
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
    email: input.email,
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

/**
 * Quita el acceso de un usuario borrando su perfil. La cuenta de Auth sigue
 * existiendo (borrarla del todo requiere el panel de Supabase o un backend),
 * pero sin perfil no puede ver ningún dato.
 */
export async function removeUserProfile(id: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', id)
  if (error) throw error
}

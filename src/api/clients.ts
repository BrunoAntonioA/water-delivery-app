import { supabase } from '../lib/supabase'
import type { ClientWithAddresses } from '../types/db'

export interface AddressInput {
  id?: string // presente si es una dirección existente
  label: string
  address: string
  comuna: string
  observation: string
}

export interface ClientInput {
  name: string
  surname: string
  national_id: string
  phone: string
  addresses: AddressInput[]
}

export async function listClients(): Promise<ClientWithAddresses[]> {
  // Supabase devuelve máximo 1000 filas por consulta, así que paginamos con
  // .range() hasta traerlos todos. Se ordena también por id para que la
  // paginación sea estable (muchos clientes importados comparten created_at).
  const PAGE = 1000
  const all: ClientWithAddresses[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('clients')
      .select('*, addresses(*)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as ClientWithAddresses[]
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

export async function createClient(input: ClientInput): Promise<void> {
  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      name: input.name,
      surname: input.surname,
      national_id: input.national_id || null,
      phone: input.phone,
    })
    .select()
    .single()
  if (error) throw error

  const addresses = input.addresses
    .filter((a) => a.address.trim())
    .map((a) => ({
      client_id: client.id,
      label: a.label || null,
      address: a.address.trim(),
      comuna: a.comuna.trim() || null,
      observation: a.observation.trim() || null,
    }))

  // La dirección es obligatoria. Si el insert de direcciones falla (o no hay
  // ninguna), borramos el cliente recién creado para no dejarlo huérfano —
  // el cliente JS de Supabase no soporta transacciones multi-tabla.
  if (addresses.length === 0) {
    await supabase.from('clients').delete().eq('id', client.id)
    throw new Error('El cliente debe tener al menos una dirección.')
  }

  const { error: addrError } = await supabase
    .from('addresses')
    .insert(addresses)
  if (addrError) {
    await supabase.from('clients').delete().eq('id', client.id)
    throw addrError
  }
}

export async function updateClient(
  id: string,
  input: ClientInput
): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({
      name: input.name,
      surname: input.surname,
      national_id: input.national_id || null,
      phone: input.phone,
    })
    .eq('id', id)
  if (error) throw error

  // Estrategia simple: borrar las direcciones existentes y volver a insertarlas.
  const { error: delError } = await supabase
    .from('addresses')
    .delete()
    .eq('client_id', id)
  if (delError) throw delError

  const addresses = input.addresses
    .filter((a) => a.address.trim())
    .map((a) => ({
      client_id: id,
      label: a.label || null,
      address: a.address.trim(),
      comuna: a.comuna.trim() || null,
      observation: a.observation.trim() || null,
    }))

  if (addresses.length > 0) {
    const { error: addrError } = await supabase
      .from('addresses')
      .insert(addresses)
    if (addrError) throw addrError
  }
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

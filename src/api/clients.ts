import { supabase } from '../lib/supabase'
import type { ClientWithAddresses, PaymentPeriod } from '../types/db'

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
  payment_period: PaymentPeriod | null
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

export interface CreatedClient {
  id: string
  addressId: string | null
}

export async function createClient(input: ClientInput): Promise<CreatedClient> {
  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      name: input.name,
      surname: input.surname,
      national_id: input.national_id || null,
      phone: input.phone,
      payment_period: input.payment_period,
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

  const { data: insertedAddrs, error: addrError } = await supabase
    .from('addresses')
    .insert(addresses)
    .select('id')
  if (addrError) {
    await supabase.from('clients').delete().eq('id', client.id)
    throw addrError
  }

  return { id: client.id as string, addressId: insertedAddrs?.[0]?.id ?? null }
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
      payment_period: input.payment_period,
    })
    .eq('id', id)
  if (error) throw error

  // Direcciones: se CONSERVAN los ids de las existentes para no romper el enlace
  // con los pedidos (address_id). Se actualizan las que ya existían, se agregan
  // las nuevas y se borran sólo las que el usuario quitó del formulario.
  const rows = input.addresses.filter((a) => a.address.trim())
  const existentes = rows.filter((a) => a.id)
  const nuevas = rows.filter((a) => !a.id)

  // Actualizar las existentes (mismo id).
  for (const a of existentes) {
    const { error: uErr } = await supabase
      .from('addresses')
      .update({
        label: a.label || null,
        address: a.address.trim(),
        comuna: a.comuna.trim() || null,
        observation: a.observation.trim() || null,
      })
      .eq('id', a.id!)
    if (uErr) throw uErr
  }

  // Borrar sólo las direcciones que ya no están en el formulario.
  const { data: current } = await supabase
    .from('addresses')
    .select('id')
    .eq('client_id', id)
  const keep = new Set(existentes.map((a) => a.id))
  const toDelete = (current ?? [])
    .map((r) => r.id as string)
    .filter((cid) => !keep.has(cid))
  if (toDelete.length > 0) {
    const { error: dErr } = await supabase
      .from('addresses')
      .delete()
      .in('id', toDelete)
    if (dErr) throw dErr
  }

  // Insertar las direcciones nuevas.
  if (nuevas.length > 0) {
    const { error: iErr } = await supabase.from('addresses').insert(
      nuevas.map((a) => ({
        client_id: id,
        label: a.label || null,
        address: a.address.trim(),
        comuna: a.comuna.trim() || null,
        observation: a.observation.trim() || null,
      }))
    )
    if (iErr) throw iErr
  }
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

/**
 * Derecho de supresión (Ley 21.719). Si el cliente NO tiene pedidos, se elimina
 * por completo (las direcciones caen en cascada). Si tiene historial de pedidos,
 * NO se puede borrar (FK on delete restrict) ni conviene —el historial es
 * registro contable—, así que se ANONIMIZA: se borran sus direcciones y se
 * limpian sus datos personales, conservando los pedidos ya de-identificados.
 * Devuelve qué ocurrió para informar en la UI.
 */
export async function eraseClientData(
  id: string
): Promise<'deleted' | 'anonymized'> {
  const { count, error: countErr } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', id)
  if (countErr) throw countErr

  if ((count ?? 0) > 0) {
    const { error: addrErr } = await supabase
      .from('addresses')
      .delete()
      .eq('client_id', id)
    if (addrErr) throw addrErr
    const { error } = await supabase
      .from('clients')
      .update({
        name: 'Cliente eliminado',
        surname: '',
        national_id: null,
        phone: '',
        anonymized_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error
    return 'anonymized'
  }

  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
  return 'deleted'
}

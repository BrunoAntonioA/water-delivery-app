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

// Crea el cliente + sus direcciones de forma ATÓMICA (función Postgres
// create_client): si falla, no queda un cliente sin direcciones. Exige al menos
// una dirección con texto y devuelve {id, addressId}.
export async function createClient(input: ClientInput): Promise<CreatedClient> {
  const { data, error } = await supabase.rpc('create_client', {
    p_name: input.name,
    p_surname: input.surname,
    p_national_id: input.national_id || null,
    p_phone: input.phone,
    p_payment_period: input.payment_period,
    p_addresses: input.addresses,
  })
  if (error) throw error
  const res = data as { id: string; addressId: string | null }
  return { id: res.id, addressId: res.addressId ?? null }
}

/**
 * Edita el cliente y RECONCILIA sus direcciones de forma ATÓMICA (función
 * Postgres update_client): conserva los ids de las direcciones existentes (no
 * rompe el enlace address_id de los pedidos), actualiza las que siguen, borra
 * las quitadas e inserta las nuevas — todo en una sola transacción.
 */
export async function updateClient(
  id: string,
  input: ClientInput
): Promise<void> {
  const { error } = await supabase.rpc('update_client', {
    p_id: id,
    p_name: input.name,
    p_surname: input.surname,
    p_national_id: input.national_id || null,
    p_phone: input.phone,
    p_payment_period: input.payment_period,
    p_addresses: input.addresses,
  })
  if (error) throw error
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

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createClient, type CreatedClient } from '../api/clients'
import { Button, Label, TextInput } from './ui'

// ¿El texto buscado parece un teléfono? (≥6 dígitos y sólo caracteres de
// teléfono: dígitos, +, espacios, guiones y paréntesis). Sirve para decidir si,
// al crear un cliente nuevo, lo escrito va al campo Nombre o al campo Teléfono.
function looksLikePhone(s: string): boolean {
  const t = s.trim()
  const digits = t.replace(/\D/g, '')
  return digits.length >= 6 && /^[+\d\s()-]+$/.test(t)
}

/**
 * Registro rápido de un cliente dentro de otro formulario (nuevo pedido, nuevo
 * prepago): nombre, teléfono y una dirección. Lo escrito en el buscador
 * (`initialQuery`) se precarga como nombre o teléfono. Al guardar crea el
 * cliente con su dirección "Casa" y avisa con su id para usarlo de inmediato.
 */
export function QuickClientForm({
  initialQuery,
  onCreated,
  onCancel,
}: {
  initialQuery: string
  onCreated: (client: CreatedClient) => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState(() => {
    const isPhone = looksLikePhone(initialQuery)
    return {
      name: isPhone ? '' : initialQuery,
      surname: '',
      phone: isPhone ? initialQuery : '',
      address: '',
      comuna: '',
    }
  })

  const mutation = useMutation({
    mutationFn: () =>
      createClient({
        name: form.name.trim(),
        surname: form.surname.trim(),
        national_id: '',
        phone: form.phone.trim(),
        payment_period: null,
        addresses: [
          {
            label: 'Casa',
            address: form.address.trim(),
            comuna: form.comuna.trim(),
            observation: '',
          },
        ],
      }),
    onSuccess: (client) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      onCreated(client)
    },
  })

  const canSave = Boolean(
    form.name.trim() &&
      form.phone.trim() &&
      form.address.trim() &&
      form.comuna.trim()
  )

  return (
    <div
      className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4"
      // Enter guarda el cliente (y no envía el formulario de afuera).
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        if (canSave && !mutation.isPending) mutation.mutate()
      }}
    >
      <p className="font-medium text-slate-800">Registrar cliente nuevo</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Nombre *</Label>
          <TextInput
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nombre"
            autoFocus
          />
        </div>
        <div>
          <Label>Apellido</Label>
          <TextInput
            value={form.surname}
            onChange={(e) => setForm({ ...form, surname: e.target.value })}
            placeholder="Apellido"
          />
        </div>
      </div>
      <div>
        <Label>Teléfono *</Label>
        <TextInput
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="+56912345678"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Dirección *</Label>
          <TextInput
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Dirección"
          />
        </div>
        <div>
          <Label>Comuna *</Label>
          <TextInput
            value={form.comuna}
            onChange={(e) => setForm({ ...form, comuna: e.target.value })}
            placeholder="Comuna"
          />
        </div>
      </div>
      {mutation.isError && (
        <p className="text-sm text-red-600">
          Error: {(mutation.error as Error).message}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!canSave || mutation.isPending}
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar y usar'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

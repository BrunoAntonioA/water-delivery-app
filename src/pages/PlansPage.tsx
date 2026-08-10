import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listAllPlans, updatePlan, type PlanPatch } from '../api/billing'
import { COMPANY_MODULES, MODULE_LABELS, type ModuleKey } from '../types/auth'
import type { Plan } from '../types/billing'
import { formatMoney } from '../lib/format'
import {
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui'

export default function PlansPage() {
  const { data: plans, isLoading } = useQuery({
    queryKey: ['all-plans'],
    queryFn: listAllPlans,
  })

  return (
    <div>
      <PageHeader
        title="Planes"
        subtitle="Define el precio y los módulos de cada plan. Los cambios se reflejan en todo el sistema (registro, muro de pago y control de acceso)."
      />

      {isLoading ? (
        <Spinner />
      ) : !plans || plans.length === 0 ? (
        <EmptyState>No hay planes. Revisa la semilla de la base de datos.</EmptyState>
      ) : (
        <div className="space-y-6">
          {plans.map((p) => (
            <PlanEditor key={p.id} plan={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function PlanEditor({ plan }: { plan: Plan }) {
  const qc = useQueryClient()
  const [name, setName] = useState(plan.name)
  const [description, setDescription] = useState(plan.description ?? '')
  const [price, setPrice] = useState(String(plan.price))
  const [trialDays, setTrialDays] = useState(String(plan.trial_days))
  const [maxUsers, setMaxUsers] = useState(
    plan.max_users == null ? '' : String(plan.max_users)
  )
  const [maxClients, setMaxClients] = useState(
    plan.max_clients == null ? '' : String(plan.max_clients)
  )
  const [modules, setModules] = useState<Set<ModuleKey>>(
    new Set(plan.modules as ModuleKey[])
  )

  function toggle(m: ModuleKey) {
    setModules((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  const save = useMutation({
    mutationFn: () => {
      const patch: PlanPatch = {
        name: name.trim(),
        description: description.trim() || null,
        price: num(price) ?? 0,
        trial_days: num(trialDays) ?? 0,
        max_users: num(maxUsers), // '' → null = ilimitado
        max_clients: num(maxClients),
        modules: COMPANY_MODULES.filter((m) => modules.has(m)),
      }
      return updatePlan(plan.id, patch)
    },
    onSuccess: () => {
      // Refresca todo lo que depende de los planes.
      qc.invalidateQueries({ queryKey: ['all-plans'] })
      qc.invalidateQueries({ queryKey: ['plans'] })
      qc.invalidateQueries({ queryKey: ['subscription'] })
    },
  })

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">
          {plan.name}{' '}
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {plan.key}
          </span>
        </h2>
        <span className="text-sm text-slate-500">
          {formatMoney(plan.price)} / {plan.interval === 'month' ? 'mes' : plan.interval}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Nombre</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Precio (CLP / mes)</Label>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4">
        <Label>Descripción</Label>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <Label>Días de prueba</Label>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
          />
        </div>
        <div>
          <Label>Máx. usuarios</Label>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={maxUsers}
            onChange={(e) => setMaxUsers(e.target.value)}
            placeholder="Ilimitado"
          />
        </div>
        <div>
          <Label>Máx. clientes</Label>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={maxClients}
            onChange={(e) => setMaxClients(e.target.value)}
            placeholder="Ilimitado"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label>Módulos incluidos</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {COMPANY_MODULES.map((m) => {
            const on = modules.has(m)
            return (
              <label
                key={m}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
              >
                <span className="text-sm font-medium text-slate-700">
                  {MODULE_LABELS[m]}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggle(m)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    on ? 'bg-sky-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      on ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            )
          })}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Deja el límite vacío para “ilimitado”.
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        {save.isSuccess && (
          <span className="text-sm text-emerald-600">✓ Guardado</span>
        )}
        {save.isError && (
          <span className="text-sm text-red-600">
            Error: {(save.error as Error).message}
          </span>
        )}
      </div>
    </Card>
  )
}

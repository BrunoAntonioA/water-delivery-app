import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { getCompany, updateCompanyModules } from '../api/admin'
import { getCompanySubscription } from '../api/billing'
import { COMPANY_MODULES, MODULE_LABELS, type ModuleKey } from '../types/auth'
import { CompanyUsers } from '../components/CompanyUsers'
import { CompanySubscription } from '../components/CompanySubscription'
import { CompanyBackup } from '../components/CompanyBackup'
import { CompanyClientsExport } from '../components/CompanyClientsExport'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'

export default function CompanyDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: () => getCompany(id),
    enabled: Boolean(id),
  })
  // Se comparte la caché con la tarjeta de suscripción (misma queryKey).
  const { data: subscription } = useQuery({
    queryKey: ['subscription', id],
    queryFn: () => getCompanySubscription(id),
    enabled: Boolean(id),
  })
  const planModules = subscription?.plan?.modules ?? null

  const modulesMutation = useMutation({
    mutationFn: (modules: string[]) => updateCompanyModules(id, modules),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', id] })
      qc.invalidateQueries({ queryKey: ['companies'] })
    },
  })

  if (isLoading) return <Spinner />
  if (!company)
    return (
      <EmptyState>
        No se encontró la empresa.{' '}
        <Link to="/empresas" className="text-sky-600 hover:underline">
          Volver
        </Link>
      </EmptyState>
    )

  // Si la empresa no trae lista (dato viejo), se asumen todos habilitados.
  const enabled = new Set<ModuleKey>(
    (company.modules as ModuleKey[] | undefined) ?? COMPANY_MODULES
  )

  function toggle(m: ModuleKey) {
    const next = new Set(enabled)
    if (next.has(m)) next.delete(m)
    else next.add(m)
    // Guardamos en el orden canónico.
    modulesMutation.mutate(COMPANY_MODULES.filter((k) => next.has(k)))
  }

  return (
    <div>
      <Link
        to="/empresas"
        className="mb-4 inline-block text-sm text-sky-600 hover:underline"
      >
        ← Volver a empresas
      </Link>
      <PageHeader title={company.name} subtitle="Plan, módulos y usuarios de esta empresa." />

      <CompanySubscription companyId={company.id} />

      {planModules ? (
        <Card className="mb-6 p-4">
          <h2 className="mb-1 font-semibold text-slate-900">
            Módulos del plan
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Esta empresa tiene un plan asignado: los módulos los define el plan.
            Cambia de plan arriba para modificar el acceso.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMPANY_MODULES.map((m) => {
              const on = planModules.includes(m)
              return (
                <div
                  key={m}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    on
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      on ? 'text-emerald-800' : 'text-slate-400'
                    }`}
                  >
                    {MODULE_LABELS[m]}
                  </span>
                  <span className="text-sm">{on ? '✓' : '—'}</span>
                </div>
              )
            })}
          </div>
        </Card>
      ) : (
        <Card className="mb-6 p-4">
          <h2 className="mb-1 font-semibold text-slate-900">Módulos habilitados</h2>
          <p className="mb-3 text-sm text-slate-500">
            Sin plan asignado: controla manualmente qué puede ver esta empresa.
            Los usuarios sólo verán los módulos permitidos por su rol y
            habilitados aquí.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMPANY_MODULES.map((m) => {
              const on = enabled.has(m)
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
                    disabled={modulesMutation.isPending}
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
          {modulesMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              Error al guardar: {(modulesMutation.error as Error).message}
            </p>
          )}
        </Card>
      )}

      <CompanyBackup companyId={company.id} companyName={company.name} />

      <CompanyClientsExport companyId={company.id} companyName={company.name} />

      <h2 className="mb-3 font-semibold text-slate-900">Usuarios</h2>
      <CompanyUsers companyId={company.id} />
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { getCompany } from '../api/admin'
import { CompanyUsers } from '../components/CompanyUsers'
import { EmptyState, PageHeader, Spinner } from '../components/ui'

export default function CompanyDetailPage() {
  const { id = '' } = useParams()
  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: () => getCompany(id),
    enabled: Boolean(id),
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

  return (
    <div>
      <Link
        to="/empresas"
        className="mb-4 inline-block text-sm text-sky-600 hover:underline"
      >
        ← Volver a empresas
      </Link>
      <PageHeader title={company.name} subtitle="Usuarios de esta empresa." />
      <CompanyUsers companyId={company.id} />
    </div>
  )
}

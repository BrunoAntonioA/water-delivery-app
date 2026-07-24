import { useAuth } from '../lib/auth'
import { CompanyUsers } from '../components/CompanyUsers'
import { EmptyState, PageHeader } from '../components/ui'

export default function UsersPage() {
  const { profile } = useAuth()

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle="Administra quién puede acceder y qué módulos puede usar."
      />
      {profile?.company_id ? (
        <CompanyUsers companyId={profile.company_id} />
      ) : (
        <EmptyState>Tu cuenta no está asociada a una empresa.</EmptyState>
      )}
    </div>
  )
}

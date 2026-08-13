import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './lib/auth'
import { getTrialPlan } from './api/billing'
import { effectiveModules, ROLE_LABELS, type ModuleKey } from './types/auth'
import {
  subscriptionActive,
  accessDaysLeft,
  resolvedCompanyModules,
} from './types/billing'

/**
 * Módulos del plan "Prueba" (editable en el módulo Planes). Se cargan una vez y
 * se comparten por caché (misma queryKey). Se usan para resolver el acceso
 * durante el período de prueba.
 */
function useTrialModules(): ModuleKey[] | undefined {
  const { data } = useQuery({
    queryKey: ['trial-plan'],
    queryFn: getTrialPlan,
    staleTime: 5 * 60_000,
  })
  return data?.modules as ModuleKey[] | undefined
}
import { Button, Spinner } from './components/ui'
import { BillingWall } from './components/BillingWall'
import ClientsPage from './pages/ClientsPage'
import ProductsPage from './pages/ProductsPage'
import OrdersPage from './pages/OrdersPage'
import OrdersReportPage from './pages/OrdersReportPage'
import DeliveriesSummaryPage from './pages/DeliveriesSummaryPage'
import RoutesPage from './pages/RoutesPage'
import RouteDetailPage from './pages/RouteDetailPage'
import RouteLoadPage from './pages/RouteLoadPage'
import CostsPage from './pages/CostsPage'
import AbastecimientoPage from './pages/AbastecimientoPage'
import CompanyDetailPage from './pages/CompanyDetailPage'
import TemplatesPage from './pages/TemplatesPage'
import UsersPage from './pages/UsersPage'
import CompaniesPage from './pages/CompaniesPage'
import PlansPage from './pages/PlansPage'
import SubscriptionPage from './pages/SubscriptionPage'
import SignupPage from './pages/SignupPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import LoginPage from './pages/LoginPage'
import { VerifyEmailWall } from './components/VerifyEmailWall'
import { FlowReturnScreen } from './components/FlowReturnScreen'
import { Logo } from './components/Logo'
import TermsPage from './pages/TermsPage'

const NAV: {
  module: ModuleKey
  to: string
  label: string
  icon: React.ReactNode
}[] = [
  { module: 'rutas', to: '/rutas', label: 'Rutas', icon: '🚚' },
  { module: 'entregas', to: '/entregas', label: 'Entregas', icon: '📋' },
  { module: 'pedidos', to: '/pedidos', label: 'Pedidos', icon: '📦' },
  { module: 'clientes', to: '/clientes', label: 'Clientes', icon: '👥' },
  { module: 'productos', to: '/productos', label: 'Productos', icon: '💧' },
  { module: 'costos', to: '/costos', label: 'Costos', icon: '💸' },
  { module: 'abastecimiento', to: '/abastecimiento', label: 'Suministros', icon: '🚰' },
  { module: 'reportes', to: '/reportes', label: 'Reportes', icon: '📊' },
  { module: 'plantillas', to: '/plantillas', label: 'Plantillas', icon: '💬' },
  { module: 'usuarios', to: '/usuarios', label: 'Usuarios', icon: '🔑' },
  { module: 'suscripcion', to: '/suscripcion', label: 'Suscripción', icon: '💳' },
  { module: 'empresas', to: '/empresas', label: 'Empresas', icon: '🏢' },
  { module: 'planes', to: '/planes', label: 'Planes', icon: '🏷️' },
]

// Ruta protegida: si el rol no puede ver el módulo, redirige a su primer módulo.
function Protected({
  module,
  home,
  children,
}: {
  module: ModuleKey
  home: string
  children: React.ReactNode
}) {
  const { profile, company, subscription } = useAuth()
  const trialModules = useTrialModules()
  const companyModules = resolvedCompanyModules(
    subscription,
    company?.modules,
    trialModules
  )
  const allowed = profile ? effectiveModules(profile.role, companyModules) : []
  if (!profile || !allowed.includes(module)) {
    return <Navigate to={home} replace />
  }
  return <>{children}</>
}

function SidebarNav({
  items,
  onNavigate,
  size = 'md',
}: {
  items: typeof NAV
  onNavigate?: () => void
  size?: 'md' | 'lg'
}) {
  const big = size === 'lg'
  return (
    <nav className={`flex flex-col ${big ? 'gap-2' : 'gap-1'}`}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex w-full items-center rounded-lg font-medium transition-colors ${
              big ? 'gap-3 px-4 py-3.5 text-lg' : 'gap-2.5 px-3 py-2.5 text-base'
            } ${
              isActive
                ? 'bg-sky-100 text-sky-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`
          }
        >
          <span className={big ? 'text-2xl' : 'text-lg'}>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Spinner />
      <p className="text-sm text-slate-500">Cargando tu información…</p>
    </div>
  )
}

export default function App() {
  const { session, profile, company, subscription, loading, profileLoading, signOut } =
    useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const trialModules = useTrialModules()

  // Nueva contraseña: se llega por el enlace de recuperación (crea una sesión
  // temporal), así que debe mostrarse siempre, sin importar el estado de auth.
  if (location.pathname === '/nueva-clave') return <ResetPasswordPage />

  // Términos y Condiciones: documento público, accesible con o sin sesión.
  if (location.pathname === '/terminos') return <TermsPage />

  if (loading) return <LoadingScreen />

  // Sin sesión → login, con registro público en /registro (enlace desde la landing).
  if (!session) {
    return (
      <Routes>
        <Route path="/registro" element={<SignupPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  // Con sesión pero el perfil aún cargando (p. ej. tras refrescar el token o con
  // internet lento): mostramos "Cargando" en lugar de un "Sin acceso" prematuro.
  if (profileLoading) return <LoadingScreen />

  // Con sesión pero sin perfil, o perfil desactivado → sin acceso.
  // (active === false sólo cuando está explícitamente desactivado; si la columna
  // aún no existe en la BD, no bloquea.)
  const deactivated = profile?.active === false
  if (!profile || deactivated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-4xl">🚫</div>
        <div>
          <p className="font-semibold text-slate-900">Sin acceso</p>
          <p className="text-sm text-slate-500">
            {deactivated
              ? 'Tu cuenta está desactivada. Contacta a tu administrador.'
              : 'Tu cuenta no está asignada a ninguna empresa. Contacta a tu administrador.'}
          </p>
        </div>
        <Button variant="secondary" onClick={signOut}>
          Cerrar sesión
        </Button>
      </div>
    )
  }

  // Correo sin verificar → pantalla de verificación (los usuarios creados por un
  // admin y el superadmin ya vienen confirmados, así que no la ven).
  if (!session.user.email_confirmed_at) {
    return (
      <VerifyEmailWall email={session.user.email ?? ''} onSignOut={signOut} />
    )
  }

  // Retorno desde Flow (…/suscripcion?flow=return): se resuelve el estado del
  // pago (el webhook confirma de forma asíncrona) ANTES del muro de pago, para
  // que un usuario recién pagado no quede atrapado en el bloqueo.
  if (new URLSearchParams(location.search).get('flow') === 'return') {
    return <FlowReturnScreen />
  }

  // Muro de pago: si la empresa no tiene suscripción vigente (prueba vencida,
  // pausada o cancelada) se bloquea el acceso. El superadmin no depende de
  // empresa, así que nunca lo ve.
  if (profile.role !== 'superadmin' && company && !subscriptionActive(subscription)) {
    return (
      <BillingWall
        companyName={company.name}
        subscription={subscription}
        onSignOut={signOut}
      />
    )
  }

  // Durante la prueba se otorgan los módulos del plan "Prueba" (editable en el
  // módulo Planes); con plan activo, los del plan; si no (empresa "legado"), su
  // lista manual.
  const companyModules = resolvedCompanyModules(
    subscription,
    company?.modules,
    trialModules
  )
  const allowed = effectiveModules(profile.role, companyModules)
  const navItems = NAV.filter((n) => allowed.includes(n.module))
  const home = navItems[0]?.to ?? '/'
  const trialDaysLeft =
    subscription?.status === 'trialing' ? accessDaysLeft(subscription) : null

  // Sin módulos habilitados (el superadmin los desactivó todos): evitamos un
  // bucle de redirección mostrando un aviso.
  if (navItems.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-4xl">🔒</div>
        <div>
          <p className="font-semibold text-slate-900">Sin módulos habilitados</p>
          <p className="text-sm text-slate-500">
            Tu empresa no tiene módulos activos. Contacta a tu administrador.
          </p>
        </div>
        <Button variant="secondary" onClick={signOut}>
          Cerrar sesión
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex w-full items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {/* Abrir menú lateral en móvil */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Abrir menú"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2 font-bold text-slate-900">
            <Logo className="h-7 w-7 shrink-0 object-contain" />
            <span className="truncate">{company?.name ?? 'Gestiona Agua'}</span>
          </div>

          {/* Usuario + salir a la derecha */}
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {trialDaysLeft != null && (
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
                title={`Período de prueba${subscription?.plan?.name ? ` del plan ${subscription.plan.name}` : ''}`}
              >
                🎁 Prueba
                <span className="hidden sm:inline">:</span>
                <span className="font-semibold">
                  {trialDaysLeft} {trialDaysLeft === 1 ? 'día' : 'días'}
                </span>
              </span>
            )}
            <div className="hidden text-right sm:block">
              <p className="font-medium text-slate-700">
                {profile.full_name || profile.email}
              </p>
              <p className="text-xs text-slate-400">
                {ROLE_LABELS[profile.role]}
              </p>
            </div>
            <Button variant="secondary" onClick={signOut}>
              Salir
            </Button>
          </div>
        </div>
      </header>

      <div className="flex w-full">
        {/* Menú lateral en escritorio */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 p-3 lg:flex">
          <SidebarNav items={navItems} />
          <NavLink
            to="/terminos"
            className="mt-auto px-3 pt-4 text-xs text-slate-400 hover:text-slate-600 hover:underline"
          >
            Términos y condiciones
          </NavLink>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route
            path="/pedidos"
            element={
              <Protected module="pedidos" home={home}>
                <OrdersPage />
              </Protected>
            }
          />
          <Route
            path="/reportes"
            element={
              <Protected module="reportes" home={home}>
                <OrdersReportPage />
              </Protected>
            }
          />
          <Route
            path="/entregas"
            element={
              <Protected module="entregas" home={home}>
                <DeliveriesSummaryPage />
              </Protected>
            }
          />
          <Route
            path="/rutas"
            element={
              <Protected module="rutas" home={home}>
                <RoutesPage />
              </Protected>
            }
          />
          <Route
            path="/rutas/:id"
            element={
              <Protected module="rutas" home={home}>
                <RouteDetailPage />
              </Protected>
            }
          />
          <Route
            path="/rutas/:id/carga"
            element={
              <Protected module="rutas" home={home}>
                <RouteLoadPage />
              </Protected>
            }
          />
          <Route
            path="/clientes"
            element={
              <Protected module="clientes" home={home}>
                <ClientsPage />
              </Protected>
            }
          />
          <Route
            path="/productos"
            element={
              <Protected module="productos" home={home}>
                <ProductsPage />
              </Protected>
            }
          />
          <Route
            path="/costos"
            element={
              <Protected module="costos" home={home}>
                <CostsPage />
              </Protected>
            }
          />
          <Route
            path="/abastecimiento"
            element={
              <Protected module="abastecimiento" home={home}>
                <AbastecimientoPage />
              </Protected>
            }
          />
          <Route
            path="/plantillas"
            element={
              <Protected module="plantillas" home={home}>
                <TemplatesPage />
              </Protected>
            }
          />
          <Route
            path="/usuarios"
            element={
              <Protected module="usuarios" home={home}>
                <UsersPage />
              </Protected>
            }
          />
          <Route
            path="/suscripcion"
            element={
              <Protected module="suscripcion" home={home}>
                <SubscriptionPage />
              </Protected>
            }
          />
          <Route
            path="/empresas"
            element={
              <Protected module="empresas" home={home}>
                <CompaniesPage />
              </Protected>
            }
          />
          <Route
            path="/empresas/:id"
            element={
              <Protected module="empresas" home={home}>
                <CompanyDetailPage />
              </Protected>
            }
          />
          <Route
            path="/planes"
            element={
              <Protected module="planes" home={home}>
                <PlansPage />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
        </main>
      </div>

      {/* Menú lateral (drawer) en móvil */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col overflow-y-auto bg-white p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex min-w-0 items-center gap-2 font-bold text-slate-900">
                <Logo className="h-6 w-6 shrink-0 object-contain" />
                <span className="min-w-0 break-words">
                  {company?.name ?? 'Gestiona Agua'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Cerrar menú"
              >
                ✕
              </button>
            </div>
            <SidebarNav
              items={navItems}
              onNavigate={() => setMenuOpen(false)}
              size="lg"
            />
            <NavLink
              to="/terminos"
              onClick={() => setMenuOpen(false)}
              className="mt-auto px-4 pt-4 text-sm text-slate-400 hover:text-slate-600 hover:underline"
            >
              Términos y condiciones
            </NavLink>
          </aside>
        </div>
      )}
    </div>
  )
}

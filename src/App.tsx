import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { canAccess, ROLE_LABELS, ROLE_MODULES, type ModuleKey } from './types/auth'
import { Button, Spinner } from './components/ui'
import ClientsPage from './pages/ClientsPage'
import ProductsPage from './pages/ProductsPage'
import OrdersPage from './pages/OrdersPage'
import OrdersReportPage from './pages/OrdersReportPage'
import RoutesPage from './pages/RoutesPage'
import RouteDetailPage from './pages/RouteDetailPage'
import CostsPage from './pages/CostsPage'
import CompanyDetailPage from './pages/CompanyDetailPage'
import TemplatesPage from './pages/TemplatesPage'
import UsersPage from './pages/UsersPage'
import CompaniesPage from './pages/CompaniesPage'
import LoginPage from './pages/LoginPage'

const NAV: { module: ModuleKey; to: string; label: string; icon: string }[] = [
  { module: 'rutas', to: '/rutas', label: 'Rutas', icon: '🚚' },
  { module: 'pedidos', to: '/pedidos', label: 'Pedidos', icon: '📦' },
  { module: 'clientes', to: '/clientes', label: 'Clientes', icon: '👥' },
  { module: 'productos', to: '/productos', label: 'Productos', icon: '💧' },
  { module: 'costos', to: '/costos', label: 'Costos', icon: '💸' },
  { module: 'reportes', to: '/reportes', label: 'Reportes', icon: '📊' },
  { module: 'plantillas', to: '/plantillas', label: 'Plantillas', icon: '💬' },
  { module: 'usuarios', to: '/usuarios', label: 'Usuarios', icon: '🔑' },
  { module: 'empresas', to: '/empresas', label: 'Empresas', icon: '🏢' },
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
  const { profile } = useAuth()
  if (!profile || !canAccess(profile.role, module)) {
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
              big ? 'gap-3 px-4 py-3.5 text-lg' : 'gap-2 px-3 py-2 text-sm'
            } ${
              isActive
                ? 'bg-sky-100 text-sky-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`
          }
        >
          <span className={big ? 'text-2xl' : ''}>{item.icon}</span>
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
  const { session, profile, company, loading, profileLoading, signOut } =
    useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  if (loading) return <LoadingScreen />

  // Sin sesión → login.
  if (!session) return <LoginPage />

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

  const allowed = ROLE_MODULES[profile.role]
  const navItems = NAV.filter((n) => allowed.includes(n.module))
  const home = navItems[0]?.to ?? '/pedidos'

  return (
    <div className="min-h-screen overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
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

          <div className="flex items-center gap-2 font-bold text-slate-900">
            <span className="text-xl">💧</span>
            <span>{company?.name ?? 'AquaGestión'}</span>
          </div>

          {/* Usuario + salir a la derecha */}
          <div className="ml-auto flex items-center gap-3 text-sm">
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

      <div className="mx-auto flex w-full max-w-6xl">
        {/* Menú lateral en escritorio */}
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 p-3 lg:block">
          <SidebarNav items={navItems} />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-8">
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
              <span className="truncate font-bold text-slate-900">
                💧 {company?.name ?? 'AquaGestión'}
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
          </aside>
        </div>
      )}
    </div>
  )
}

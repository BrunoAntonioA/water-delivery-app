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
import UsersPage from './pages/UsersPage'
import CompaniesPage from './pages/CompaniesPage'
import LoginPage from './pages/LoginPage'

const NAV: { module: ModuleKey; to: string; label: string; icon: string }[] = [
  { module: 'rutas', to: '/rutas', label: 'Rutas', icon: '🚚' },
  { module: 'pedidos', to: '/pedidos', label: 'Pedidos', icon: '📦' },
  { module: 'clientes', to: '/clientes', label: 'Clientes', icon: '👥' },
  { module: 'productos', to: '/productos', label: 'Productos', icon: '💧' },
  { module: 'reportes', to: '/reportes', label: 'Reportes', icon: '📊' },
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

export default function App() {
  const { session, profile, company, loading, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  // Sin sesión → login.
  if (!session) return <LoginPage />

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
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <span className="text-xl">💧</span>
            <span>AquaGestión</span>
          </div>

          {/* Navegación en escritorio */}
          <nav className="hidden gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-100 text-sky-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Usuario + salir en escritorio */}
          <div className="ml-auto hidden items-center gap-3 text-sm lg:flex">
            <div className="text-right">
              <p className="font-medium text-slate-700">
                {company?.name ?? 'Superadmin'}
              </p>
              <p className="text-xs text-slate-400">
                {profile.full_name || profile.email} ·{' '}
                {ROLE_LABELS[profile.role]}
              </p>
            </div>
            <Button variant="secondary" onClick={signOut}>
              Salir
            </Button>
          </div>

          {/* Botón de menú en móvil */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="ml-auto rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Menú"
            aria-expanded={menuOpen}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              {menuOpen ? (
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Panel desplegable en móvil */}
        {menuOpen && (
          <div className="border-t border-slate-100 px-4 py-3 lg:hidden">
            <div className="mb-3">
              <p className="font-medium text-slate-700">
                {company?.name ?? 'Superadmin'}
              </p>
              <p className="text-xs text-slate-400">
                {profile.full_name || profile.email} ·{' '}
                {ROLE_LABELS[profile.role]}
              </p>
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-sky-100 text-sky-700'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <span className="mr-2">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={signOut}
            >
              Salir
            </Button>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
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
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  )
}

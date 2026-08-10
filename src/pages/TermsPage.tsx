import { useNavigate } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui'

/**
 * Términos y Condiciones + Política de Privacidad (incluye la declaración de
 * transferencia internacional de datos, Ley 21.719). Página pública, enlazada
 * desde el registro y desde el menú de la app. Documento base: conviene que un
 * abogado lo valide antes de la entrada en vigencia de la ley.
 */
export default function TermsPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <Logo className="h-7 w-7 object-contain" />
            <span>Gestiona Agua</span>
          </div>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            ← Volver
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Términos y Condiciones y Política de Privacidad
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Última actualización: agosto de 2026
        </p>

        <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              1. Aceptación
            </h2>
            <p>
              Al crear una cuenta y usar Gestiona Agua (el “Servicio”) aceptas
              estos Términos y esta Política de Privacidad. Si no estás de
              acuerdo, no utilices el Servicio.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              2. El servicio
            </h2>
            <p>
              Gestiona Agua es un software de gestión para empresas de reparto de
              agua (clientes, pedidos, rutas, cobros, costos y reportes),
              operado por <strong>GESTIONA AGUA SPA</strong>, RUT{' '}
              <strong>78.476.999-2</strong>, contacto{' '}
              <a
                className="text-sky-600 hover:underline"
                href="mailto:bruno.aguilar.b@gmail.com"
              >
                bruno.aguilar.b@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              3. Datos que se tratan
            </h2>
            <p>
              Para prestar el Servicio se tratan: datos de la cuenta (nombre,
              correo, teléfono), datos de la empresa (razón social, RUT,
              contacto) y datos que la empresa carga sobre sus propios clientes
              (nombre, teléfono, identificación, direcciones), pedidos, rutas y
              pagos. No se solicitan datos sensibles.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              4. Finalidad y base de licitud
            </h2>
            <p>
              Los datos se tratan para operar el Servicio contratado (ejecución
              del contrato), cumplir obligaciones legales y contables, y prestar
              soporte. No se venden ni se usan con fines ajenos al Servicio.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              5. Roles (responsable y encargado)
            </h2>
            <p>
              Cada empresa usuaria es la <strong>responsable</strong> de los
              datos de sus propios clientes: decide qué datos carga y con qué
              finalidad. Gestiona Agua actúa como <strong>encargado</strong>,
              tratando esos datos por cuenta y según las instrucciones de la
              empresa.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              6. Almacenamiento y transferencia internacional
            </h2>
            <p>
              La infraestructura del Servicio está alojada en{' '}
              <strong>Amazon Web Services (AWS), región us-west-2 (Estados
              Unidos)</strong>, a través de nuestro proveedor Supabase. Por lo
              tanto, los datos personales se almacenan y procesan{' '}
              <strong>fuera de Chile</strong>, lo que constituye una
              transferencia internacional de datos.
            </p>
            <p className="mt-2">
              Esta transferencia se realiza al amparo de garantías contractuales
              apropiadas (cláusulas de tratamiento de datos con nuestros
              proveedores, que a su vez aplican salvaguardas estándar), conforme
              a la normativa chilena de protección de datos. Al usar el Servicio,
              tomas conocimiento y aceptas esta transferencia.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              7. Proveedores (subencargados)
            </h2>
            <p>Para operar, el Servicio se apoya en:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <strong>Supabase / AWS</strong> (EE. UU.): base de datos,
                autenticación y almacenamiento de archivos.
              </li>
              <li>
                <strong>Flow</strong> (Chile): procesamiento de pagos de la
                suscripción.
              </li>
              <li>
                <strong>Brevo</strong>: envío de correos transaccionales
                (verificación y recuperación de cuenta).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              8. Conservación
            </h2>
            <p>
              Los datos se conservan mientras exista la cuenta y por los plazos
              legales y contables aplicables. Al terminar la relación, los datos
              se eliminan o anonimizan, salvo aquello que la ley exija conservar.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              9. Tus derechos
            </h2>
            <p>
              Puedes ejercer los derechos de acceso, rectificación, supresión
              (eliminación), oposición y portabilidad de tus datos. El Servicio
              permite exportar y eliminar información; para solicitudes escríbenos
              a{' '}
              <a
                className="text-sky-600 hover:underline"
                href="mailto:bruno.aguilar.b@gmail.com"
              >
                bruno.aguilar.b@gmail.com
              </a>
              . Si eres cliente de una empresa usuaria, dirige tu solicitud a esa
              empresa (responsable de tus datos).
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              10. Seguridad
            </h2>
            <p>
              Aplicamos medidas técnicas y organizativas razonables: cifrado en
              tránsito, aislamiento de datos por empresa, control de acceso por
              rol y respaldos. Ningún sistema es 100% infalible; ante un
              incidente de seguridad actuaremos y notificaremos conforme a la
              ley.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              11. Cambios y contacto
            </h2>
            <p>
              Podemos actualizar estos términos; avisaremos los cambios
              relevantes. Para cualquier consulta:{' '}
              <a
                className="text-sky-600 hover:underline"
                href="mailto:bruno.aguilar.b@gmail.com"
              >
                bruno.aguilar.b@gmail.com
              </a>{' '}
              · WhatsApp{' '}
              <a
                className="text-sky-600 hover:underline"
                href="https://wa.me/56945652653"
                target="_blank"
                rel="noopener noreferrer"
              >
                +56 9 4565 2653
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-8">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            ← Volver
          </Button>
        </div>
      </main>
    </div>
  )
}

# 💧 AquaGestión — App de reparto de agua

Aplicación web (React + TypeScript) para administrar una distribuidora de agua:
clientes con varias direcciones, catálogo de productos, pedidos con flujo de
estados, y **cobro por WhatsApp** con el detalle del pedido pre-cargado.

El frontend es 100% React; los datos, imágenes y autenticación se manejan con
[Supabase](https://supabase.com).

## Funcionalidades

- **Clientes**: nombre, apellido, identificación (opcional), teléfono y
  **múltiples direcciones** de entrega.
- **Productos**: nombre, descripción, precio e imagen (subida a Supabase Storage).
- **Pedidos**: un cliente + varios productos, con estados en orden:
  `Pedido → Entregado → Pagado`. Al marcar como **Pagado** se registra el
  **método de pago** (transferencia o efectivo) y el **monto recibido**; el botón
  de confirmar sólo se habilita si el monto coincide exactamente con el total.
- **Cobro por WhatsApp**: para pedidos en estado *Pedido* o *Entregado*, un botón
  abre WhatsApp con un mensaje que incluye el detalle y el total a cobrar.
- **Rutas de reparto**: agrupa pedidos en rutas (con fecha y repartidor) y
  **ordena las paradas arrastrándolas** para definir el recorrido. La tabla se
  divide en **Por entregar** (arrastrable) y **Entregados**; una parada baja
  automáticamente a la sección de entregados al marcarla como entregada. Desde la
  ruta también puedes cambiar el estado del pedido y cobrar por WhatsApp. Un
  pedido sólo puede estar en una ruta a la vez.
- **Filtros y paginación**: en Pedidos filtras por día y por estado (incluido
  “Pendientes de pago”); en Rutas filtras por día y cada ruta muestra su avance
  (Entregados X/Y, Pagados Z/Y) y un estado general. Ambas listas paginan de a 10.
- **Multi-empresa (multi-tenant)**: cada empresa es un cliente independiente con
  sus propios usuarios y datos totalmente aislados (garantizado por RLS en la base
  de datos). Roles:
  - **Superadmin** (tú): crea empresas y su administrador. Módulo *Empresas*.
  - **Admin** (por empresa): todos los módulos + gestión de usuarios de su empresa.
  - **Operador**: Pedidos, Clientes, Productos.
  - **Repartidor**: sólo ve **la(s) ruta(s) asignada(s) a él** (el admin lo asigna
    en la lista de Rutas). Puede reordenar las paradas y marcar entregado/cobrar,
    pero no agregar ni quitar pedidos de la ruta. El aislamiento lo aplica RLS.

---

## 1. Configurar Supabase

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En el panel, ve a **SQL Editor → New query**, pega el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo. Esto crea las tablas,
   las políticas de acceso y el bucket de imágenes `product-images`.
3. Copia tus credenciales:
   - **Project Settings → Data API → Project URL** → `VITE_SUPABASE_URL`
   - **Project Settings → API Keys → clave `publishable`** (empieza con
     `sb_publishable_`) → `VITE_SUPABASE_PUBLISHABLE_KEY`

> 🔑 **Publishable vs. Secret key**: usa siempre la **publishable key** en este app;
> es segura para el navegador. **Nunca** pongas la **secret key** (`sb_secret_...`)
> en el frontend ni en `.env` — se compilaría dentro del bundle y quedaría visible
> para cualquiera, saltándose toda la seguridad. La secret key sólo va en un backend
> (por ejemplo, una Edge Function), nunca aquí.

> ✅ **Seguridad de datos**: el esquema activa **Row Level Security (RLS)** con
> aislamiento por empresa. Cada usuario sólo puede ver/editar datos de su propia
> empresa, y esto se aplica en la base de datos — ningún error del frontend puede
> filtrar datos entre empresas.

## 2. Autenticación y multi-empresa (una sola vez)

1. **Supabase → Authentication → Providers → Email**:
   - Desactiva **"Confirm email"** (así los usuarios que crea un admin pueden
     entrar de inmediato con su contraseña).
   - Deja **"Allow new users to sign up"** *activado* (el app crea usuarios con
     `signUp` desde el frontend).
2. **Crea tu usuario superadmin**: Supabase → Authentication → Users → **Add user**
   (tu email + contraseña). Copia el **UUID** del usuario.
3. En **SQL Editor**, corre (reemplazando el UUID y tus datos):
   ```sql
   insert into profiles (id, company_id, role, full_name, email)
   values ('TU-UUID-AQUI', null, 'superadmin', 'Tu Nombre', 'tu@correo.com');
   ```
4. Entra al app con ese email/contraseña. En **Empresas** puedes crear empresas y
   su administrador; cada admin luego gestiona los usuarios de su empresa en
   **Usuarios**. Tus datos anteriores quedaron en la empresa **"Mi Empresa"**:
   créale un usuario admin para gestionarlos.

> 🗑️ **Desactivar vs. eliminar usuarios**: "Desactivar" quita el acceso pero
> conserva la cuenta; puedes **Reactivar**la cuando quieras (o al volver a crear un
> usuario con el mismo correo, se reactiva). Esto evita el error de *rate limit* de
> Supabase al reusar un correo. Para eliminar una cuenta **por completo** (y liberar
> el correo del todo), bórrala en **Authentication → Users** del panel de Supabase.

> ⚠️ **Nota de seguridad (sin backend)**: como el app es sólo frontend, crear
> usuarios usa `signUp`, así que los registros deben quedar habilitados. Una cuenta
> sin perfil (o desactivada) no puede ver ningún dato, por lo que el riesgo es bajo.
> Para cerrarlo del todo se puede mover la creación a una Edge Function con la
> secret key — opcional, más adelante.

## 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales y preferencias (moneda, idioma, nombre de la
empresa para el mensaje de WhatsApp).

## 4. Instalar y correr

```bash
npm install
npm run dev
```

Abre la URL que muestra la terminal (por defecto http://localhost:5173).

## 5. Compilar para producción

```bash
npm run build      # genera /dist
npm run preview    # sirve el build localmente para probar
```

Puedes desplegar la carpeta `dist/` en Vercel, Netlify, Cloudflare Pages, etc.
Recuerda definir las mismas variables `VITE_*` en el panel del proveedor.

---

## Cómo funciona el cobro por WhatsApp

El botón **Cobrar** construye un enlace `https://wa.me/<telefono>?text=<mensaje>`
con el número del cliente y un mensaje que lista los productos y el total. Al
hacer clic se abre WhatsApp (web o app) con el mensaje ya escrito; **tú presionas
enviar**. No requiere la API de WhatsApp Business ni ningún costo adicional.

Para que funcione, guarda el teléfono del cliente en formato internacional
(ej. `+50688887777`).

## Estructura del proyecto

```
src/
  api/         Acceso a datos de Supabase (clients, products, orders)
  components/  UI reutilizable (Modal, Button, StatusBadge, ...)
  lib/         supabase, formato de moneda/fecha, WhatsApp
  pages/       ClientsPage, ProductsPage, OrdersPage
  types/       Tipos de la base de datos
supabase/
  schema.sql   Script para crear todo en Supabase
```

## Próximos pasos sugeridos

- Autenticación con Supabase Auth + políticas RLS por usuario.
- Envío automático de WhatsApp (Meta Cloud API / Twilio) vía Edge Function.
- Historial de pagos y reportes.

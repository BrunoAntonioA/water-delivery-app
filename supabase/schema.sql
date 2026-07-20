-- ============================================================================
--  Water Delivery App — esquema de base de datos (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
--  Cómo usar:
--    1. Entra a tu proyecto de Supabase → SQL Editor → New query
--    2. Pega TODO este archivo y ejecútalo.
--    3. Crea el bucket de imágenes (ver el bloque de Storage al final).
-- ============================================================================

-- Extensión para generar UUIDs
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
--  Tipos
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('ordered', 'delivered', 'paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type payment_method as enum ('transferencia', 'efectivo');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    -- superadmin: administra empresas (tú). admin: dueño de una empresa.
    -- operador: pedidos/clientes/productos. repartidor: rutas.
    create type user_role as enum ('superadmin', 'admin', 'operador', 'repartidor');
  end if;
end$$;

-- ----------------------------------------------------------------------------
--  Clientes
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  surname     text not null,
  national_id text,                       -- opcional (cédula / DNI / RUT)
  phone       text not null,              -- en formato internacional, ej: +50688887777
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Direcciones (un cliente puede tener varias)
-- ----------------------------------------------------------------------------
create table if not exists addresses (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  label       text,                       -- ej: "Casa", "Oficina"
  address     text not null,
  comuna      text,                       -- comuna / distrito
  observation text,                       -- observaciones extra de la entrega
  created_at  timestamptz not null default now()
);
create index if not exists addresses_client_id_idx on addresses (client_id);

-- Migración para bases de datos que ya tenían la tabla "addresses".
alter table addresses add column if not exists comuna text;
alter table addresses add column if not exists observation text;

-- ----------------------------------------------------------------------------
--  Productos
-- ----------------------------------------------------------------------------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price       numeric(12, 2) not null default 0 check (price >= 0),
  image_url   text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Pedidos
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete restrict,
  address_id     uuid references addresses (id) on delete set null,
  status         order_status not null default 'ordered',
  total          numeric(12, 2) not null default 0 check (total >= 0),
  payment_method payment_method,                 -- se llena al marcar como pagado
  paid_amount    numeric(12, 2),                 -- monto recibido al pagar
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists orders_client_id_idx on orders (client_id);
create index if not exists orders_status_idx on orders (status);

-- Migración para bases de datos que ya tenían la tabla "orders" sin estas columnas.
alter table orders add column if not exists payment_method payment_method;
alter table orders add column if not exists paid_amount numeric(12, 2);

-- ----------------------------------------------------------------------------
--  Ítems del pedido (un pedido tiene varios productos)
-- ----------------------------------------------------------------------------
create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id) on delete restrict,
  quantity   integer not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0)  -- precio congelado al momento del pedido
);
create index if not exists order_items_order_id_idx on order_items (order_id);

-- ----------------------------------------------------------------------------
--  Rutas de reparto
-- ----------------------------------------------------------------------------
create table if not exists routes (
  id         uuid primary key default gen_random_uuid(),
  name       text,                         -- ej: "Ruta Norte"
  route_date date not null,                -- día de reparto
  driver     text,                         -- nombre del repartidor
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists routes_date_idx on routes (route_date);

-- ----------------------------------------------------------------------------
--  Paradas de la ruta (pedidos ordenados por "position").
--  Un pedido sólo puede estar en una ruta (order_id es único).
-- ----------------------------------------------------------------------------
create table if not exists route_stops (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references routes (id) on delete cascade,
  order_id   uuid not null references orders (id) on delete cascade,
  position   integer not null default 0,   -- orden de entrega dentro de la ruta
  created_at timestamptz not null default now(),
  unique (order_id)
);
create index if not exists route_stops_route_id_idx on route_stops (route_id);

-- ============================================================================
--  MULTI-EMPRESA (multi-tenant): empresas, usuarios y aislamiento de datos
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Empresas (cada empresa es un cliente tuyo / un tenant)
-- ----------------------------------------------------------------------------
create table if not exists companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Perfiles: enlaza cada usuario de Supabase Auth con su empresa y rol.
--  El id es el mismo que auth.users.id.
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references companies (id) on delete cascade, -- null = superadmin
  role       user_role not null default 'operador',
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);
create index if not exists profiles_company_id_idx on profiles (company_id);

-- ----------------------------------------------------------------------------
--  Funciones auxiliares (SECURITY DEFINER: leen profiles sin gatillar RLS,
--  evitando recursión en las políticas).
-- ----------------------------------------------------------------------------
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'superadmin'
  )
$$;

create or replace function public.is_company_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  )
$$;

-- ----------------------------------------------------------------------------
--  Agregar company_id a todas las tablas de datos. El default lo llena solo
--  con la empresa del usuario que inserta, así el frontend no tiene que enviarlo.
-- ----------------------------------------------------------------------------
alter table clients     add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table addresses   add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table products    add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table orders      add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table order_items add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table routes      add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table route_stops add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();

-- ----------------------------------------------------------------------------
--  Migración de datos existentes: crea una empresa inicial y asigna a ella
--  todos los registros que aún no tengan empresa.
-- ----------------------------------------------------------------------------
do $$
declare
  cid uuid;
begin
  select id into cid from companies order by created_at limit 1;
  if cid is null then
    insert into companies (name) values ('Mi Empresa') returning id into cid;
  end if;
  update clients     set company_id = cid where company_id is null;
  update addresses   set company_id = cid where company_id is null;
  update products    set company_id = cid where company_id is null;
  update orders      set company_id = cid where company_id is null;
  update order_items set company_id = cid where company_id is null;
  update routes      set company_id = cid where company_id is null;
  update route_stops set company_id = cid where company_id is null;
end$$;

-- ============================================================================
--  Row Level Security (RLS) — AISLAMIENTO POR EMPRESA
-- ----------------------------------------------------------------------------
--  Cada usuario sólo puede ver/editar datos de SU empresa. Esto se aplica en
--  la base de datos, así que ningún error del frontend puede filtrar datos
--  entre empresas.
-- ============================================================================
alter table clients     enable row level security;
alter table addresses   enable row level security;
alter table products    enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;
alter table routes      enable row level security;
alter table route_stops enable row level security;
alter table companies   enable row level security;
alter table profiles    enable row level security;

-- Tablas de datos: acceso sólo a filas de la empresa del usuario.
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'addresses', 'products', 'orders', 'order_items', 'routes', 'route_stops']
  loop
    execute format('drop policy if exists "allow_all_%1$s" on %1$s;', t);       -- limpia política antigua
    execute format('drop policy if exists "tenant_%1$s" on %1$s;', t);
    execute format(
      'create policy "tenant_%1$s" on %1$s for all
         using (company_id = current_company_id())
         with check (company_id = current_company_id());',
      t
    );
  end loop;
end$$;

-- Empresas: el superadmin administra todas; cada usuario lee la suya; el admin
-- puede renombrar la suya.
drop policy if exists "companies_read" on companies;
create policy "companies_read" on companies for select
  using (is_superadmin() or id = current_company_id());

drop policy if exists "companies_superadmin" on companies;
create policy "companies_superadmin" on companies for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "companies_admin_update" on companies;
create policy "companies_admin_update" on companies for update
  using (is_company_admin() and id = current_company_id())
  with check (is_company_admin() and id = current_company_id());

-- Perfiles: cada quien lee el suyo; superadmin y admin (de su empresa) gestionan.
drop policy if exists "profiles_read" on profiles;
create policy "profiles_read" on profiles for select
  using (
    id = auth.uid()
    or is_superadmin()
    or (is_company_admin() and company_id = current_company_id())
  );

drop policy if exists "profiles_write" on profiles;
create policy "profiles_write" on profiles for all
  using (
    is_superadmin()
    or (is_company_admin() and company_id = current_company_id())
  )
  with check (
    is_superadmin()
    or (is_company_admin() and company_id = current_company_id())
  );

-- ============================================================================
--  Storage: bucket para imágenes de productos
-- ----------------------------------------------------------------------------
--  Lectura pública (las URLs de imagen deben abrir sin login); escritura sólo
--  para usuarios autenticados.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "product_images_all" on storage.objects;
drop policy if exists "product_images_read" on storage.objects;
create policy "product_images_read" on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product_images_write" on storage.objects;
create policy "product_images_write" on storage.objects for all
  to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

-- ============================================================================
--  BOOTSTRAP — crea tu primer usuario superadmin (una sola vez)
-- ----------------------------------------------------------------------------
--  1. Supabase → Authentication → Providers → Email: desactiva "Confirm email"
--     (para que los usuarios creados por un admin puedan entrar de inmediato) y
--     deja "Allow new users to sign up" ACTIVADO (el frontend crea usuarios con
--     signUp). Ver nota de seguridad en el README.
--  2. Supabase → Authentication → Users → "Add user": crea tu cuenta con email
--     y contraseña. Copia el UUID del usuario creado.
--  3. Corre (reemplazando el UUID y tus datos):
--       insert into profiles (id, company_id, role, full_name, email)
--       values ('TU-UUID-AQUI', null, 'superadmin', 'Tu Nombre', 'tu@correo.com');
--  4. Entra al app con ese email/contraseña. Desde "Empresas" podrás crear
--     empresas y sus administradores. Para ver los datos que ya tenías en
--     "Mi Empresa", crea (o asígnate) un usuario admin de esa empresa.
-- ============================================================================

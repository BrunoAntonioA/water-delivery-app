export type OrderStatus = 'ordered' | 'delivered' | 'paid'

export type PaymentMethod = 'transferencia' | 'efectivo'

export interface Client {
  id: string
  name: string
  surname: string
  national_id: string | null
  phone: string
  created_at: string
}

export interface Address {
  id: string
  client_id: string
  label: string | null
  address: string
  comuna: string | null
  observation: string | null
  created_at: string
}

export interface Product {
  id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  created_at: string
}

export interface WhatsappTemplate {
  id: string
  name: string
  content: string
  created_at: string
}

export interface CostCategory {
  id: string
  name: string
  created_at: string
}

export interface Cost {
  id: string
  name: string
  description: string | null
  issue_date: string
  category_id: string | null
  amount: number
  created_at: string
}

export interface CostWithCategory extends Cost {
  category: CostCategory | null
}

export interface Order {
  id: string
  client_id: string | null
  customer_name: string | null
  address_id: string | null
  status: OrderStatus
  total: number
  payment_method: PaymentMethod | null
  paid_amount: number | null
  returned_bidones: number | null
  notes: string | null
  created_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  unit_price: number
}

// --- Tipos "enriquecidos" que devuelven las consultas con joins ---

export interface ClientWithAddresses extends Client {
  addresses: Address[]
}

export interface OrderItemWithProduct extends OrderItem {
  product: Product | null
}

export interface OrderDetail extends Order {
  client: Client | null
  address: Address | null
  items: OrderItemWithProduct[]
}

// --- Rutas de reparto ---

export interface Route {
  id: string
  name: string | null
  route_date: string
  driver: string | null
  driver_id: string | null
  notes: string | null
  created_at: string
}

export interface RouteStop {
  id: string
  route_id: string
  order_id: string
  position: number
  created_at: string
}

export interface RouteStopWithOrder extends RouteStop {
  order: OrderDetail | null
}

export interface RouteDetail extends Route {
  stops: RouteStopWithOrder[]
  driverName?: string | null
}

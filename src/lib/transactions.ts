export type AddressDetails = { recipient: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string; instructions: string };
export type DeliveryAddress = { id: string; user_id: string; details: AddressDetails; is_default: boolean; created_at: string };
export type FulfilmentOrder = { id: string; lot_id: string; preview_started_at: string; buyer_id: string; seller_id: string; payment_state: string; shipping_state: string; address_snapshot: AddressDetails | null; service: string; tracking: string; delivery_notes: string; dispatched_at: string | null; buyer_received_at: string | null; seller_delivery_reported_at: string | null; version: number; created_at: string };
export type Conversation = { id: string; lot_id: string; buyer_id: string; seller_id: string; buyer_read_at: string; seller_read_at: string; created_at: string };
export type PrivateMessage = { id: string; conversation_id: string; sender_id: string; body: string; client_key: string; created_at: string; deleted_at: string | null };
export type FulfilmentEvent = { id: string; order_id: string; actor_id: string | null; kind: string; version: number; created_at: string };

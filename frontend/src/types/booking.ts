import type { Database } from './database'

export type Resource = Database['public']['Tables']['resources']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type ExtensionRequest = Database['public']['Tables']['extension_requests']['Row']
export type ProjectGroup = Database['public']['Tables']['project_groups']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']

export interface ResourceWithDetails extends Resource {
  profiles?: {
    display_name: string
    primary_role: string
    owner_verification_status: string
  } | null
  active_booking?: {
    id: string
    status: string
    end_time: string
  } | null
}

export interface BookingWithDetails extends Booking {
  resources?: Resource | null
  project_groups?: { name: string } | null
  profiles?: {
    display_name: string
    primary_role: string
    campus_affiliation_status: string
  } | null
  fifo_position?: number
}

export interface ExtensionRequestWithDetails extends ExtensionRequest {
  bookings?: (Booking & {
    resources?: Resource | null
    profiles?: { display_name: string } | null
  }) | null
}

export type Incident = Database['public']['Tables']['incidents']['Row']

export interface IncidentWithDetails extends Incident {
  resources?: Resource | null
  bookings?: Booking | null
  profiles?: {
    display_name: string
    primary_role: string
  } | null
}

export interface TimelineEvent {
  id: string
  actor_id: string | null
  actor_name: string | null
  actor_role_snapshot: string
  action: string
  previous_state: string | null
  new_state: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

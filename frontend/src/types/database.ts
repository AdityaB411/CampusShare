export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'borrower' | 'owner' | 'manager' | 'admin'
export type VerificationStatus = 'verified' | 'pending' | 'unverified'
export type ResourceType = 'equipment' | 'space'
export type ResourceState = 'draft' | 'published' | 'paused' | 'archived'
export type BookingStatus =
  | 'pending_verification'
  | 'pending_owner_review'
  | 'waitlisted'
  | 'approved'
  | 'in_use'
  | 'return_pending'
  | 'returned'
  | 'rejected'
  | 'cancelled'
export type ConditionCode = 'good' | 'fair' | 'damaged' | 'missing_parts'
export type IncidentType = 'damage' | 'delay' | 'conflict' | 'custody_mismatch' | 'other'
export type IncidentStatus = 'open' | 'investigating' | 'resolved'
export type NotificationType =
  | 'approval'
  | 'rejection'
  | 'due_soon'
  | 'overdue'
  | 'incident'
  | 'general'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          primary_role: UserRole
          campus_affiliation_status: VerificationStatus
          owner_verification_status: VerificationStatus
          verifier_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name: string
          primary_role?: UserRole
          campus_affiliation_status?: VerificationStatus
          owner_verification_status?: VerificationStatus
          verifier_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          primary_role?: UserRole
          campus_affiliation_status?: VerificationStatus
          owner_verification_status?: VerificationStatus
          verifier_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profile_qualifications: {
        Row: {
          id: string
          user_id: string
          training_code: string
          status: 'verified' | 'pending' | 'expired' | 'revoked'
          expires_at: string | null
          verified_by: string | null
          verified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          training_code: string
          status?: 'verified' | 'pending' | 'expired' | 'revoked'
          expires_at?: string | null
          verified_by?: string | null
          verified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          training_code?: string
          status?: 'verified' | 'pending' | 'expired' | 'revoked'
          expires_at?: string | null
          verified_by?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      project_groups: {
        Row: {
          id: string
          name: string
          is_verified: boolean
          reviewer_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          is_verified?: boolean
          reviewer_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          is_verified?: boolean
          reviewer_id?: string | null
        }
        Relationships: []
      }
      group_members: {
        Row: {
          id: string
          group_id: string
          user_id: string
          status: 'approved' | 'pending' | 'removed'
          approved_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          user_id: string
          status?: 'approved' | 'pending' | 'removed'
          approved_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          group_id?: string
          user_id?: string
          status?: 'approved' | 'pending' | 'removed'
          approved_by?: string | null
        }
        Relationships: []
      }
      resources: {
        Row: {
          id: string
          type: ResourceType
          category: string
          title: string
          summary: string
          location_label: string
          owner_id: string
          state: ResourceState
          max_duration_hours: number
          rules: string | null
          required_training_code: string | null
          requires_supervision: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: ResourceType
          category: string
          title: string
          summary: string
          location_label: string
          owner_id: string
          state?: ResourceState
          max_duration_hours?: number
          rules?: string | null
          required_training_code?: string | null
          requires_supervision?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          type?: ResourceType
          category?: string
          title?: string
          summary?: string
          location_label?: string
          owner_id?: string
          state?: ResourceState
          max_duration_hours?: number
          rules?: string | null
          required_training_code?: string | null
          requires_supervision?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      bookings: {
        Row: {
          id: string
          resource_id: string
          requester_id: string
          group_id: string | null
          start_time: string
          end_time: string
          purpose: string
          status: BookingStatus
          supervisor_user_id: string | null
          actual_start_at: string | null
          actual_release_confirmed_at: string | null
          decision_reason: string | null
          initial_condition_code: ConditionCode | null
          initial_condition_checklist: Json | null
          initial_condition_notes: string | null
          initial_acknowledged_by: string | null
          initial_acknowledged_at: string | null
          return_condition_code: ConditionCode | null
          return_condition_checklist: Json | null
          return_condition_notes: string | null
          return_acknowledged_by: string | null
          return_acknowledged_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          resource_id: string
          requester_id: string
          group_id?: string | null
          start_time: string
          end_time: string
          purpose: string
          status?: BookingStatus
          supervisor_user_id?: string | null
          actual_start_at?: string | null
          actual_release_confirmed_at?: string | null
          decision_reason?: string | null
          initial_condition_code?: ConditionCode | null
          initial_condition_checklist?: Json | null
          initial_condition_notes?: string | null
          initial_acknowledged_by?: string | null
          initial_acknowledged_at?: string | null
          return_condition_code?: ConditionCode | null
          return_condition_checklist?: Json | null
          return_condition_notes?: string | null
          return_acknowledged_by?: string | null
          return_acknowledged_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          resource_id?: string
          requester_id?: string
          group_id?: string | null
          start_time?: string
          end_time?: string
          purpose?: string
          status?: BookingStatus
          supervisor_user_id?: string | null
          actual_start_at?: string | null
          actual_release_confirmed_at?: string | null
          decision_reason?: string | null
          initial_condition_code?: ConditionCode | null
          initial_condition_checklist?: Json | null
          initial_condition_notes?: string | null
          initial_acknowledged_by?: string | null
          initial_acknowledged_at?: string | null
          return_condition_code?: ConditionCode | null
          return_condition_checklist?: Json | null
          return_condition_notes?: string | null
          return_acknowledged_by?: string | null
          return_acknowledged_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "project_groups"
            referencedColumns: ["id"]
          }
        ]
      }
      extension_requests: {
        Row: {
          id: string
          booking_id: string
          requested_by: string
          new_end_time: string
          reason: string
          status: 'pending' | 'approved' | 'rejected'
          decided_by: string | null
          decision_reason: string | null
          created_at: string
          decided_at: string | null
        }
        Insert: {
          id?: string
          booking_id: string
          requested_by: string
          new_end_time: string
          reason: string
          status?: 'pending' | 'approved' | 'rejected'
          decided_by?: string | null
          decision_reason?: string | null
          created_at?: string
          decided_at?: string | null
        }
        Update: {
          id?: string
          booking_id?: string
          requested_by?: string
          new_end_time?: string
          reason?: string
          status?: 'pending' | 'approved' | 'rejected'
          decided_by?: string | null
          decision_reason?: string | null
          decided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extension_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      condition_reports: {
        Row: {
          id: string
          booking_id: string
          phase: 'start' | 'end'
          condition_code: ConditionCode
          checklist: Json
          notes: string | null
          reporter_id: string
          acknowledged_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          booking_id: string
          phase: 'start' | 'end'
          condition_code: ConditionCode
          checklist?: Json
          notes?: string | null
          reporter_id: string
          acknowledged_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          booking_id?: string
          phase?: 'start' | 'end'
          condition_code?: ConditionCode
          checklist?: Json
          notes?: string | null
          reporter_id?: string
          acknowledged_by?: string | null
        }
        Relationships: []
      }
      incidents: {
        Row: {
          id: string
          booking_id: string | null
          resource_id: string
          type: IncidentType
          description: string
          status: IncidentStatus
          reporter_id: string
          reviewer_id: string | null
          resolution_note: string | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          booking_id?: string | null
          resource_id: string
          type: IncidentType
          description: string
          status?: IncidentStatus
          reporter_id: string
          reviewer_id?: string | null
          resolution_note?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          booking_id?: string | null
          resource_id?: string
          type?: IncidentType
          description?: string
          status?: IncidentStatus
          reporter_id?: string
          reviewer_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          recipient_id: string
          type: NotificationType
          related_entity_type: string | null
          related_entity_id: string | null
          message: string
          is_read: boolean
          dedupe_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          recipient_id: string
          type: NotificationType
          related_entity_type?: string | null
          related_entity_id?: string | null
          message: string
          is_read?: boolean
          dedupe_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          recipient_id?: string
          type?: NotificationType
          related_entity_type?: string | null
          related_entity_id?: string | null
          message?: string
          is_read?: boolean
          dedupe_key?: string | null
        }
        Relationships: []
      }
      activity_events: {
        Row: {
          id: string
          actor_id: string | null
          actor_role_snapshot: string
          entity_type: string
          entity_id: string
          action: string
          previous_state: string | null
          new_state: string | null
          reason: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_role_snapshot: string
          entity_type: string
          entity_id: string
          action: string
          previous_state?: string | null
          new_state?: string | null
          reason?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          actor_role_snapshot?: string
          entity_type?: string
          entity_id?: string
          action?: string
          previous_state?: string | null
          new_state?: string | null
          reason?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      request_owner_verification: {
        Args: Record<string, never>
        Returns: Json
      }
      request_affiliation_verification: {
        Args: Record<string, never>
        Returns: Json
      }
      verify_user_status: {
        Args: {
          p_target_user_id: string
          p_affiliation_status?: string | null
          p_owner_status?: string | null
        }
        Returns: Json
      }
      assign_user_role: {
        Args: {
          p_target_user_id: string
          p_new_role: string
        }
        Returns: Json
      }
      verify_qualification: {
        Args: {
          p_qualification_id: string
          p_status: string
          p_expires_at?: string | null
        }
        Returns: Json
      }
      check_borrower_eligibility: {
        Args: {
          p_user_id: string
          p_resource_id: string
        }
        Returns: { is_eligible: boolean; missing_reason: string | null }[]
      }
      submit_booking_request: {
        Args: {
          p_resource_id: string
          p_start_time: string
          p_end_time: string
          p_purpose: string
          p_group_id?: string | null
          p_supervisor_user_id?: string | null
        }
        Returns: Json
      }
      approve_booking_request: {
        Args: {
          p_booking_id: string
          p_decision_reason?: string | null
          p_supervisor_user_id?: string | null
        }
        Returns: Json
      }
      reject_booking_request: {
        Args: {
          p_booking_id: string
          p_decision_reason: string
        }
        Returns: Json
      }
      waitlist_booking_request: {
        Args: {
          p_booking_id: string
          p_decision_reason: string
        }
        Returns: Json
      }
      cancel_booking: {
        Args: {
          p_booking_id: string
          p_reason: string
        }
        Returns: Json
      }
      request_booking_extension: {
        Args: {
          p_booking_id: string
          p_new_end_time: string
          p_reason: string
        }
        Returns: Json
      }
      decide_booking_extension: {
        Args: {
          p_extension_request_id: string
          p_decision: string
          p_decision_reason?: string | null
        }
        Returns: Json
      }
      confirm_checkout: {
        Args: {
          p_booking_id: string
          p_condition_code: string
          p_checklist?: Json
          p_notes?: string | null
          p_supervisor_confirmation?: boolean
        }
        Returns: Json
      }
      submit_return: {
        Args: {
          p_booking_id: string
          p_condition_code: string
          p_checklist?: Json
          p_notes?: string | null
        }
        Returns: Json
      }
      confirm_return: {
        Args: {
          p_booking_id: string
          p_confirmation_notes?: string | null
          p_discrepancy_reported?: boolean
        }
        Returns: Json
      }
      report_incident: {
        Args: {
          p_resource_id: string
          p_booking_id?: string | null
          p_type: string
          p_description: string
        }
        Returns: Json
      }
      resolve_incident: {
        Args: {
          p_incident_id: string
          p_status: string
          p_resolution_note: string
        }
        Returns: Json
      }
      archive_resource: {
        Args: {
          p_resource_id: string
          p_new_state?: string
        }
        Returns: Json
      }
      update_resource: {
        Args: {
          p_resource_id: string
          p_title: string
          p_type: ResourceType
          p_category: string
          p_summary: string
          p_location_label: string
          p_max_duration_hours: number
          p_rules: string | null
          p_required_training_code: string | null
          p_requires_supervision: boolean
          p_new_state: ResourceState
        }
        Returns: Json
      }
      create_project_group: {
        Args: {
          p_name: string
        }
        Returns: Json
      }
      verify_project_group: {
        Args: {
          p_group_id: string
          p_is_verified: boolean
        }
        Returns: Json
      }
      decide_group_membership: {
        Args: {
          p_member_id: string
          p_status: string
        }
        Returns: Json
      }
      get_active_resource_custody: {
        Args: Record<string, never>
        Returns: {
          resource_id: string
          booking_id: string
          status: string
          end_time: string
        }[]
      }
      get_booking_timeline: {
        Args: {
          p_booking_id: string
        }
        Returns: {
          id: string
          actor_id: string | null
          actor_name: string | null
          actor_role_snapshot: string
          action: string
          previous_state: string | null
          new_state: string | null
          reason: string | null
          metadata: Json
          created_at: string
        }[]
      }
      generate_due_reminders: {
        Args: Record<string, never>
        Returns: Json
      }
      mark_all_notifications_as_read: {
        Args: Record<string, never>
        Returns: number
      }
      get_unread_notifications_count: {
        Args: Record<string, never>
        Returns: number
      }
    }
  }
}

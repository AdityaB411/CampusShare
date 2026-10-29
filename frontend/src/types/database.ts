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

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role_snapshot: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          new_state: string | null
          previous_state: string | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role_snapshot: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
          new_state?: string | null
          previous_state?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role_snapshot?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          new_state?: string | null
          previous_state?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          actual_release_confirmed_at: string | null
          actual_start_at: string | null
          created_at: string
          decision_reason: string | null
          end_time: string
          extension_decided_at: string | null
          extension_decided_by: string | null
          extension_decision_reason: string | null
          extension_reason: string | null
          extension_requested_at: string | null
          extension_requested_end_time: string | null
          extension_status: string | null
          group_id: string | null
          id: string
          initial_acknowledged_at: string | null
          initial_acknowledged_by: string | null
          initial_condition_checklist: Json | null
          initial_condition_code: string | null
          initial_condition_notes: string | null
          purpose: string
          requester_id: string
          resource_id: string
          return_acknowledged_at: string | null
          return_acknowledged_by: string | null
          return_condition_checklist: Json | null
          return_condition_code: string | null
          return_condition_notes: string | null
          start_time: string
          status: string
          supervisor_user_id: string | null
          updated_at: string
          waitlisted_at: string | null
        }
        Insert: {
          actual_release_confirmed_at?: string | null
          actual_start_at?: string | null
          created_at?: string
          decision_reason?: string | null
          end_time: string
          extension_decided_at?: string | null
          extension_decided_by?: string | null
          extension_decision_reason?: string | null
          extension_reason?: string | null
          extension_requested_at?: string | null
          extension_requested_end_time?: string | null
          extension_status?: string | null
          group_id?: string | null
          id?: string
          initial_acknowledged_at?: string | null
          initial_acknowledged_by?: string | null
          initial_condition_checklist?: Json | null
          initial_condition_code?: string | null
          initial_condition_notes?: string | null
          purpose: string
          requester_id: string
          resource_id: string
          return_acknowledged_at?: string | null
          return_acknowledged_by?: string | null
          return_condition_checklist?: Json | null
          return_condition_code?: string | null
          return_condition_notes?: string | null
          start_time: string
          status?: string
          supervisor_user_id?: string | null
          updated_at?: string
          waitlisted_at?: string | null
        }
        Update: {
          actual_release_confirmed_at?: string | null
          actual_start_at?: string | null
          created_at?: string
          decision_reason?: string | null
          end_time?: string
          extension_decided_at?: string | null
          extension_decided_by?: string | null
          extension_decision_reason?: string | null
          extension_reason?: string | null
          extension_requested_at?: string | null
          extension_requested_end_time?: string | null
          extension_status?: string | null
          group_id?: string | null
          id?: string
          initial_acknowledged_at?: string | null
          initial_acknowledged_by?: string | null
          initial_condition_checklist?: Json | null
          initial_condition_code?: string | null
          initial_condition_notes?: string | null
          purpose?: string
          requester_id?: string
          resource_id?: string
          return_acknowledged_at?: string | null
          return_acknowledged_by?: string | null
          return_condition_checklist?: Json | null
          return_condition_code?: string | null
          return_condition_notes?: string | null
          start_time?: string
          status?: string
          supervisor_user_id?: string | null
          updated_at?: string
          waitlisted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_extension_decided_by_fkey"
            columns: ["extension_decided_by"]
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
          },
          {
            foreignKeyName: "bookings_initial_acknowledged_by_fkey"
            columns: ["initial_acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_return_acknowledged_by_fkey"
            columns: ["return_acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_supervisor_user_id_fkey"
            columns: ["supervisor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_reports: {
        Row: {
          acknowledged_by: string | null
          booking_id: string
          checklist: Json
          condition_code: string
          created_at: string
          id: string
          notes: string | null
          phase: string
          reporter_id: string
        }
        Insert: {
          acknowledged_by?: string | null
          booking_id: string
          checklist?: Json
          condition_code: string
          created_at?: string
          id?: string
          notes?: string | null
          phase: string
          reporter_id: string
        }
        Update: {
          acknowledged_by?: string | null
          booking_id?: string
          checklist?: Json
          condition_code?: string
          created_at?: string
          id?: string
          notes?: string | null
          phase?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "condition_reports_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          approved_by: string | null
          created_at: string
          group_id: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          group_id: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          group_id?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "project_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          booking_id: string | null
          created_at: string
          description: string
          id: string
          reporter_id: string
          resolution_note: string | null
          resolved_at: string | null
          resource_id: string
          reviewer_id: string | null
          status: string
          type: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          description: string
          id?: string
          reporter_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resource_id: string
          reviewer_id?: string | null
          status?: string
          type: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          description?: string
          id?: string
          reporter_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resource_id?: string
          reviewer_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
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
          },
          {
            foreignKeyName: "incidents_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string | null
          id: string
          is_read: boolean
          message: string
          recipient_id: string
          related_entity_id: string | null
          related_entity_type: string | null
          type: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          message: string
          recipient_id: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          type: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          message?: string
          recipient_id?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_qualifications: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          status: string
          training_code: string
          user_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          status?: string
          training_code: string
          user_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          status?: string
          training_code?: string
          user_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_qualifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_qualifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          campus_affiliation_status: string
          created_at: string
          display_name: string
          id: string
          owner_verification_status: string
          primary_role: string
          updated_at: string
          verifier_user_id: string | null
        }
        Insert: {
          campus_affiliation_status?: string
          created_at?: string
          display_name: string
          id: string
          owner_verification_status?: string
          primary_role?: string
          updated_at?: string
          verifier_user_id?: string | null
        }
        Update: {
          campus_affiliation_status?: string
          created_at?: string
          display_name?: string
          id?: string
          owner_verification_status?: string
          primary_role?: string
          updated_at?: string
          verifier_user_id?: string | null
        }
        Relationships: []
      }
      project_groups: {
        Row: {
          created_at: string
          id: string
          is_verified: boolean
          name: string
          reviewer_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_verified?: boolean
          name: string
          reviewer_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_verified?: boolean
          name?: string
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_groups_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          category: string
          created_at: string
          id: string
          location_label: string
          max_duration_hours: number
          owner_id: string
          required_training_code: string | null
          requires_supervision: boolean
          rules: string | null
          state: string
          summary: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          location_label: string
          max_duration_hours: number
          owner_id: string
          required_training_code?: string | null
          requires_supervision?: boolean
          rules?: string | null
          state?: string
          summary: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          location_label?: string
          max_duration_hours?: number
          owner_id?: string
          required_training_code?: string | null
          requires_supervision?: boolean
          rules?: string | null
          state?: string
          summary?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_booking_request: {
        Args: {
          p_booking_id: string
          p_decision_reason?: string
          p_supervisor_user_id?: string
        }
        Returns: Json
      }
      archive_resource: {
        Args: { p_new_state?: string; p_resource_id: string }
        Returns: Json
      }
      assign_user_role: {
        Args: { p_new_role: string; p_target_user_id: string }
        Returns: Json
      }
      cancel_booking: {
        Args: { p_booking_id: string; p_reason: string }
        Returns: Json
      }
      check_borrower_eligibility: {
        Args: { p_resource_id: string; p_user_id: string }
        Returns: {
          is_eligible: boolean
          missing_reason: string
        }[]
      }
      confirm_checkout: {
        Args: {
          p_booking_id: string
          p_checklist?: Json
          p_condition_code: string
          p_notes?: string
          p_supervisor_confirmation?: boolean
        }
        Returns: Json
      }
      confirm_return: {
        Args: {
          p_booking_id: string
          p_confirmation_notes?: string
          p_discrepancy_reported?: boolean
        }
        Returns: Json
      }
      create_project_group: { Args: { p_name: string }; Returns: Json }
      decide_booking_extension: {
        Args: {
          p_decision: string
          p_decision_reason?: string
          p_extension_request_id: string
        }
        Returns: Json
      }
      decide_group_membership: {
        Args: { p_member_id: string; p_status: string }
        Returns: Json
      }
      generate_due_reminders: { Args: never; Returns: Json }
      get_active_resource_custody: {
        Args: never
        Returns: {
          resource_id: string
        }[]
      }
      get_booking_timeline: {
        Args: { p_booking_id: string }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          actor_role_snapshot: string
          created_at: string
          id: string
          metadata: Json
          new_state: string
          previous_state: string
          reason: string
        }[]
      }
      get_unread_notifications_count: { Args: never; Returns: number }
      is_admin_or_manager: { Args: never; Returns: boolean }
      is_verified_owner: { Args: never; Returns: boolean }
      mark_all_notifications_as_read: { Args: never; Returns: number }
      reject_booking_request: {
        Args: { p_booking_id: string; p_decision_reason: string }
        Returns: Json
      }
      report_incident: {
        Args: {
          p_booking_id: string
          p_description: string
          p_resource_id: string
          p_type: string
        }
        Returns: Json
      }
      request_affiliation_verification: { Args: never; Returns: Json }
      request_booking_extension: {
        Args: { p_booking_id: string; p_new_end_time: string; p_reason: string }
        Returns: Json
      }
      request_owner_verification: { Args: never; Returns: Json }
      resolve_incident: {
        Args: {
          p_incident_id: string
          p_resolution_note: string
          p_status: string
        }
        Returns: Json
      }
      submit_booking_request: {
        Args: {
          p_end_time: string
          p_group_id?: string
          p_purpose: string
          p_resource_id: string
          p_start_time: string
          p_supervisor_user_id?: string
        }
        Returns: Json
      }
      submit_return: {
        Args: {
          p_booking_id: string
          p_checklist?: Json
          p_condition_code: string
          p_notes?: string
        }
        Returns: Json
      }
      update_resource: {
        Args: {
          p_category: string
          p_location_label: string
          p_max_duration_hours: number
          p_new_state: string
          p_required_training_code: string
          p_requires_supervision: boolean
          p_resource_id: string
          p_rules: string
          p_summary: string
          p_title: string
          p_type: string
        }
        Returns: Json
      }
      verify_project_group: {
        Args: { p_group_id: string; p_is_verified: boolean }
        Returns: Json
      }
      verify_qualification: {
        Args: {
          p_expires_at?: string
          p_qualification_id: string
          p_status: string
        }
        Returns: Json
      }
      verify_user_status: {
        Args: {
          p_affiliation_status?: string
          p_owner_status?: string
          p_target_user_id: string
        }
        Returns: Json
      }
      waitlist_booking_request: {
        Args: { p_booking_id: string; p_decision_reason: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

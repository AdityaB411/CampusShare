import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

/**
 * Read the two public Vite environment variables.
 * Note: Never log or print the values of these variables.
 */
const rawUrl = import.meta.env.VITE_SUPABASE_URL
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : ''
const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : ''

/**
 * Boolean indicator checking whether valid configuration credentials are present.
 * Does not expose or leak any credentials.
 */
export const isSupabaseConfigured: boolean = Boolean(
  trimmedUrl.length > 0 &&
    trimmedKey.length > 0 &&
    !trimmedUrl.includes('placeholder.supabase.co') &&
    !trimmedKey.includes('placeholder-anon-key')
)

/**
 * Graceful fallback credentials for development/testing when env variables are not yet provided.
 * Prevents runtime initialization crashes while keeping the client strictly typed.
 */
const effectiveUrl = isSupabaseConfigured ? trimmedUrl : 'https://placeholder.supabase.co'
const effectiveKey = isSupabaseConfigured ? trimmedKey : 'placeholder-anon-key'

if (!isSupabaseConfigured && import.meta.env.DEV) {
  // Safe warning naming only the environment variable keys, never their values
  console.warn(
    '[CampusShare] Supabase credentials (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are not configured. the public catalogue will show a configuration message until setup is complete.'
  )
}

/**
 * Reusable, singleton, strongly-typed Supabase client module.
 * Scoped exclusively to public anon operations with Row-Level Security.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  effectiveUrl,
  effectiveKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
)

/**
 * Helper to retrieve the typed client instance.
 */
export const getSupabase = (): SupabaseClient<Database> => supabase

export type { Database } from '../types/database'

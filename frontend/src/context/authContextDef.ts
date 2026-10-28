import { createContext } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import type { Database } from '../types/database'

export type Profile = Database['public']['Tables']['profiles']['Row']

export interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  isConfigured: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  requestOwnerAccess: () => Promise<{ success: boolean; message?: string; error?: string }>
  requestAffiliation: () => Promise<{ success: boolean; message?: string; error?: string }>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

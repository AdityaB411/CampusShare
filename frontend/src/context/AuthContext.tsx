import React, { useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { AuthContext, type Profile } from './authContextDef'

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured)

  const fetchProfile = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured) return null

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        // If profile row doesn't exist yet (e.g. trigger lag), create a fallback local representation
        console.warn('Profile fetch note:', error.message)
        return null
      }
      return data as Profile
    } catch (err) {
      console.warn('Unexpected error fetching profile:', err)
      return null
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      const p = await fetchProfile(user.id)
      if (p) setProfile(p)
    }
  }, [user, fetchProfile])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    // 1. Get initial active session
    supabase.auth.getSession().then(({ data: { session: initSession } }) => {
      setSession(initSession)
      setUser(initSession?.user ?? null)
      if (initSession?.user) {
        fetchProfile(initSession.user.id).then((p) => {
          setProfile(p)
          setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    // 2. Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
      if (newSession?.user) {
        const p = await fetchProfile(newSession.user.id)
        setProfile(p)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase credentials are not configured. Check .env.local.' }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signUp = async (
    email: string,
    password: string,
    displayName: string
  ): Promise<{ error: string | null }> => {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase credentials are not configured. Check .env.local.' }
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: displayName.trim(),
        },
      },
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signOut = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    setUser(null)
    setSession(null)
    setProfile(null)
  }

  const requestOwnerAccess = async () => {
    if (!user || !isSupabaseConfigured) {
      return { success: false, error: 'User not signed in or client not configured.' }
    }

    // Call database RPC function
    const { data, error } = await supabase.rpc('request_owner_verification')
    if (error) {
      return { success: false, error: error.message }
    }

    await refreshProfile()
    return {
      success: true,
      message: (data as { message?: string })?.message || 'Request submitted successfully.',
    }
  }

  const requestAffiliation = async () => {
    if (!user || !isSupabaseConfigured) {
      return { success: false, error: 'User not signed in or client not configured.' }
    }

    const { data, error } = await supabase.rpc('request_affiliation_verification')
    if (error) {
      return { success: false, error: error.message }
    }

    await refreshProfile()
    return {
      success: true,
      message: (data as { message?: string })?.message || 'Affiliation verification requested.',
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isConfigured: isSupabaseConfigured,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        requestOwnerAccess,
        requestAffiliation,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

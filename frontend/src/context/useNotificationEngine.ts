import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useNotificationEngine() {
  const { user } = useAuth()
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)

  // Fetch unread count from Supabase
  const fetchUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0)
      return
    }

    try {
      // Try RPC first
      const { data: countData, error: rpcError } = await supabase.rpc('get_unread_notifications_count')
      if (!rpcError && typeof countData === 'number') {
        setUnreadCount(countData)
        return
      }

      // Fallback direct count
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('is_read', false)

      if (!error && count !== null) {
        setUnreadCount(count)
      }
    } catch {
      // Silently handle offline/guest states
    }
  }, [user])

  // Trigger due-soon and overdue reminder generation in the database
  const runReminderCycle = useCallback(async () => {
    if (!user) return

    try {
      await supabase.rpc('generate_due_reminders')
      await fetchUnreadCount()
    } catch (err) {
      console.warn('Reminder cycle note:', err)
    }
  }, [user, fetchUnreadCount])

  // Mark single notification as read
  const markAsRead = useCallback(
    async (id: string) => {
      if (!user) return

      try {
        const { error } = await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('id', id)
          .eq('recipient_id', user.id)

        if (!error) {
          setUnreadCount((prev) => Math.max(0, prev - 1))
        }
      } catch (err) {
        console.warn('Mark read error:', err)
      }
    },
    [user]
  )

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!user) return

    try {
      setLoading(true)
      // Try RPC first
      const { error: rpcError } = await supabase.rpc('mark_all_notifications_as_read')
      if (rpcError) {
        // Fallback update
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('recipient_id', user.id)
          .eq('is_read', false)
      }

      setUnreadCount(0)
    } catch (err) {
      console.warn('Mark all read error:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  // Delete notification
  const deleteNotification = useCallback(
    async (id: string) => {
      if (!user) return

      try {
        await supabase
          .from('notifications')
          .delete()
          .eq('id', id)
          .eq('recipient_id', user.id)

        await fetchUnreadCount()
      } catch (err) {
        console.warn('Delete notification error:', err)
      }
    },
    [user, fetchUnreadCount]
  )

  useEffect(() => {
    if (!user) return

    let isMounted = true

    // 1. Run on app open / session start asynchronously
    const initialTimer = setTimeout(() => {
      if (isMounted) {
        void runReminderCycle()
      }
    }, 0)

    // 2. Set interval to run every 5 minutes (300,000 ms) while session is active
    const intervalId = setInterval(() => {
      if (isMounted) {
        void runReminderCycle()
      }
    }, 5 * 60 * 1000)

    return () => {
      isMounted = false
      clearTimeout(initialTimer)
      clearInterval(intervalId)
    }
  }, [user, runReminderCycle])

  return {
    unreadCount,
    loading,
    refreshUnreadCount: fetchUnreadCount,
    runReminderCycle,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  }
}

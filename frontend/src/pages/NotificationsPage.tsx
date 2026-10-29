import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  ShieldAlert,
  Info,
  CheckCheck,
  Check,
  Trash2,
  RefreshCw,
  ExternalLink,
  Filter,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useNotificationEngine } from '../context/useNotificationEngine'
import { isNotificationType } from '../types/database'
import type { Database, NotificationType } from '../types/database'

type NotificationRow = Database['public']['Tables']['notifications']['Row']

type FilterCategory = 'all' | 'unread' | 'decisions' | 'reminders' | 'incidents'

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diffSec < 30) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const NotificationsPage: React.FC = () => {
  const { user, profile } = useAuth()
  const {
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    runReminderCycle,
  } = useNotificationEngine()

  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<FilterCategory>('all')
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const isOwnerOrAdmin = profile?.primary_role === 'owner' || profile?.primary_role === 'manager' || profile?.primary_role === 'admin'

  // Fetch user's persistent notifications
  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([])
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        throw error
      }

      setNotifications((data as NotificationRow[]) || [])
      setErrorBanner(null)
    } catch (err: unknown) {
      const e = err as Error
      console.error('Failed to load notifications:', e)
      setErrorBanner(e.message || 'Unable to load notifications at this time.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchNotifications()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchNotifications])

  // Manual refresh and reminder evaluation
  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      await runReminderCycle()
      await fetchNotifications()
    } finally {
      setRefreshing(false)
    }
  }

  // Mark single notification as read
  const handleMarkAsRead = async (id: string) => {
    setActionInProgressId(id)
    try {
      await markAsRead(id)
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      )
    } finally {
      setActionInProgressId(null)
    }
  }

  // Mark all as read
  const handleMarkAllAsRead = async () => {
    setRefreshing(true)
    try {
      await markAllAsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    } finally {
      setRefreshing(false)
    }
  }

  // Delete notification
  const handleDelete = async (id: string) => {
    setActionInProgressId(id)
    try {
      await deleteNotification(id)
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    } finally {
      setActionInProgressId(null)
    }
  }

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    switch (activeTab) {
      case 'unread':
        return notifications.filter((n) => !n.is_read)
      case 'decisions':
        return notifications.filter(
          (n) => n.type === 'approval' || n.type === 'rejection'
        )
      case 'reminders':
        return notifications.filter(
          (n) => n.type === 'due_soon' || n.type === 'overdue'
        )
      case 'incidents':
        return notifications.filter((n) => n.type === 'incident')
      case 'all':
      default:
        return notifications
    }
  }, [notifications, activeTab])

  // Count metrics for tabs
  const tabCounts = useMemo(() => {
    return {
      all: notifications.length,
      unread: notifications.filter((n) => !n.is_read).length,
      decisions: notifications.filter(
        (n) => n.type === 'approval' || n.type === 'rejection'
      ).length,
      reminders: notifications.filter(
        (n) => n.type === 'due_soon' || n.type === 'overdue'
      ).length,
      incidents: notifications.filter((n) => n.type === 'incident').length,
    }
  }, [notifications])

  // Helper for notification visuals
  const getVisualConfig = (type: NotificationType) => {
    switch (type) {
      case 'approval':
        return {
          icon: CheckCircle2,
          bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          badgeText: 'Booking Decision: Approved',
          dotClass: 'bg-emerald-500',
        }
      case 'rejection':
        return {
          icon: XCircle,
          bgClass: 'bg-rose-50 text-rose-700 border-rose-200',
          badgeText: 'Booking Decision: Rejected',
          dotClass: 'bg-rose-500',
        }
      case 'due_soon':
        return {
          icon: Clock,
          bgClass: 'bg-amber-50 text-amber-800 border-amber-200',
          badgeText: 'Due Soon (Within 60 min)',
          dotClass: 'bg-amber-500',
        }
      case 'overdue':
        return {
          icon: AlertOctagon,
          bgClass: 'bg-red-50 text-red-800 border-red-200',
          badgeText: 'Custody Overdue',
          dotClass: 'bg-red-600',
        }
      case 'incident':
        return {
          icon: ShieldAlert,
          bgClass: 'bg-orange-50 text-orange-800 border-orange-200',
          badgeText: 'Incident Activity',
          dotClass: 'bg-orange-500',
        }
      case 'general':
      default:
        return {
          icon: Info,
          bgClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          badgeText: 'Campus Notice',
          dotClass: 'bg-indigo-500',
        }
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="border-b border-slate-200 pb-5 sm:flex sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Bell className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
                Notifications &amp; Reminders
                {unreadCount > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-600 text-white shadow-2xs">
                    {unreadCount} unread
                  </span>
                )}
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">
                Persistent in-app notices for booking decisions, cancellations, extension outcomes, and incidents.
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs disabled:opacity-50"
            title="Scan active bookings for due-soon or overdue reminders"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh &amp; Check Reminders</span>
          </button>

          <button
            type="button"
            onClick={handleMarkAllAsRead}
            disabled={unreadCount === 0 || refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs disabled:opacity-40 disabled:hover:bg-indigo-600"
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Mark All as Read</span>
          </button>
        </div>
      </div>

      {/* Scheduler Architecture Information Banner */}
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-blue-50/50 to-slate-50 p-4 flex items-start gap-3 text-xs text-slate-700 shadow-2xs">
        <Clock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-900 flex items-center gap-2">
            <span>Automated In-Session Reminder Engine Active</span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold">
              5-Min Periodic Scan
            </span>
            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-medium">
              No External SMS/Email
            </span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Deduplicated reminders are generated automatically on app open and every 5 minutes while your session is active.
            Borrowers receive alerts 60 minutes prior to return deadline; overdue custody triggers persistent hourly notifications for both borrowers and owners.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {errorBanner && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-center gap-3 text-xs text-rose-800"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
          <span className="font-medium">{errorBanner}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-2">
        <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 mr-2 shrink-0">
          <Filter className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          Filter:
        </span>

        {[
          { id: 'all', label: 'All Notices', count: tabCounts.all },
          { id: 'unread', label: 'Unread', count: tabCounts.unread, isAlert: tabCounts.unread > 0 },
          { id: 'decisions', label: 'Decisions', count: tabCounts.decisions },
          { id: 'reminders', label: 'Due & Overdue', count: tabCounts.reminders },
          { id: 'incidents', label: 'Incidents', count: tabCounts.incidents },
        ].map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as FilterCategory)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isActive
                    ? 'bg-slate-800 text-slate-200'
                    : tab.isAlert
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-200 rounded w-1/3" />
                <div className="h-3 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredNotifications.length === 0 && (
        <div className="text-center py-12 px-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 shadow-inner">
            <CheckCheck className="w-6 h-6" aria-hidden="true" />
          </div>
          <h2 className="text-base font-bold text-slate-900">
            {activeTab === 'unread' ? 'All caught up!' : 'No notifications in this view'}
          </h2>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
            {activeTab === 'unread'
              ? 'You have reviewed all incoming decision notices and scheduled reminders.'
              : 'As booking decisions, cancellation updates, extension outcomes, and due-soon reminders occur, they will be listed here.'}
          </p>
          {activeTab !== 'all' && (
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border border-indigo-200 transition-colors"
            >
              <span>View all notifications</span>
            </button>
          )}
        </div>
      )}

      {/* Notifications List */}
      {!loading && filteredNotifications.length > 0 && (
        <div className="space-y-3" role="feed" aria-label="Notifications list">
          {filteredNotifications.map((notice) => {
            const visual = getVisualConfig(
              isNotificationType(notice.type) ? notice.type : 'general',
            )
            const Icon = visual.icon
            const isUnread = !notice.is_read
            const isPendingAction = actionInProgressId === notice.id

            return (
              <article
                key={notice.id}
                className={`bg-white rounded-xl border transition-all shadow-2xs p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                  isUnread
                    ? 'border-indigo-300 ring-1 ring-indigo-200/50 bg-indigo-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Left side: Icon + content */}
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${visual.bgClass}`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </div>

                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        {visual.badgeText}
                      </span>

                      {isUnread && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${visual.dotClass}`}
                            aria-hidden="true"
                          />
                          Unread
                        </span>
                      )}

                      {notice.dedupe_key && (
                        <span
                          className="text-[10px] text-slate-500 font-mono"
                          title={`Deduplication Key: ${notice.dedupe_key}`}
                        >
                          • Auto-Reminder
                        </span>
                      )}
                    </div>

                    <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-normal">
                      {notice.message}
                    </p>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                      <time dateTime={notice.created_at} title={new Date(notice.created_at).toLocaleString()}>
                        {formatRelativeTime(notice.created_at)}
                      </time>

                      {notice.related_entity_type === 'booking' && (
                        <>
                          <span aria-hidden="true">•</span>
                          <Link
                            to={isOwnerOrAdmin ? '/owner-queue' : '/my-bookings'}
                            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
                          >
                            <span>{isOwnerOrAdmin ? 'Open in Review Queue' : 'View in My Bookings'}</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side: Action controls */}
                <div className="flex items-center justify-end sm:flex-col sm:items-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  {isUnread && (
                    <button
                      type="button"
                      disabled={isPendingAction}
                      onClick={() => handleMarkAsRead(notice.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 transition-colors disabled:opacity-50"
                      title="Mark as read"
                      aria-label="Mark notification as read"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Mark Read</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isPendingAction}
                    onClick={() => handleDelete(notice.id)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                    title="Dismiss notification"
                    aria-label="Dismiss notification"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

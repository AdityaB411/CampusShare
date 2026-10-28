import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails, TimelineEvent } from '../../types/booking'
import {
  History,
  X,
  Clock,
  User,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  PackageCheck,
  FileText,
  ArrowRight,
  Loader2,
} from 'lucide-react'

interface BookingTimelineModalProps {
  booking: BookingWithDetails
  onClose: () => void
}

export const BookingTimelineModal: React.FC<BookingTimelineModalProps> = ({
  booking,
  onClose,
}) => {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    async function loadTimeline() {
      try {
        setLoading(true)
        setErrorMsg(null)

        // Try using the get_booking_timeline RPC first
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_booking_timeline', {
          p_booking_id: booking.id,
        })

        if (ignore) return

        if (!rpcError && rpcData) {
          setEvents(rpcData as unknown as TimelineEvent[])
          setLoading(false)
          return
        }

        // Fallback: Query activity_events directly if RPC is not yet applied
        const { data: queryData, error: queryError } = await supabase
          .from('activity_events')
          .select('id, actor_id, actor_role_snapshot, action, previous_state, new_state, reason, metadata, created_at')
          .eq('entity_id', booking.id)
          .order('created_at', { ascending: true })

        if (ignore) return

        if (queryError) throw queryError

        setEvents((queryData || []) as unknown as TimelineEvent[])
      } catch (err: unknown) {
        if (!ignore) {
          const e = err as Error
          setErrorMsg(e.message || 'Failed to load booking timeline.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void loadTimeline()
    return () => {
      ignore = true
    }
  }, [booking.id])

  const formatAction = (action: string) => {
    switch (action) {
      case 'BOOKING_REQUESTED':
        return 'Booking Requested'
      case 'BOOKING_APPROVED':
        return 'Reservation Approved'
      case 'BOOKING_REJECTED':
        return 'Reservation Declined'
      case 'BOOKING_WAITLISTED':
        return 'Placed on FIFO Waitlist'
      case 'BOOKING_CANCELLED':
        return 'Reservation Cancelled'
      case 'CHECKOUT_COMPLETED':
        return 'Collection & Condition Verified'
      case 'RETURN_SUBMITTED':
        return 'Return Condition Submitted'
      case 'RETURN_CONFIRMED':
        return 'Return Confirmed & Custody Released'
      case 'EXTENSION_REQUESTED':
        return 'Extension Requested'
      case 'EXTENSION_DECIDED':
        return 'Extension Decided'
      case 'INCIDENT_REPORTED':
        return 'Incident Filed'
      case 'INCIDENT_INVESTIGATING':
        return 'Incident Under Investigation'
      case 'INCIDENT_RESOLVED':
        return 'Incident Resolved'
      default:
        return action.replace(/_/g, ' ')
    }
  }

  const getActionIcon = (action: string) => {
    if (action.includes('APPROVED') || action.includes('CONFIRMED') || action.includes('RESOLVED')) {
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />
    }
    if (action.includes('CHECKOUT')) {
      return <PackageCheck className="w-4 h-4 text-indigo-600" />
    }
    if (action.includes('RETURN_SUBMITTED')) {
      return <RotateCcw className="w-4 h-4 text-amber-600" />
    }
    if (action.includes('INCIDENT') || action.includes('REJECTED') || action.includes('CANCELLED')) {
      return <AlertTriangle className="w-4 h-4 text-rose-600" />
    }
    return <FileText className="w-4 h-4 text-indigo-600" />
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="timeline-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-inner">
              <History className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="timeline-modal-title" className="text-lg font-bold text-slate-900">
                Booking Activity &amp; Audit Timeline
              </h2>
              <p className="text-xs text-slate-500">
                Immutable Trust Record for #{booking.id.slice(0, 8)} • {booking.resources?.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* Reservation Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Status</span>
              <span className="font-bold text-slate-900 capitalize">{booking.status.replace(/_/g, ' ')}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Initial Condition</span>
              <span className="font-semibold text-slate-800 capitalize">
                {booking.initial_condition_code || 'Unrecorded'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Return Condition</span>
              <span className="font-semibold text-slate-800 capitalize">
                {booking.return_condition_code || 'Pending'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Release Confirmed</span>
              <span className="font-semibold text-slate-800">
                {booking.actual_release_confirmed_at ? 'Yes' : 'In Custody'}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              <span>Loading tamper-resistant audit events...</span>
            </div>
          ) : errorMsg ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {errorMsg}
            </div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              No audit events recorded for this booking yet.
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
              {events.map((ev) => {
                const date = new Date(ev.created_at)
                return (
                  <div key={ev.id} className="relative group">
                    {/* Circle Dot */}
                    <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-white border-2 border-indigo-600 flex items-center justify-center shadow-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-2 hover:border-slate-300 transition-colors">
                      {/* Event Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                        <div className="flex items-center gap-2 font-bold text-slate-900">
                          {getActionIcon(ev.action)}
                          <span>{formatAction(ev.action)}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {date.toLocaleDateString()} at {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>

                      {/* State transition */}
                      {(ev.previous_state || ev.new_state) && (
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-600">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {ev.previous_state || 'none'}
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">
                            {ev.new_state}
                          </span>
                        </div>
                      )}

                      {/* Decision reason or condition note */}
                      {ev.reason && (
                        <p className="text-xs text-slate-700 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 italic leading-relaxed">
                          "{ev.reason}"
                        </p>
                      )}

                      {/* Actor attribution */}
                      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>
                            {ev.actor_name || 'System / Campus Actor'}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                          <ShieldCheck className="w-3 h-3 text-slate-500" />
                          Role: {ev.actor_role_snapshot || 'authenticated'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <span className="text-[11px] text-slate-400">
            Append-only Postgres Trust Record • Immutable &amp; Tamper-Resistant
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

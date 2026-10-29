import React, { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import type { BookingWithDetails } from '../types/booking'
import { CancelBookingModal } from '../components/booking/CancelBookingModal'
import { RequestExtensionModal } from '../components/booking/RequestExtensionModal'
import { ConfirmCheckoutModal } from '../components/booking/ConfirmCheckoutModal'
import { SubmitReturnModal } from '../components/booking/SubmitReturnModal'
import { ReportIncidentModal } from '../components/booking/ReportIncidentModal'
import { BookingTimelineModal } from '../components/booking/BookingTimelineModal'
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  Ban,
  Hourglass,
  Layers,
  ChevronRight,
  RefreshCw,
  Sparkles,
  PackageCheck,
  RotateCcw,
  AlertTriangle,
  History,
} from 'lucide-react'

export const MyBookingsPage: React.FC = () => {
  const { user } = useAuth()
  const location = useLocation()

  const [bookings, setBookings] = useState<BookingWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'pending' | 'history'>(
    () => new URLSearchParams(location.search).get('tab') === 'pending' ? 'pending' : 'all'
  )
  const [refreshKey, setRefreshKey] = useState(0)

  // Extension requests map (booking_id -> extension)
  const [extensionMap, setExtensionMap] = useState<Record<string, { id: string; status: string; new_end_time: string; reason: string }>>({})

  // Modals state
  const [cancelTarget, setCancelTarget] = useState<BookingWithDetails | null>(null)
  const [extendTarget, setExtendTarget] = useState<BookingWithDetails | null>(null)
  const [checkoutTarget, setCheckoutTarget] = useState<BookingWithDetails | null>(null)
  const [returnTarget, setReturnTarget] = useState<BookingWithDetails | null>(null)
  const [incidentTarget, setIncidentTarget] = useState<BookingWithDetails | null>(null)
  const [timelineTarget, setTimelineTarget] = useState<BookingWithDetails | null>(null)

  useEffect(() => {
    let ignore = false

    async function loadBorrowerBookings() {
      if (!user) {
        setLoading(false)
        return
      }

      // 1. Fetch borrower bookings
      const { data: bData, error: bError } = await supabase
        .from('bookings')
        .select('*, resources(*), project_groups(name)')
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false })

      if (ignore) return

      if (!bError && bData) {
        setLoadError(null)
        const bookingsList = bData as unknown as BookingWithDetails[]

        // Compute FIFO positions for waitlisted bookings
        // (Position based on count of waitlisted bookings for the same resource created on or before this one)
        const enriched = bookingsList.map((item) => {
          if (item.status === 'waitlisted') {
            // Count waitlisted bookings for same resource created <= item.created_at
            const pos = bookingsList.filter(
              (o) => o.resource_id === item.resource_id && o.status === 'waitlisted' && o.created_at <= item.created_at
            ).length
            return { ...item, fifo_position: pos }
          }
          return item
        })

        setBookings(enriched)

        // 2. Pending extension state is stored directly on each booking.
        const map: Record<string, { id: string; status: string; new_end_time: string; reason: string }> = {}
        for (const booking of bookingsList) {
          if (
            booking.extension_status === 'pending' &&
            booking.extension_requested_end_time &&
            booking.extension_reason
          ) {
            map[booking.id] = {
              id: booking.id,
              status: booking.extension_status,
              new_end_time: booking.extension_requested_end_time,
              reason: booking.extension_reason,
            }
          }
        }
        if (!ignore) setExtensionMap(map)
      } else if (bError) {
        setBookings([])
        setLoadError('We could not load your requests. Check your connection and try again.')
      }

      setLoading(false)
    }

    void loadBorrowerBookings()
    return () => {
      ignore = true
    }
  }, [user, refreshKey])

  const triggerRefresh = () => {
    setLoading(true)
    setLoadError(null)
    setRefreshKey((k) => k + 1)
  }

  // Count active physical custody items
  const activeCustodyCount = useMemo(() => {
    return bookings.filter((b) => b.status === 'in_use' || b.status === 'return_pending').length
  }, [bookings])

  // Filtered list
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (filterTab === 'active') {
        return b.status === 'approved' || b.status === 'in_use' || b.status === 'return_pending'
      }
      if (filterTab === 'pending') {
        return (
          b.status === 'pending_owner_review' ||
          b.status === 'pending_verification' ||
          b.status === 'waitlisted'
        )
      }
      if (filterTab === 'history') {
        return b.status === 'returned' || b.status === 'cancelled' || b.status === 'rejected'
      }
      return true
    })
  }, [bookings, filterTab])

  // Helper badge for booking status
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'in_use':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" aria-hidden="true"></span>
            Checked out
          </span>
        )
      case 'return_pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" aria-hidden="true" />
            Return waiting for staff
          </span>
        )
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            <CheckCircle2 className="w-3 h-3 text-blue-600" aria-hidden="true" />
            Approved
          </span>
        )
      case 'pending_owner_review':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <Hourglass className="w-3 h-3 text-indigo-600" aria-hidden="true" />
            Waiting for equipment staff
          </span>
        )
      case 'pending_verification':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" aria-hidden="true" />
            Waiting for a campus check
          </span>
        )
      case 'waitlisted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <Clock className="w-3 h-3 text-purple-600" aria-hidden="true" />
            Waiting in line
          </span>
        )
      case 'returned':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <CheckCircle2 className="w-3 h-3 text-slate-500" aria-hidden="true" />
            Returned &amp; Released
          </span>
        )
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200 line-through">
            <Ban className="w-3 h-3 text-slate-400" aria-hidden="true" />
            Cancelled
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" aria-hidden="true" />
            Declined
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
            {status}
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Context Header */}
      <div className="border-b border-slate-200 pb-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <CalendarDays className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            My Bookings
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            See which requests are waiting, approved, or finished.
          </p>
        </div>

        <div className="mt-3 sm:mt-0 flex items-center gap-2">
          <button
            type="button"
            onClick={triggerRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <Link
            to="/resources"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 shadow-2xs"
          >
            <span>Book Resource</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Active Custody Warning Banner */}
      {activeCustodyCount > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4.5 flex items-start gap-3 shadow-2xs">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs text-amber-950 space-y-1">
            <p className="font-bold text-amber-900">
              You have {activeCustodyCount} item{activeCustodyCount > 1 ? 's' : ''} checked out
            </p>
            <p className="leading-relaxed">
              Return checked-out items before requesting more. Staff must confirm the return first.
            </p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-200 gap-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setFilterTab('all')}
          className={`pb-3 px-3 border-b-2 transition-all ${
            filterTab === 'all'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          All Requests ({bookings.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab('active')}
          className={`pb-3 px-3 border-b-2 transition-all ${
            filterTab === 'active'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Approved &amp; Checked out
        </button>
        <button
          type="button"
          onClick={() => setFilterTab('pending')}
          className={`pb-3 px-3 border-b-2 transition-all ${
            filterTab === 'pending'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Waiting for review
        </button>
        <button
          type="button"
          onClick={() => setFilterTab('history')}
          className={`pb-3 px-3 border-b-2 transition-all ${
            filterTab === 'history'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Finished
        </button>
      </div>

      {/* Bookings Display List */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Loading your requests...
        </div>
      ) : loadError ? (
        <div role="alert" className="p-6 text-center text-sm text-rose-800 bg-rose-50 rounded-2xl border border-rose-200">
          <p>{loadError}</p>
          <button type="button" onClick={triggerRefresh} className="mt-3 font-semibold underline">
            Try again
          </button>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-3">
          <CalendarDays className="w-8 h-8 text-slate-300 mx-auto" aria-hidden="true" />
          <p className="font-semibold text-slate-800 text-sm">
            {filterTab === 'pending' ? 'No requests are waiting for review.' : 'No requests found in this view.'}
          </p>
          <p className="text-slate-500 max-w-sm mx-auto">
            Browse published equipment and campus spaces in the resource catalogue to submit a request.
          </p>
          <div className="pt-2">
            <Link
              to="/resources"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Browse Resources</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((b) => {
            const hasPendingExtension = Boolean(extensionMap[b.id])
            const canCancel =
              b.status === 'pending_owner_review' ||
              b.status === 'pending_verification' ||
              b.status === 'waitlisted' ||
              b.status === 'approved'
            const canExtend = (b.status === 'approved' || b.status === 'in_use') && !hasPendingExtension

            const startDate = new Date(b.start_time)
            const endDate = new Date(b.end_time)
            const durationHrs = Math.round(((endDate.getTime() - startDate.getTime()) / 3600000) * 10) / 10

            return (
              <div
                key={b.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4 hover:border-slate-300 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {renderStatusBadge(b.status)}
                      <span className="text-xs text-slate-400 font-mono">
                        Ref: #{b.id.slice(0, 8)}
                      </span>
                      {b.project_groups?.name && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                          <Layers className="w-3 h-3" aria-hidden="true" />
                          Group: {b.project_groups.name}
                        </span>
                      )}
                      {b.fifo_position && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        Place in line #{b.fifo_position}
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-bold text-slate-900">
                      {b.resources?.title || 'Resource'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {b.resources?.location_label} • Category: {b.resources?.category}
                    </p>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                    {/* Collection Checkout Action */}
                    {b.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() => setCheckoutTarget(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-xs transition-colors"
                      >
                        <PackageCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Confirm Collection</span>
                      </button>
                    )}

                    {/* Return Submission Action */}
                    {b.status === 'in_use' && (
                      <button
                        type="button"
                        onClick={() => setReturnTarget(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-xs transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Submit Return</span>
                      </button>
                    )}

                    {/* Awaiting Owner Confirmation Badge */}
                    {b.status === 'return_pending' && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium">
                        <Hourglass className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Awaiting Custodian Release</span>
                      </span>
                    )}

                    {canExtend && (
                      <button
                        type="button"
                        onClick={() => setExtendTarget(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Extend</span>
                      </button>
                    )}

                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition-colors"
                      >
                        <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Cancel</span>
                      </button>
                    )}

                    {/* Incident Reporting Action */}
                    {(b.status === 'approved' || b.status === 'in_use' || b.status === 'return_pending') && (
                      <button
                        type="button"
                        onClick={() => setIncidentTarget(b)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition-colors"
                        title="Report damage, delay, or scheduling conflict"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Report Issue</span>
                      </button>
                    )}

                    {/* Audit Timeline Action */}
                    <button
                      type="button"
                      onClick={() => setTimelineTarget(b)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition-colors"
                      title="View immutable Trust Record audit events"
                    >
                      <History className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                      <span>Timeline</span>
                    </button>
                  </div>
                </div>

                {/* Reservation Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400 block font-medium">Scheduled Window</span>
                    <span className="text-slate-900 font-semibold">
                      {startDate.toLocaleDateString()} {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[11px] text-slate-500 block">({durationHrs} hours total)</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium">Academic / Project Purpose</span>
                    <p className="text-slate-800 italic mt-0.5 line-clamp-2">"{b.purpose}"</p>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium">Custody &amp; Supervision</span>
                    <span className="text-slate-700 block">
                      {b.resources?.requires_supervision ? 'Supervisor Gate Active' : 'Unsupervised Access'}
                    </span>
                    {b.actual_start_at && (
                      <span className="text-[11px] text-indigo-700 font-medium block">
                        Checked Out: {new Date(b.actual_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Physical Condition Lifecycle Breakdown */}
                {(b.initial_condition_code || b.return_condition_code || b.actual_release_confirmed_at) && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-2xl bg-slate-50/80 border border-slate-200/80 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Initial Baseline</span>
                      <span className="font-bold text-slate-800 capitalize">
                        {b.initial_condition_code || 'Unrecorded'}
                      </span>
                      {b.initial_condition_notes && (
                        <p className="text-[11px] text-slate-500 italic mt-0.5 line-clamp-1">
                          "{b.initial_condition_notes}"
                        </p>
                      )}
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Return Submission</span>
                      <span className="font-bold text-slate-800 capitalize">
                        {b.return_condition_code || 'Pending'}
                      </span>
                      {b.return_condition_notes && (
                        <p className="text-[11px] text-slate-500 italic mt-0.5 line-clamp-1">
                          "{b.return_condition_notes}"
                        </p>
                      )}
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Physical Release</span>
                      {b.actual_release_confirmed_at ? (
                        <span className="font-bold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Confirmed Released</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 font-medium">In Active Custody</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Pending Extension Notice */}
                {hasPendingExtension && (
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-950 flex items-start gap-2">
                    <Clock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">
                        Extension Request Pending Owner Decision:
                      </p>
                      <p className="text-[11px] text-indigo-800 mt-0.5">
                        Requested new end time: {new Date(extensionMap[b.id].new_end_time).toLocaleString()}.
                        Justification: "{extensionMap[b.id].reason}".
                      </p>
                    </div>
                  </div>
                )}

                {/* Decision / Conflict Explanations */}
                {b.decision_reason && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <FileCheck className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                      <span>Documented Decision Explanation:</span>
                    </div>
                    <p className="text-slate-700 italic pl-5">
                      "{b.decision_reason}"
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Cancellation Modal */}
      {cancelTarget && (
        <CancelBookingModal
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSuccess={() => {
            setCancelTarget(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Extension Modal */}
      {extendTarget && (
        <RequestExtensionModal
          booking={extendTarget}
          onClose={() => setExtendTarget(null)}
          onSuccess={() => {
            setExtendTarget(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Collection Hand-Off Modal */}
      {checkoutTarget && (
        <ConfirmCheckoutModal
          booking={checkoutTarget}
          onClose={() => setCheckoutTarget(null)}
          onSuccess={() => {
            setCheckoutTarget(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Return Condition Submission Modal */}
      {returnTarget && (
        <SubmitReturnModal
          booking={returnTarget}
          onClose={() => setReturnTarget(null)}
          onSuccess={() => {
            setReturnTarget(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Report Incident Modal */}
      {incidentTarget && (
        <ReportIncidentModal
          booking={incidentTarget}
          onClose={() => setIncidentTarget(null)}
          onSuccess={() => {
            setIncidentTarget(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Booking Audit Timeline Modal */}
      {timelineTarget && (
        <BookingTimelineModal
          booking={timelineTarget}
          onClose={() => setTimelineTarget(null)}
        />
      )}
    </div>
  )
}

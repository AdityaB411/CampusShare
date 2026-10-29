import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { OwnerDecisionModal } from '../components/booking/OwnerDecisionModal'
import { DecideExtensionModal } from '../components/booking/DecideExtensionModal'
import { ConfirmReturnModal } from '../components/booking/ConfirmReturnModal'
import { ResolveIncidentModal } from '../components/booking/ResolveIncidentModal'
import { BookingTimelineModal } from '../components/booking/BookingTimelineModal'
import type { BookingWithDetails, ExtensionRequestWithDetails, IncidentWithDetails } from '../types/booking'
import {
  Inbox,
  UserCheck,
  Check,
  X,
  Clock,
  CheckCircle2,
  Layers,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  History,
  FileCheck2,
  Search,
} from 'lucide-react'

export const OwnerQueuePage: React.FC = () => {
  const { user, profile } = useAuth()
  const isManagerOrAdmin = profile?.primary_role === 'manager' || profile?.primary_role === 'admin'

  const [bookings, setBookings] = useState<BookingWithDetails[]>([])
  const [extensions, setExtensions] = useState<ExtensionRequestWithDetails[]>([])
  const [returnsList, setReturnsList] = useState<BookingWithDetails[]>([])
  const [incidentsList, setIncidentsList] = useState<IncidentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'requests' | 'returns' | 'incidents' | 'extensions'>('requests')
  const [refreshKey, setRefreshKey] = useState(0)

  // Decision Modal state
  const [decisionAction, setDecisionAction] = useState<'approve' | 'reject' | 'waitlist' | null>(null)
  const [targetBooking, setTargetBooking] = useState<BookingWithDetails | null>(null)
  const [targetExtension, setTargetExtension] = useState<ExtensionRequestWithDetails | null>(null)
  const [targetConfirmReturn, setTargetConfirmReturn] = useState<BookingWithDetails | null>(null)
  const [targetIncident, setTargetIncident] = useState<IncidentWithDetails | null>(null)
  const [timelineTarget, setTimelineTarget] = useState<BookingWithDetails | null>(null)

  useEffect(() => {
    let ignore = false

    async function loadReviewQueue() {
      if (!user) {
        setLoading(false)
        return
      }

      // 1. Fetch pending bookings for review
      // Managers/admins see all pending campus bookings; owners see their owned resource bookings
      let query = supabase
        .from('bookings')
        .select('*, resources(*), project_groups(name), profiles:requester_id(display_name, primary_role, campus_affiliation_status)')
        .in('status', ['pending_owner_review', 'pending_verification', 'waitlisted'])
        .order('created_at', { ascending: true }) // Strict FIFO order

      let ownedIds: string[] = []
      if (!isManagerOrAdmin) {
        // Query resources owned by this user
        const { data: ownedRes } = await supabase
          .from('resources')
          .select('id')
          .eq('owner_id', user.id)

        ownedIds = ownedRes?.map((r) => r.id) || []
        if (ownedIds.length === 0) {
          if (!ignore) {
            setBookings([])
            setExtensions([])
            setReturnsList([])
            setIncidentsList([])
            setLoading(false)
          }
          return
        }
        query = query.in('resource_id', ownedIds)
      }

      const { data: bData, error: bError } = await query

      if (ignore) return

      if (!bError && bData) {
        // Assign FIFO index (#1, #2, ...)
        const fifoEnriched = (bData as unknown as BookingWithDetails[]).map((item, idx) => ({
          ...item,
          fifo_position: idx + 1,
        }))
        setBookings(fifoEnriched)
      }

      // 2. Fetch pending extensions from booking-embedded state.
      let extensionQuery = supabase
        .from('bookings')
        .select('*, resources(*), profiles:requester_id(display_name)')
        .eq('extension_status', 'pending')
        .order('extension_requested_at', { ascending: true })

      if (!isManagerOrAdmin && ownedIds.length > 0) {
        extensionQuery = extensionQuery.in('resource_id', ownedIds)
      }

      const { data: extData, error: extError } = await extensionQuery

      if (!ignore && !extError && extData) {
        const mapped = extData
          .filter((item) => item.extension_requested_end_time && item.extension_reason && item.extension_requested_at)
          .map((item) => ({
            id: item.id,
            booking_id: item.id,
            requested_by: item.requester_id,
            new_end_time: item.extension_requested_end_time!,
            reason: item.extension_reason!,
            status: item.extension_status as 'pending' | 'approved' | 'rejected',
            decided_by: item.extension_decided_by,
            decision_reason: item.extension_decision_reason,
            created_at: item.extension_requested_at!,
            decided_at: item.extension_decided_at,
            bookings: item,
          }))
        setExtensions(mapped as unknown as ExtensionRequestWithDetails[])
      }

      // 3. Fetch returns awaiting custodian confirmation
      let retQuery = supabase
        .from('bookings')
        .select('*, resources(*), project_groups(name), profiles:requester_id(display_name, primary_role, campus_affiliation_status)')
        .in('status', ['return_pending', 'in_use'])
        .order('updated_at', { ascending: false })

      if (!isManagerOrAdmin && ownedIds.length > 0) {
        retQuery = retQuery.in('resource_id', ownedIds)
      }

      const { data: retData } = await retQuery
      if (!ignore && retData) {
        setReturnsList(retData as unknown as BookingWithDetails[])
      }

      // 4. Fetch open/investigating incidents
      let incQuery = supabase
        .from('incidents')
        .select('*, resources(*), bookings(*), profiles:reporter_id(display_name, primary_role)')
        .in('status', ['open', 'investigating'])
        .order('created_at', { ascending: false })

      if (!isManagerOrAdmin && ownedIds.length > 0) {
        incQuery = incQuery.in('resource_id', ownedIds)
      }

      const { data: incData } = await incQuery
      if (!ignore && incData) {
        setIncidentsList(incData as unknown as IncidentWithDetails[])
      }

      setLoading(false)
    }

    void loadReviewQueue()
    return () => {
      ignore = true
    }
  }, [user, isManagerOrAdmin, refreshKey])

  const triggerRefresh = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  const handleOpenDecision = (action: 'approve' | 'reject' | 'waitlist', booking: BookingWithDetails) => {
    setDecisionAction(action)
    setTargetBooking(booking)
  }

  // Count summary
  const pendingRequestsCount = bookings.length
  const pendingExtensionsCount = extensions.length

  return (
    <div className="space-y-6">
      {/* Page Title & Context Header */}
      <div className="border-b border-slate-200 pb-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Inbox className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            Owner &amp; Manager Review Queue
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            {isManagerOrAdmin
              ? 'Campus Manager view: Review all campus resource reservations, assign supervisors, and decide extensions.'
              : 'Custodian Workbench: Review booking requests for your published equipment and spaces in FIFO queue order.'}
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
            <span>Refresh Queue</span>
          </button>
        </div>
      </div>

      {/* Rules Notice */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4.5 flex items-start gap-3 shadow-2xs">
        <UserCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs text-indigo-950 space-y-1">
          <p className="font-bold text-indigo-900">
            Accountable Review Protocol (Final Plan v1.2)
          </p>
          <div className="text-indigo-900/90 leading-relaxed grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
            <div>
              • <strong>FIFO Priority:</strong> Review earliest submissions first (#1, #2) to ensure fairness across departments.
            </div>
            <div>
              • <strong>Custody Blocker:</strong> If an item is currently In-Use without return confirmed, approvals are halted.
            </div>
            <div>
              • <strong>Mandatory Reasons:</strong> Rejections and waitlist placements require a recorded justification.
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-1 text-xs font-semibold overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'requests'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Reservation Requests</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-800">
            {pendingRequestsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('returns')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'returns'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Returns to Confirm</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] ${
            returnsList.length > 0 ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-slate-100 text-slate-600'
          }`}>
            {returnsList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('incidents')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'incidents'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          <span>Incident Reports</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] ${
            incidentsList.length > 0 ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-slate-100 text-slate-600'
          }`}>
            {incidentsList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('extensions')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'extensions'
              ? 'border-indigo-600 text-indigo-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Extension Requests</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700">
            {pendingExtensionsCount}
          </span>
        </button>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Loading review items from database...
        </div>
      ) : activeTab === 'requests' ? (
        /* Reservation Requests Tab */
        bookings.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" aria-hidden="true" />
            <p className="font-semibold text-slate-800 text-sm">Review Queue is Clear!</p>
            <p className="text-slate-400">There are no pending booking requests awaiting your decision.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b) => {
              const startDate = new Date(b.start_time)
              const endDate = new Date(b.end_time)
              const durationHrs = Math.round(((endDate.getTime() - startDate.getTime()) / 3600000) * 10) / 10
              const isFirst = b.fifo_position === 1

              return (
                <div
                  key={b.id}
                  className={`bg-white rounded-2xl border p-5 space-y-4 shadow-2xs transition-all ${
                    isFirst ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isFirst
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          FIFO Position #{b.fifo_position}
                          {isFirst && ' (Earliest)'}
                        </span>

                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            b.status === 'pending_verification'
                              ? 'bg-amber-100 text-amber-800'
                              : b.status === 'waitlisted'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {b.status}
                        </span>

                        <span className="text-xs text-slate-400 font-mono">
                          ID: #{b.id.slice(0, 8)}
                        </span>

                        {b.project_groups?.name && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700">
                            <Layers className="w-3 h-3" aria-hidden="true" />
                            Group: {b.project_groups.name}
                          </span>
                        )}
                      </div>

                      <h2 className="text-base font-bold text-slate-900">
                        {b.resources?.title || 'Resource'}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Location: {b.resources?.location_label} • Max cap: {b.resources?.max_duration_hours}h
                      </p>
                    </div>

                    {/* Decision Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleOpenDecision('approve', b)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Approve</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenDecision('waitlist', b)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Waitlist</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenDecision('reject', b)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Reject</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTimelineTarget(b)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors"
                        title="View immutable audit timeline"
                      >
                        <History className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                        <span>Timeline</span>
                      </button>
                    </div>
                  </div>

                  {/* Request Breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-slate-600">
                    <div>
                      <span className="text-slate-400 block font-medium">Borrower Details</span>
                      <span className="text-slate-900 font-semibold">
                        {b.profiles?.display_name || 'Campus User'}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        Affiliation: {b.profiles?.campus_affiliation_status || 'unverified'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-medium">Requested Time</span>
                      <span className="text-slate-900 font-medium">
                        {startDate.toLocaleDateString()} {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        to {endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({durationHrs}h)
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-medium">Supervision Status</span>
                      <span className="text-slate-800 block">
                        {b.resources?.requires_supervision ? 'Mandatory Supervisor Sign-off' : 'None Required'}
                      </span>
                      {b.supervisor_user_id && (
                        <span className="text-[11px] text-emerald-700 font-medium block">
                          Supervisor: {b.supervisor_user_id}
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-slate-400 block font-medium">Prerequisite Code</span>
                      <span className="font-mono text-indigo-700 font-semibold block">
                        {b.resources?.required_training_code || 'None'}
                      </span>
                    </div>
                  </div>

                  {/* Stated Purpose */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <span className="text-slate-400 block font-medium">Stated Academic Purpose</span>
                    <p className="text-slate-800 italic mt-0.5">"{b.purpose}"</p>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : activeTab === 'returns' ? (
        /* Returns to Confirm Tab */
        returnsList.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" aria-hidden="true" />
            <p className="font-semibold text-slate-800 text-sm">No Pending Returns</p>
            <p className="text-slate-400">All equipment hand-backs and room vacatings have been verified and released.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {returnsList.map((b) => (
              <div
                key={b.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4 hover:border-slate-300 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                        b.status === 'return_pending'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-indigo-100 text-indigo-900 border-indigo-200'
                      }`}>
                        {b.status === 'return_pending' ? 'Return Submitted • Awaiting Inspection' : 'Currently In Use'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Booking #{b.id.slice(0, 8)}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900">
                      {b.resources?.title || 'Resource'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Borrower: <strong className="text-slate-800">{b.profiles?.display_name || 'Member'}</strong> • Location: {b.resources?.location_label}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <button
                      type="button"
                      onClick={() => setTargetConfirmReturn(b)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs transition-colors"
                    >
                      <FileCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Confirm Return &amp; Release</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTimelineTarget(b)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors"
                    >
                      <History className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Timeline</span>
                    </button>
                  </div>
                </div>

                {/* Condition Comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Baseline Start Condition</span>
                    <span className="font-bold text-slate-800 capitalize">
                      {b.initial_condition_code || 'unrecorded'}
                    </span>
                    {b.initial_condition_notes && (
                      <p className="text-[11px] text-slate-500 italic mt-0.5 line-clamp-1">
                        "{b.initial_condition_notes}"
                      </p>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Reported Return Condition</span>
                    <span className="font-bold text-slate-800 capitalize">
                      {b.return_condition_code || 'Awaiting return form'}
                    </span>
                    {b.return_condition_notes && (
                      <p className="text-[11px] text-slate-500 italic mt-0.5 line-clamp-1">
                        "{b.return_condition_notes}"
                      </p>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Custody Window</span>
                    <span className="text-slate-800 font-medium block">
                      Due: {new Date(b.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {b.actual_start_at && (
                      <span className="text-[11px] text-indigo-700 block">
                        Checked Out: {new Date(b.actual_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : activeTab === 'incidents' ? (
        /* Incidents Tab */
        incidentsList.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" aria-hidden="true" />
            <p className="font-semibold text-slate-800 text-sm">No Open Incidents</p>
            <p className="text-slate-400">All damage, delay, and scheduling issues have been resolved.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {incidentsList.map((inc) => (
              <div
                key={inc.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4 hover:border-slate-300 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                        inc.type === 'damage'
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : inc.type === 'delay'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-purple-100 text-purple-800 border border-purple-200'
                      }`}>
                        {inc.type.replace('_', ' ')}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 capitalize">
                        Status: {inc.status}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Incident #{inc.id.slice(0, 8)}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900">
                      {inc.resources?.title || 'Campus Asset'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Reported by: <strong className="text-slate-800">{inc.profiles?.display_name || 'Member'}</strong> • {new Date(inc.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <button
                      type="button"
                      onClick={() => setTargetIncident(inc)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-2xs transition-colors"
                    >
                      <Search className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Review &amp; Record Resolution</span>
                    </button>

                    {inc.booking_id && inc.bookings && (
                      <button
                        type="button"
                        onClick={() => {
                          setTimelineTarget(inc.bookings as unknown as BookingWithDetails)
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors"
                      >
                        <History className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Timeline</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-100 text-xs text-rose-950 space-y-1">
                  <div className="font-semibold text-rose-900">Incident Details:</div>
                  <p className="italic text-slate-800 leading-relaxed bg-white p-2.5 rounded-xl border border-rose-100">
                    "{inc.description}"
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Extension Requests Tab */
        extensions.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" aria-hidden="true" />
            <p className="font-semibold text-slate-800 text-sm">No Pending Extension Requests</p>
            <p className="text-slate-400">All extension requests have been processed.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {extensions.map((ext) => {
              const resTitle = ext.bookings?.resources?.title || 'Resource'
              const requester = ext.bookings?.profiles?.display_name || 'Borrower'

              return (
                <div
                  key={ext.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                          Extension Pending
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          Booking #{ext.booking_id.slice(0, 8)}
                        </span>
                      </div>
                      <h2 className="text-base font-bold text-slate-900">{resTitle}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Requested by: <strong>{requester}</strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setTargetExtension(ext)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-2xs transition-colors self-start sm:self-center"
                    >
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Review &amp; Decide Extension</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
                    <div>
                      <span className="text-slate-400 block font-medium">Current Due Time</span>
                      <span className="text-slate-900 font-medium">
                        {ext.bookings?.end_time ? new Date(ext.bookings.end_time).toLocaleString() : 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-medium">Requested Extended End</span>
                      <span className="text-indigo-700 font-bold">
                        {new Date(ext.new_end_time).toLocaleString()}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-medium">Justification</span>
                      <p className="text-slate-800 italic line-clamp-2">"{ext.reason}"</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Decision Modal for Booking Requests */}
      {decisionAction && targetBooking && (
        <OwnerDecisionModal
          action={decisionAction}
          booking={targetBooking}
          onClose={() => {
            setDecisionAction(null)
            setTargetBooking(null)
          }}
          onSuccess={() => {
            setDecisionAction(null)
            setTargetBooking(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Decision Modal for Extension Requests */}
      {targetExtension && (
        <DecideExtensionModal
          extension={targetExtension}
          onClose={() => setTargetExtension(null)}
          onSuccess={() => {
            setTargetExtension(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Return Hand-Back Confirmation Modal */}
      {targetConfirmReturn && (
        <ConfirmReturnModal
          booking={targetConfirmReturn}
          onClose={() => setTargetConfirmReturn(null)}
          onSuccess={() => {
            setTargetConfirmReturn(null)
            triggerRefresh()
          }}
        />
      )}

      {/* Incident Resolution Modal */}
      {targetIncident && (
        <ResolveIncidentModal
          incident={targetIncident}
          onClose={() => setTargetIncident(null)}
          onSuccess={() => {
            setTargetIncident(null)
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

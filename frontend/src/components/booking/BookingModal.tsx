import React, { useState, useEffect, useId } from 'react'
import { useAuth } from '../../context/useAuth'
import { supabase } from '../../lib/supabase'
import type { Resource } from '../../types/booking'
import {
  X,
  Calendar,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Users,
  User,
  Info,
  Loader2,
  CheckCircle2,
} from 'lucide-react'

interface BookingModalProps {
  resource: Resource
  onClose: () => void
  onSuccess: (bookingId: string, status: string, note?: string | null) => void
}

interface ProjectGroupOption {
  id: string
  name: string
}

export const BookingModal: React.FC<BookingModalProps> = ({
  resource,
  onClose,
  onSuccess,
}) => {
  const { user, profile } = useAuth()
  const titleId = useId()

  const [startTime, setStartTime] = useState(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })

  const [endTime, setEndTime] = useState(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 3)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })

  const [purpose, setPurpose] = useState('')
  const [bookingType, setBookingType] = useState<'individual' | 'group'>('individual')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [groups, setGroups] = useState<ProjectGroupOption[]>([])
  const [supervisorId, setSupervisorId] = useState('')

  // Eligibility check state
  const [eligibilityChecking, setEligibilityChecking] = useState(true)
  const [eligibility, setEligibility] = useState<{ isEligible: boolean; reason: string | null } | null>(null)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Calculate duration
  const startMs = new Date(startTime).getTime()
  const endMs = new Date(endTime).getTime()
  const durationHours = !isNaN(startMs) && !isNaN(endMs) && endMs > startMs
    ? Math.round(((endMs - startMs) / 3600000) * 100) / 100
    : 0

  const isDurationExceeded = durationHours > resource.max_duration_hours

  // 1. Check borrower eligibility & project groups via database
  useEffect(() => {
    let ignore = false

    async function loadPreflightData() {
      if (!user) {
        setEligibilityChecking(false)
        return
      }

      // 1. Check eligibility
      const { data: eligData, error: eligErr } = await supabase.rpc('check_borrower_eligibility', {
        p_user_id: user.id,
        p_resource_id: resource.id,
      })

      if (!ignore) {
        if (!eligErr && eligData && eligData.length > 0) {
          setEligibility({
            isEligible: eligData[0].is_eligible,
            reason: eligData[0].missing_reason,
          })
        } else {
          const isAffiliated = profile?.campus_affiliation_status === 'verified'
          setEligibility({
            isEligible: isAffiliated,
            reason: isAffiliated ? null : 'Campus affiliation not verified in profile.',
          })
        }
        setEligibilityChecking(false)
      }

      // 2. Load verified groups
      const { data: grpData, error: grpErr } = await supabase
        .from('group_members')
        .select('group_id, project_groups(id, name, is_verified)')
        .eq('user_id', user.id)
        .eq('status', 'approved')

      if (!ignore && !grpErr && grpData) {
        const verified = grpData
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => item.project_groups)
          .filter((g: { is_verified?: boolean } | null) => g && g.is_verified) as ProjectGroupOption[]
        setGroups(verified)
        if (verified.length > 0) {
          setSelectedGroupId(verified[0].id)
        }
      }
    }

    void loadPreflightData()
    return () => {
      ignore = true
    }
  }, [user, profile, resource.id])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Preset duration helper
  const setPresetDuration = (hours: number) => {
    const s = new Date(startTime)
    if (isNaN(s.getTime())) return
    const e = new Date(s.getTime() + hours * 3600000)
    setEndTime(new Date(e.getTime() - e.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
  }

  // Handle submit via database RPC
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!user) {
      setErrorMessage('You must be signed in to submit a reservation.')
      return
    }

    if (!purpose.trim()) {
      setErrorMessage('Please state the purpose of your booking.')
      return
    }

    if (durationHours <= 0) {
      setErrorMessage('End time must be strictly after start time.')
      return
    }

    if (isDurationExceeded) {
      setErrorMessage(
        `Requested duration (${durationHours}h) exceeds the maximum allowed ${resource.max_duration_hours}h for this resource.`
      )
      return
    }

    if (bookingType === 'group' && !selectedGroupId) {
      setErrorMessage('Please select a verified project group.')
      return
    }

    if (resource.requires_supervision && !supervisorId.trim()) {
      setErrorMessage('This resource requires an authorized supervisor. Please provide supervisor credentials/ID.')
      return
    }

    setSubmitting(true)

    try {
      const startIso = new Date(startTime).toISOString()
      const endIso = new Date(endTime).toISOString()

      const { data, error } = await supabase.rpc('submit_booking_request', {
        p_resource_id: resource.id,
        p_start_time: startIso,
        p_end_time: endIso,
        p_purpose: purpose.trim(),
        p_group_id: bookingType === 'group' ? (selectedGroupId || undefined) : undefined,
        p_supervisor_user_id: supervisorId.trim() || undefined,
      })

      setSubmitting(false)

      if (error) {
        setErrorMessage(error.message)
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resData = data as any
      if (resData && resData.success) {
        onSuccess(
          resData.booking_id,
          resData.status,
          resData.eligibility_note || (resData.is_eligible ? null : 'Pending prerequisite verification')
        )
      } else {
        setErrorMessage('Submission failed. Please check reservation details.')
      }
    } catch (err: unknown) {
      setSubmitting(false)
      const errObj = err as Error
      setErrorMessage(errObj.message || 'Unexpected error submitting booking.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                {resource.type}
              </span>
              <span className="text-xs text-slate-300 font-mono">
                Max {resource.max_duration_hours}h cap
              </span>
            </div>
            <h2 id={titleId} className="text-lg sm:text-xl font-bold tracking-tight text-white">
              Request: {resource.title}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              {resource.location_label} • Category: {resource.category}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close booking modal"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* Error Banner */}
          {errorMessage && (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 flex items-start gap-2.5"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold">Booking Submission Blocked</p>
                <p className="mt-0.5 text-rose-800">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Pre-flight Eligibility & Supervision Gate Feedback */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between font-semibold text-slate-900">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                Pre-Flight Eligibility Status
              </span>
              {eligibilityChecking ? (
                <span className="flex items-center gap-1 text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Checking gate...
                </span>
              ) : eligibility?.isEligible ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Eligible for Direct Review
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-100 px-2 py-0.5 rounded font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  Prerequisite Pending
                </span>
              )}
            </div>

            {eligibility && !eligibility.isEligible && (
              <p className="text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                <strong>Attention:</strong> {eligibility.reason || 'Missing campus qualification'}.
                Your request will enter <em>pending_verification</em> so campus managers can verify your credentials before the owner review.
              </p>
            )}

            {resource.required_training_code && (
              <div className="text-slate-600 flex items-center justify-between pt-1 border-t border-slate-200/60">
                <span>Required Certification:</span>
                <span className="font-mono font-semibold text-indigo-700">
                  {resource.required_training_code}
                </span>
              </div>
            )}

            {resource.requires_supervision && (
              <div className="text-amber-800 bg-amber-50/80 p-2 rounded-lg border border-amber-200/70">
                <strong>Supervision Mandate:</strong> This space/equipment requires faculty or certified lab supervisor sign-off before check-out.
              </div>
            )}
          </div>

          {/* Booking Mode: Individual vs Verified Project Group */}
          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-2">
              Reservation Entity
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setBookingType('individual')}
                className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                  bookingType === 'individual'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <User className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                <div className="text-left">
                  <div className="font-bold">Individual Borrower</div>
                  <div className="text-[11px] font-normal text-slate-500">Personal fair-use quota</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBookingType('group')}
                className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                  bookingType === 'group'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Users className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                <div className="text-left">
                  <div className="font-bold">Verified Project Group</div>
                  <div className="text-[11px] font-normal text-slate-500">Shared project allocation</div>
                </div>
              </button>
            </div>

            {/* Project Group Select */}
            {bookingType === 'group' && (
              <div className="mt-3 p-3 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-2">
                <label htmlFor="group-select" className="block text-xs font-semibold text-indigo-950">
                  Select Verified Project Group
                </label>
                {groups.length === 0 ? (
                  <div className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                    You do not have any active memberships in verified project groups. Switch to Individual or request group verification in your department.
                  </div>
                ) : (
                  <select
                    id="group-select"
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    className="w-full text-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-indigo-600"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} (Verified)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Time Range Selector */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                Scheduled Time Range (Local Time)
              </label>

              {/* Quick Presets */}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPresetDuration(1)}
                  className="px-2 py-1 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  +1h
                </button>
                <button
                  type="button"
                  onClick={() => setPresetDuration(2)}
                  className="px-2 py-1 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  +2h
                </button>
                <button
                  type="button"
                  onClick={() => setPresetDuration(4)}
                  className="px-2 py-1 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  +4h
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="start-time" className="block text-[11px] font-medium text-slate-500 mb-1">
                  Start Date &amp; Time
                </label>
                <input
                  id="start-time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
                  required
                />
              </div>

              <div>
                <label htmlFor="end-time" className="block text-[11px] font-medium text-slate-500 mb-1">
                  End Date &amp; Time
                </label>
                <input
                  id="end-time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
                  required
                />
              </div>
            </div>

            {/* Duration & Fair-Use Cap Counter */}
            <div className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <span className="flex items-center gap-1 text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                Requested Duration:
              </span>
              <span
                className={`font-semibold ${
                  isDurationExceeded
                    ? 'text-rose-600'
                    : durationHours <= 0
                    ? 'text-amber-600'
                    : 'text-slate-900'
                }`}
              >
                {durationHours > 0 ? `${durationHours} hours` : 'Invalid interval'}{' '}
                <span className="font-normal text-slate-500">
                  (Cap: max {resource.max_duration_hours}h)
                </span>
              </span>
            </div>
            {isDurationExceeded && (
              <p className="text-xs text-rose-600">
                The requested interval exceeds the maximum allowed {resource.max_duration_hours} hours. Please adjust the end time.
              </p>
            )}
          </div>

          {/* Supervisor User ID (if required) */}
          {resource.requires_supervision && (
            <div>
              <label htmlFor="supervisor-id" className="block text-xs font-semibold text-slate-900 mb-1">
                Faculty / Lab Supervisor User ID or Name
              </label>
              <input
                id="supervisor-id"
                type="text"
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
                placeholder="e.g. Prof. Raman or lab supervisor UUID"
                className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
                required
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Supervised spaces require supervisor confirmation before check-out can proceed.
              </p>
            </div>
          )}

          {/* Purpose of Booking */}
          <div>
            <label htmlFor="booking-purpose" className="block text-xs font-semibold text-slate-900 mb-1">
              Academic / Project Purpose <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="booking-purpose"
              rows={3}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe your research project, lab experiment, or production task..."
              className="w-full text-xs rounded-lg border border-slate-300 p-3 text-slate-900 focus:outline-indigo-600"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Accountability rule: Purpose is stored immutably in the Trust Record audit trail.
            </p>
          </div>

          {/* Usage Limit Rules Accordion/Box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-[11px] text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Info className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
              Fair-Use &amp; Custody Limits
            </div>
            <p>
              • <strong>Open Reservations:</strong> Max 3 active/open items per individual (max 5 for verified groups).
            </p>
            <p>
              • <strong>7-Day Frequency:</strong> Max 5 bookings in any rolling 7-day period.
            </p>
            <p>
              • <strong>FIFO Review:</strong> Requests are processed in FIFO order by the resource custodian.
            </p>
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || durationHours <= 0 || isDurationExceeded}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Submitting via Secure RPC...</span>
                </>
              ) : (
                <span>Submit Booking Request</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

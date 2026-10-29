import React, { useState, useEffect, useId } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ShieldAlert,
} from 'lucide-react'

interface OwnerDecisionModalProps {
  action: 'approve' | 'reject' | 'waitlist'
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

export const OwnerDecisionModal: React.FC<OwnerDecisionModalProps> = ({
  action,
  booking,
  onClose,
  onSuccess,
}) => {
  const titleId = useId()
  const [decisionReason, setDecisionReason] = useState('')
  const [supervisorId, setSupervisorId] = useState(booking.supervisor_user_id || '')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const requiresSupervisor = Boolean(booking.resources?.requires_supervision)
  const isReasonMandatory = action === 'reject' || action === 'waitlist'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (isReasonMandatory && !decisionReason.trim()) {
      setErrorMessage(
        action === 'reject'
          ? 'Rejections require a documented, human-readable reason.'
          : 'Waitlisting requires an explanation (e.g. slot contention, high-demand queue).'
      )
      return
    }

    if (action === 'approve' && requiresSupervisor && !supervisorId.trim()) {
      setErrorMessage('Supervised resources require an assigned supervisor ID before approval.')
      return
    }

    setSubmitting(true)

    try {
      if (action === 'approve') {
        const { error } = await supabase.rpc('approve_booking_request', {
          p_booking_id: booking.id,
          p_decision_reason: decisionReason.trim() || undefined,
          p_supervisor_user_id: supervisorId.trim() || undefined,
        })

        if (error) {
          setErrorMessage(error.message)
          setSubmitting(false)
          return
        }
      } else if (action === 'reject') {
        const { error } = await supabase.rpc('reject_booking_request', {
          p_booking_id: booking.id,
          p_decision_reason: decisionReason.trim(),
        })

        if (error) {
          setErrorMessage(error.message)
          setSubmitting(false)
          return
        }
      } else if (action === 'waitlist') {
        const { error } = await supabase.rpc('waitlist_booking_request', {
          p_booking_id: booking.id,
          p_decision_reason: decisionReason.trim(),
        })

        if (error) {
          setErrorMessage(error.message)
          setSubmitting(false)
          return
        }
      }

      setSubmitting(false)
      onSuccess()
    } catch (err: unknown) {
      setSubmitting(false)
      const errObj = err as Error
      setErrorMessage(errObj.message || 'Unexpected error processing decision.')
    }
  }

  const titleText =
    action === 'approve'
      ? 'Approve Reservation Request'
      : action === 'reject'
      ? 'Decline Reservation Request'
      : 'Place on Waitlist Queue'

  const headerBg =
    action === 'approve'
      ? 'bg-emerald-900 text-white'
      : action === 'reject'
      ? 'bg-rose-900 text-white'
      : 'bg-amber-900 text-white'

  const buttonBg =
    action === 'approve'
      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
      : action === 'reject'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : 'bg-amber-600 hover:bg-amber-700 text-white'

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className={`${headerBg} px-6 py-4 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            {action === 'approve' && <CheckCircle2 className="w-5 h-5 text-emerald-300" aria-hidden="true" />}
            {action === 'reject' && <XCircle className="w-5 h-5 text-rose-300" aria-hidden="true" />}
            {action === 'waitlist' && <Clock className="w-5 h-5 text-amber-300" aria-hidden="true" />}
            <h2 id={titleId} className="text-base font-bold text-white">
              {titleText}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Conflict or Error Alert Banner */}
          {errorMessage && (
            <div
              className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-950 flex items-start gap-2.5"
              role="alert"
            >
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold text-rose-900">Decision Blocked by Database Rule</p>
                <p className="mt-0.5 text-rose-800 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Booking Summary Box */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-700 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{booking.resources?.title}</h3>
                <p className="text-slate-500">{booking.resources?.location_label}</p>
              </div>
              {booking.fifo_position && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-100 text-indigo-800">
                  FIFO #{booking.fifo_position}
                </span>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400 block font-medium">Borrower</span>
                <span className="text-slate-900 font-semibold">
                  {booking.profiles?.display_name || 'Campus User'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Affiliation: {booking.profiles?.campus_affiliation_status || 'unverified'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Time Window</span>
                <span className="text-slate-900 font-medium">
                  {new Date(booking.start_time).toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  to {new Date(booking.end_time).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="pt-1.5 border-t border-slate-200/60">
              <span className="text-slate-400 block font-medium">Stated Purpose</span>
              <p className="text-slate-800 italic mt-0.5">"{booking.purpose}"</p>
            </div>
          </div>

          {/* Supervisor Assignment (if required for approval) */}
          {action === 'approve' && requiresSupervisor && (
            <div>
              <label htmlFor="supervisor-input" className="block text-xs font-semibold text-slate-900 mb-1">
                Designated Lab / Faculty Supervisor <span className="text-rose-500">*</span>
              </label>
              <input
                id="supervisor-input"
                type="text"
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
                placeholder="Supervisor UUID or institutional handle"
                className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-emerald-600"
                required
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Required for supervised resources. Supervisor must acknowledge before checkout.
              </p>
            </div>
          )}

          {/* Decision Reason Textarea */}
          <div>
            <label htmlFor="decision-reason" className="block text-xs font-semibold text-slate-900 mb-1">
              {action === 'approve'
                ? 'Approval Notes (Optional)'
                : action === 'reject'
                ? 'Rejection Reason (Mandatory)'
                : 'Waitlist Justification (Mandatory)'}
              {isReasonMandatory && <span className="text-rose-500"> *</span>}
            </label>
            <textarea
              id="decision-reason"
              rows={3}
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder={
                action === 'approve'
                  ? 'Add instructions for pickup or special handling...'
                  : action === 'reject'
                  ? 'Explain why request cannot be accommodated (e.g. maintenance window, schedule overlap)...'
                  : 'Explain queue placement (e.g. high slot contention, prioritized earlier request)...'
              }
              className="w-full text-xs rounded-lg border border-slate-300 p-3 text-slate-900 focus:outline-indigo-600"
              required={isReasonMandatory}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Accountability rule: Reason will be written to the borrower's notifications and the Trust Record.
            </p>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (isReasonMandatory && !decisionReason.trim())}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 ${buttonBg}`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Confirm {action === 'approve' ? 'Approval' : action === 'reject' ? 'Rejection' : 'Waitlisting'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

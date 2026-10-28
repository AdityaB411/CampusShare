import React, { useState, useEffect, useId } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import { X, AlertTriangle, Loader2 } from 'lucide-react'

interface CancelBookingModalProps {
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

export const CancelBookingModal: React.FC<CancelBookingModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!reason.trim()) {
      setErrorMessage('A documented reason is mandatory when cancelling a campus reservation.')
      return
    }

    setSubmitting(true)

    try {
      const { error } = await supabase.rpc('cancel_booking', {
        p_booking_id: booking.id,
        p_reason: reason.trim(),
      })

      setSubmitting(false)

      if (error) {
        setErrorMessage(error.message)
      } else {
        onSuccess()
      }
    } catch (err: unknown) {
      setSubmitting(false)
      const errObj = err as Error
      setErrorMessage(errObj.message || 'Unexpected error cancelling reservation.')
    }
  }

  const resourceTitle = booking.resources?.title || 'Resource'

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-rose-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-300" aria-hidden="true" />
            <h2 id={titleId} className="text-base font-bold text-white">
              Cancel Reservation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-rose-200 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCancel} className="p-6 space-y-4">
          {errorMessage && (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1">
            <p className="font-semibold text-slate-900">{resourceTitle}</p>
            <p className="text-slate-500">
              Scheduled: {new Date(booking.start_time).toLocaleString()} – {new Date(booking.end_time).toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
              Booking Ref: <span className="font-mono">{booking.id.slice(0, 8)}</span> • Current status: <span className="font-medium text-slate-800">{booking.status}</span>
            </p>
          </div>

          <div>
            <label htmlFor="cancel-reason" className="block text-xs font-semibold text-slate-900 mb-1">
              Cancellation Justification <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State the reason (e.g., project schedule shifted, equipment no longer required)..."
              className="w-full text-xs rounded-lg border border-slate-300 p-3 text-slate-900 focus:outline-rose-600"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Accountability rule: Cancellations are permanently recorded in the Trust Record audit log.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Keep Booking
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Confirm Cancellation</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

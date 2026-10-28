import React, { useState, useEffect, useId } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import { X, Clock, AlertTriangle, Loader2, Info } from 'lucide-react'

interface RequestExtensionModalProps {
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

export const RequestExtensionModal: React.FC<RequestExtensionModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const titleId = useId()

  // Calculate default new end time: current end_time + 1 hour
  const [newEndTime, setNewEndTime] = useState(() => {
    const curr = new Date(booking.end_time)
    const next = new Date(curr.getTime() + 3600000)
    return new Date(next.getTime() - next.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })

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

  const currentEndMs = new Date(booking.end_time).getTime()
  const newEndMs = new Date(newEndTime).getTime()
  const isInvalidEndTime = isNaN(newEndMs) || newEndMs <= currentEndMs

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (isInvalidEndTime) {
      setErrorMessage('New end time must be strictly later than your current reservation end time.')
      return
    }

    if (!reason.trim()) {
      setErrorMessage('A documented justification is required for extending resource custody.')
      return
    }

    setSubmitting(true)

    try {
      const newEndIso = new Date(newEndTime).toISOString()

      const { data, error } = await supabase.rpc('request_booking_extension', {
        p_booking_id: booking.id,
        p_new_end_time: newEndIso,
        p_reason: reason.trim(),
      })

      setSubmitting(false)

      if (error) {
        setErrorMessage(error.message)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = data as any
        if (res && res.has_conflict) {
          // Extension recorded with conflict flag
          onSuccess()
        } else {
          onSuccess()
        }
      }
    } catch (err: unknown) {
      setSubmitting(false)
      const errObj = err as Error
      setErrorMessage(errObj.message || 'Unexpected error requesting extension.')
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
        <div className="bg-indigo-950 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-300" aria-hidden="true" />
            <h2 id={titleId} className="text-base font-bold text-white">
              Request Booking Extension
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleRequest} className="p-6 space-y-4">
          {errorMessage && (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 flex items-start gap-2"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1.5">
            <p className="font-semibold text-slate-900">{resourceTitle}</p>
            <div className="flex items-center justify-between text-slate-500">
              <span>Current Scheduled End:</span>
              <span className="font-semibold text-slate-800">
                {new Date(booking.end_time).toLocaleString()}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="new-end-time" className="block text-xs font-semibold text-slate-900 mb-1">
              Requested New End Date &amp; Time <span className="text-rose-500">*</span>
            </label>
            <input
              id="new-end-time"
              type="datetime-local"
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
              required
            />
            {isInvalidEndTime && (
              <p className="text-[11px] text-rose-600 mt-1">
                The new end time must be after {new Date(booking.end_time).toLocaleTimeString()}.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="extension-reason" className="block text-xs font-semibold text-slate-900 mb-1">
              Justification for Extension <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="extension-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the academic need (e.g., experiment recalibration, rendering taking longer than expected)..."
              className="w-full text-xs rounded-lg border border-slate-300 p-3 text-slate-900 focus:outline-indigo-600"
              required
            />
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-[11px] text-indigo-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>Schedule Overlap Protection:</strong> The resource owner will review your extension. If another reservation overlaps, approval will be blocked to protect scheduled users.
            </div>
          </div>

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
              disabled={submitting || isInvalidEndTime || !reason.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Submitting...</span>
                </>
              ) : (
                <span>Submit Extension Request</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

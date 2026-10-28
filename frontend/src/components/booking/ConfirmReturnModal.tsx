import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import {
  CheckCheck,
  X,
  AlertTriangle,
  Loader2,
  FileCheck2,
  ShieldAlert,
} from 'lucide-react'

interface ConfirmReturnModalProps {
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

export const ConfirmReturnModal: React.FC<ConfirmReturnModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const initialCondition = booking.initial_condition_code || 'unrecorded'
  const returnCondition = booking.return_condition_code || 'good'

  const [notes, setNotes] = useState('')
  const [discrepancyReported, setDiscrepancyReported] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSubmitting(true)

    try {
      const { data, error } = await supabase.rpc('confirm_return', {
        p_booking_id: booking.id,
        p_confirmation_notes: notes.trim() || null,
        p_discrepancy_reported: discrepancyReported,
      })

      if (error) throw error

      const res = data as { success?: boolean; message?: string }
      if (res && res.success === false) {
        throw new Error(res.message || 'Return confirmation failed.')
      }

      onSuccess()
    } catch (err: unknown) {
      const e = err as Error
      setErrorMsg(e.message || 'Failed to confirm return.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-return-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-inner">
              <CheckCheck className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="confirm-return-modal-title" className="text-lg font-bold text-slate-900">
                Confirm Return &amp; Release Custody
              </h2>
              <p className="text-xs text-slate-500">
                Booking #{booking.id.slice(0, 8)} • Resource Custodian Review
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleConfirm} className="p-6 space-y-5 overflow-y-auto flex-1">
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="font-medium">{errorMsg}</div>
            </div>
          )}

          {/* Condition Comparison Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Start Condition
              </span>
              <span className="font-bold text-slate-900 text-sm capitalize">
                {initialCondition.replace('_', ' ')}
              </span>
              {booking.initial_condition_notes && (
                <p className="text-[11px] text-slate-600 italic mt-1 line-clamp-2">
                  "{booking.initial_condition_notes}"
                </p>
              )}
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Borrower Return Report
              </span>
              <span className="font-bold text-slate-900 text-sm capitalize">
                {returnCondition.replace('_', ' ')}
              </span>
              {booking.return_condition_notes && (
                <p className="text-[11px] text-slate-600 italic mt-1 line-clamp-2">
                  "{booking.return_condition_notes}"
                </p>
              )}
            </div>
          </div>

          {/* Borrower Information */}
          <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs flex items-center justify-between text-indigo-950">
            <div>
              <span className="text-[10px] uppercase font-bold text-indigo-700 block">Borrower</span>
              <span className="font-semibold text-slate-900">
                {booking.profiles?.display_name || 'Campus Member'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-indigo-700 block">Affiliation</span>
              <span className="font-medium text-slate-700 capitalize">
                {booking.profiles?.campus_affiliation_status || 'Student'}
              </span>
            </div>
          </div>

          {/* Custodian Confirmation Notes */}
          <div className="space-y-1.5">
            <label htmlFor="confirm-notes" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Custodian Inspection &amp; Storage Notes
            </label>
            <textarea
              id="confirm-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Verified complete, stored in Cabinet B-4..."
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 resize-none"
            />
          </div>

          {/* Condition Discrepancy Flag */}
          <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2">
            <label className="flex items-start gap-2.5 text-xs text-amber-950 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={discrepancyReported}
                onChange={(e) => setDiscrepancyReported(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded text-amber-600 border-amber-300 focus:ring-amber-500"
              />
              <div className="space-y-0.5">
                <span className="flex items-center gap-1.5 text-amber-900 font-bold">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                  <span>Report Condition Discrepancy</span>
                </span>
                <span className="text-[11px] text-amber-800 block font-normal leading-relaxed">
                  Check this if the item has unacknowledged damage, missing cables, or condition differing from the borrower's report. Automatically opens an incident record.
                </span>
              </div>
            </label>
          </div>

          <p className="text-[11px] text-slate-500 italic leading-relaxed">
            Confirming return marks the booking as <span className="font-semibold text-emerald-700">Returned</span> and immediately releases the resource so it becomes discoverable as available for other campus reservations.
          </p>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Confirming...</span>
                </>
              ) : (
                <>
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Confirm Hand-Back &amp; Release</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

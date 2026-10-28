import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import type { ConditionCode } from '../../types/database'
import {
  RotateCcw,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ClipboardList,
  ShieldAlert,
} from 'lucide-react'

interface SubmitReturnModalProps {
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

const DEFAULT_RETURN_CHECKLIST = [
  { id: 'cleaned_sanitized', label: 'Surfaces/lenses cleaned and sanitized' },
  { id: 'all_parts_returned', label: 'All cables, adapters and components returned' },
  { id: 'personal_data_cleared', label: 'Personal data/test projects cleared' },
  { id: 'returned_to_dock', label: 'Placed in original charging cradle or case' },
]

export const SubmitReturnModal: React.FC<SubmitReturnModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const initialCondition = booking.initial_condition_code || 'good'
  const [returnCondition, setReturnCondition] = useState<ConditionCode>('good')
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    DEFAULT_RETURN_CHECKLIST.forEach((item) => {
      initial[item.id] = true
    })
    return initial
  })
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const toggleChecklist = (id: string) => {
    setChecklist((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Determine if condition worsened compared to start
  const isWorsened =
    (returnCondition === 'damaged' || returnCondition === 'missing_parts') ||
    (returnCondition === 'fair' && initialCondition === 'good')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSubmitting(true)

    try {
      const { data, error } = await supabase.rpc('submit_return', {
        p_booking_id: booking.id,
        p_condition_code: returnCondition,
        p_checklist: checklist,
        p_notes: notes.trim() || null,
      })

      if (error) throw error

      const res = data as { success?: boolean; message?: string }
      if (res && res.success === false) {
        throw new Error(res.message || 'Failed to submit return.')
      }

      onSuccess()
    } catch (err: unknown) {
      const e = err as Error
      setErrorMsg(e.message || 'Failed to submit return condition.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-inner">
              <RotateCcw className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="return-modal-title" className="text-lg font-bold text-slate-900">
                Submit Return Condition
              </h2>
              <p className="text-xs text-slate-500">
                Resource #{booking.id.slice(0, 8)} • Awaiting Custodian Release
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
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="font-medium">{errorMsg}</div>
            </div>
          )}

          {/* Baseline Condition Reference */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-500 block text-[11px] font-semibold uppercase tracking-wider">
                Baseline Checked-Out Condition
              </span>
              <span className="font-bold text-slate-900 text-sm capitalize">
                {initialCondition.replace('_', ' ')}
              </span>
            </div>
            <div className="text-right text-slate-500">
              <span className="block text-[11px]">Checked out on</span>
              <span className="font-mono text-slate-800">
                {booking.actual_start_at
                  ? new Date(booking.actual_start_at).toLocaleDateString()
                  : new Date(booking.start_time).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Return Condition Code Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Final Physical Return Condition <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { code: 'good', label: 'Good', desc: 'Clean & undamaged' },
                  { code: 'fair', label: 'Fair', desc: 'Minor cosmetic wear' },
                  { code: 'damaged', label: 'Damaged', desc: 'Functional issue' },
                  { code: 'missing_parts', label: 'Missing Parts', desc: 'Cable/part missing' },
                ] as const
              ).map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setReturnCondition(item.code)}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    returnCondition === item.code
                      ? 'border-indigo-600 bg-indigo-50/80 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                    <span>{item.label}</span>
                    {returnCondition === item.code && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Worsened Condition Alert */}
          {isWorsened && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Condition Change Recorded</p>
                <p className="text-[11px] text-amber-900 mt-0.5 leading-relaxed">
                  The returned condition ({returnCondition}) shows degradation from checkout ({initialCondition}). An incident will be automatically logged for coordinator review. No automated bans or penalties are applied.
                </p>
              </div>
            </div>
          )}

          {/* Return Verification Checklist */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-indigo-600" />
              <span>Return Checklist</span>
            </label>
            <div className="space-y-2 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-200">
              {DEFAULT_RETURN_CHECKLIST.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checklist[item.id])}
                    onChange={() => toggleChecklist(item.id)}
                    className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Return Condition Notes */}
          <div className="space-y-1.5">
            <label htmlFor="return-notes" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Condition &amp; Cleanliness Notes
            </label>
            <textarea
              id="return-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Lens cleaned with microfiber cloth, battery recharged to 100%..."
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
            />
          </div>

          <p className="text-[11px] text-slate-500 italic leading-relaxed">
            Upon submitting this report, custody status moves to <span className="font-semibold text-slate-700">Return Pending</span>. Physical release will be finalized once the resource custodian verifies the equipment.
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
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting Return...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Submit Return Report</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

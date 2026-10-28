import React, { useState, useEffect, useId } from 'react'
import { supabase } from '../../lib/supabase'
import type { ExtensionRequestWithDetails } from '../../types/booking'
import {
  X,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldAlert,
} from 'lucide-react'

interface DecideExtensionModalProps {
  extension: ExtensionRequestWithDetails
  onClose: () => void
  onSuccess: () => void
}

export const DecideExtensionModal: React.FC<DecideExtensionModalProps> = ({
  extension,
  onClose,
  onSuccess,
}) => {
  const titleId = useId()
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved')
  const [decisionReason, setDecisionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (decision === 'rejected' && !decisionReason.trim()) {
      setErrorMessage('Rejection of an extension requires a documented reason.')
      return
    }

    setSubmitting(true)

    try {
      const { error } = await supabase.rpc('decide_booking_extension', {
        p_extension_request_id: extension.id,
        p_decision: decision,
        p_decision_reason: decisionReason.trim() || null,
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
      setErrorMessage(errObj.message || 'Unexpected error deciding extension.')
    }
  }

  const resourceTitle = extension.bookings?.resources?.title || 'Resource'
  const requesterName = extension.bookings?.profiles?.display_name || 'Borrower'

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
              Decide Extension Request
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

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Conflict Alert Banner */}
          {errorMessage && (
            <div
              className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-950 flex items-start gap-2.5"
              role="alert"
            >
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold text-rose-900">Extension Decision Conflict</p>
                <p className="mt-0.5 text-rose-800 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Extension Request Summary */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-700 space-y-2">
            <div>
              <span className="font-semibold text-slate-900 text-sm">{resourceTitle}</span>
              <p className="text-slate-500">Requested by: <strong className="text-slate-800">{requesterName}</strong></p>
            </div>

            <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-400 block font-medium">Current End Time</span>
                <span className="text-slate-900 font-medium">
                  {extension.bookings?.end_time
                    ? new Date(extension.bookings.end_time).toLocaleString()
                    : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Requested New End</span>
                <span className="text-indigo-700 font-bold">
                  {new Date(extension.new_end_time).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/60">
              <span className="text-slate-400 block font-medium">Borrower's Stated Reason</span>
              <p className="text-slate-800 italic mt-0.5">"{extension.reason}"</p>
            </div>
          </div>

          {/* Decision Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-2">
              Owner Decision
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDecision('approved')}
                className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                  decision === 'approved'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <div className="text-left">
                  <div className="font-bold">Approve Extension</div>
                  <div className="text-[11px] font-normal text-slate-500">Grant additional time</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDecision('rejected')}
                className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                  decision === 'rejected'
                    ? 'border-rose-600 bg-rose-50 text-rose-900 shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <XCircle className="w-4 h-4 text-rose-600" aria-hidden="true" />
                <div className="text-left">
                  <div className="font-bold">Decline Extension</div>
                  <div className="text-[11px] font-normal text-slate-500">Retain original due time</div>
                </div>
              </button>
            </div>
          </div>

          {/* Decision Reason Textarea */}
          <div>
            <label htmlFor="ext-decision-reason" className="block text-xs font-semibold text-slate-900 mb-1">
              Decision Reason {decision === 'rejected' && <span className="text-rose-500">*</span>}
            </label>
            <textarea
              id="ext-decision-reason"
              rows={3}
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder={
                decision === 'approved'
                  ? 'Add notes for the borrower regarding return procedures...'
                  : 'Explain why extension cannot be granted (e.g. subsequent booking scheduled, facility closing)...'
              }
              className="w-full text-xs rounded-lg border border-slate-300 p-3 text-slate-900 focus:outline-indigo-600"
              required={decision === 'rejected'}
            />
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
              disabled={submitting || (decision === 'rejected' && !decisionReason.trim())}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold ${
                decision === 'approved'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
              } disabled:opacity-50`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Confirm {decision === 'approved' ? 'Approval' : 'Rejection'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

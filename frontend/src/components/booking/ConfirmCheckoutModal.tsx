import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import type { ConditionCode } from '../../types/database'
import {
  PackageCheck,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  ClipboardList,
} from 'lucide-react'

interface ConfirmCheckoutModalProps {
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

const DEFAULT_EQUIPMENT_CHECKLIST = [
  { id: 'chassis_clean', label: 'Chassis & optics clean; no structural cracks' },
  { id: 'power_cables', label: 'All power supplies & connective cables present' },
  { id: 'operational_test', label: 'Basic power-on test successful' },
  { id: 'carry_case', label: 'Protective carry case & security seal intact' },
]

const DEFAULT_SPACE_CHECKLIST = [
  { id: 'access_entry', label: 'Keycard / PIN access operational' },
  { id: 'workstation_clear', label: 'Benches and lab surfaces clear and safe' },
  { id: 'emergency_equipment', label: 'Safety shower / first-aid kit verified' },
  { id: 'utilities_on', label: 'Ventilation and power active' },
]

export const ConfirmCheckoutModal: React.FC<ConfirmCheckoutModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const isSpace = booking.resources?.type === 'space'
  const requiresSupervision = Boolean(booking.resources?.requires_supervision)

  const [conditionCode, setConditionCode] = useState<ConditionCode>('good')
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    const items = isSpace ? DEFAULT_SPACE_CHECKLIST : DEFAULT_EQUIPMENT_CHECKLIST
    items.forEach((item) => {
      initial[item.id] = true
    })
    return initial
  })
  const [notes, setNotes] = useState('')
  const [supervisorConfirmed, setSupervisorConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const toggleChecklist = (id: string) => {
    setChecklist((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (requiresSupervision && !supervisorConfirmed) {
      setErrorMsg(
        'Supervision Gate Active: You must verify that the designated lab supervisor is present and authorized collection.'
      )
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('confirm_checkout', {
        p_booking_id: booking.id,
        p_condition_code: conditionCode,
        p_checklist: checklist,
        p_notes: notes.trim() || null,
        p_supervisor_confirmation: supervisorConfirmed,
      })

      if (error) throw error

      const res = data as { success?: boolean; message?: string }
      if (res && res.success === false) {
        throw new Error(res.message || 'Checkout failed.')
      }

      onSuccess()
    } catch (err: unknown) {
      const e = err as Error
      setErrorMsg(e.message || 'Failed to complete collection handoff.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-inner">
              <PackageCheck className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="checkout-modal-title" className="text-lg font-bold text-slate-900">
                Confirm Collection &amp; Hand-Off
              </h2>
              <p className="text-xs text-slate-500">
                Initial condition report for #{booking.id.slice(0, 8)}
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
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5 animate-in slide-in-from-top-1"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="font-medium">{errorMsg}</div>
            </div>
          )}

          {/* Resource Summary Banner */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
            <div className="font-bold text-slate-900 text-sm">
              {booking.resources?.title || 'Campus Resource'}
            </div>
            <div className="text-slate-500">
              Location: {booking.resources?.location_label || 'Campus Facility'}
            </div>
            <div className="text-indigo-700 font-medium pt-1">
              Scheduled: {new Date(booking.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
              {new Date(booking.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          {/* Condition Code Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Baseline Physical Condition <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { code: 'good', label: 'Good', desc: 'No flaws, ready' },
                  { code: 'fair', label: 'Fair', desc: 'Minor cosmetic wear' },
                  { code: 'damaged', label: 'Damaged', desc: 'Pre-existing damage' },
                  { code: 'missing_parts', label: 'Missing Parts', desc: 'Items absent' },
                ] as const
              ).map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setConditionCode(item.code)}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    conditionCode === item.code
                      ? 'border-indigo-600 bg-indigo-50/80 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                    <span>{item.label}</span>
                    {conditionCode === item.code && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Hand-Off Checklist */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-indigo-600" />
              <span>Inspection Verification Checklist</span>
            </label>
            <div className="space-y-2 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-200">
              {(isSpace ? DEFAULT_SPACE_CHECKLIST : DEFAULT_EQUIPMENT_CHECKLIST).map((item) => (
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

          {/* Condition Notes */}
          <div className="space-y-1.5">
            <label htmlFor="initial-notes" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Condition Notes &amp; Observations (Optional)
            </label>
            <textarea
              id="initial-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Scuff marks on lower tripod leg, battery at 85% charge..."
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
            />
          </div>

          {/* Supervision Confirmation Gate */}
          {requiresSupervision && (
            <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>Supervision Required for Collection</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                This facility requires authorized staff or faculty supervision during physical custody.
              </p>
              <label className="flex items-start gap-2.5 pt-1 text-xs text-amber-950 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={supervisorConfirmed}
                  onChange={(e) => setSupervisorConfirmed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-amber-600 border-amber-300 focus:ring-amber-500"
                />
                <span>Supervisor is physically present and confirms equipment hand-off</span>
              </label>
            </div>
          )}

          {/* Custody Responsibility Notice */}
          <p className="text-[11px] text-slate-500 italic leading-relaxed">
            By confirming collection, physical custody begins and this item is treated as in-use across the campus until you submit its return.
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
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Recording Hand-Off...</span>
                </>
              ) : (
                <>
                  <PackageCheck className="w-3.5 h-3.5" />
                  <span>Confirm Custody &amp; Hand-Off</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

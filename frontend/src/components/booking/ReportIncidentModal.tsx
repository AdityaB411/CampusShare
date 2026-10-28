import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { BookingWithDetails } from '../../types/booking'
import type { IncidentType } from '../../types/database'
import {
  AlertTriangle,
  X,
  Loader2,
  HelpCircle,
} from 'lucide-react'

interface ReportIncidentModalProps {
  booking: BookingWithDetails
  onClose: () => void
  onSuccess: () => void
}

const INCIDENT_TYPES: { type: IncidentType; label: string; desc: string }[] = [
  { type: 'damage', label: 'Damage', desc: 'Physical damage to equipment or facility structure' },
  { type: 'delay', label: 'Delay / Overdue', desc: 'Handoff or return delayed past scheduled window' },
  { type: 'conflict', label: 'Scheduling Conflict', desc: 'Overlapping reservation, room occupied by others' },
  { type: 'custody_mismatch', label: 'Custody Mismatch', desc: 'Missing components, accessory mismatch, wrong item' },
  { type: 'other', label: 'Other Issue', desc: 'Safety concern, software error, or clean-up failure' },
]

export const ReportIncidentModal: React.FC<ReportIncidentModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const [incidentType, setIncidentType] = useState<IncidentType>('damage')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const cleanDesc = description.trim()
    if (!cleanDesc) {
      setErrorMsg('Mandatory Field: Please provide a clear description of the incident.')
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('report_incident', {
        p_resource_id: booking.resource_id,
        p_booking_id: booking.id,
        p_type: incidentType,
        p_description: cleanDesc,
      })

      if (error) throw error

      const res = data as { success?: boolean; message?: string }
      if (res && res.success === false) {
        throw new Error(res.message || 'Failed to submit incident report.')
      }

      onSuccess()
    } catch (err: unknown) {
      const e = err as Error
      setErrorMsg(e.message || 'Failed to report incident.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="incident-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-rose-50/50">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="incident-modal-title" className="text-lg font-bold text-slate-900">
                Report Custody / Equipment Incident
              </h2>
              <p className="text-xs text-slate-500">
                Regarding #{booking.id.slice(0, 8)} • {booking.resources?.title}
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

          {/* Incident Type Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Incident Classification <span className="text-rose-500">*</span>
            </label>
            <div className="space-y-2">
              {INCIDENT_TYPES.map((t) => (
                <label
                  key={t.type}
                  className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                    incidentType === t.type
                      ? 'border-rose-600 bg-rose-50/50 ring-2 ring-rose-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="incidentType"
                    value={t.type}
                    checked={incidentType === t.type}
                    onChange={() => setIncidentType(t.type)}
                    className="w-4 h-4 mt-0.5 text-rose-600 border-slate-300 focus:ring-rose-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-900 block">{t.label}</span>
                    <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                      {t.desc}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="incident-desc" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Detailed Description <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="incident-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what occurred, any physical evidence or error messages observed, and who was notified..."
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600 resize-none"
            />
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
            <HelpCircle className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              CampusShare enforces a strict no automated penalty policy. Incident reports alert the facility custodian and campus manager to review the situation fairly and document an accountable resolution.
            </p>
          </div>

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
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Filing Report...</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Submit Incident Report</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { IncidentWithDetails } from '../../types/booking'
import {
  ShieldCheck,
  X,
  AlertTriangle,
  Loader2,
  FileText,
  Search,
} from 'lucide-react'

interface ResolveIncidentModalProps {
  incident: IncidentWithDetails
  onClose: () => void
  onSuccess: () => void
}

export const ResolveIncidentModal: React.FC<ResolveIncidentModalProps> = ({
  incident,
  onClose,
  onSuccess,
}) => {
  const [status, setStatus] = useState<'investigating' | 'resolved'>('resolved')
  const [resolutionNote, setResolutionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const cleanNote = resolutionNote.trim()
    if (!cleanNote) {
      setErrorMsg('Accountability Rule: You must provide an explicit resolution note explaining the decision.')
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('resolve_incident', {
        p_incident_id: incident.id,
        p_status: status,
        p_resolution_note: cleanNote,
      })

      if (error) throw error

      const res = data as { success?: boolean; message?: string }
      if (res && res.success === false) {
        throw new Error(res.message || 'Failed to update incident.')
      }

      onSuccess()
    } catch (err: unknown) {
      const e = err as Error
      setErrorMsg(e.message || 'Failed to record resolution.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-incident-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="resolve-incident-modal-title" className="text-lg font-bold text-slate-900">
                Review &amp; Resolve Incident
              </h2>
              <p className="text-xs text-slate-500">
                Incident #{incident.id.slice(0, 8)} • Type: <span className="capitalize font-bold text-slate-800">{incident.type}</span>
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

          {/* Incident Details Card */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-500">
              <span>Reported by {incident.profiles?.display_name || 'Campus Member'}</span>
              <span className="font-mono text-[11px]">{new Date(incident.created_at).toLocaleString()}</span>
            </div>
            <p className="text-slate-900 font-medium leading-relaxed bg-white p-3 rounded-xl border border-slate-200/60">
              "{incident.description}"
            </p>
            {incident.resources?.title && (
              <div className="text-[11px] text-slate-500">
                Resource: <span className="font-semibold text-slate-800">{incident.resources.title}</span>
              </div>
            )}
          </div>

          {/* Status Decision Picker */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Review Decision Status <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStatus('investigating')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  status === 'investigating'
                    ? 'border-amber-600 bg-amber-50/70 ring-2 ring-amber-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-amber-600" />
                  <span>Investigating</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Under technician or lab review
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStatus('resolved')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  status === 'resolved'
                    ? 'border-emerald-600 bg-emerald-50/70 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Resolved</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Issue addressed and closed
                </div>
              </button>
            </div>
          </div>

          {/* Resolution Note */}
          <div className="space-y-1.5">
            <label htmlFor="res-note" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Documented Resolution Notes <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="res-note"
              rows={3}
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Explain the findings, technician repairs completed, or steps taken with the borrower..."
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
            />
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
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Decision...</span>
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5" />
                  <span>Record Resolution</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

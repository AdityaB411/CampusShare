import React, { useState, useEffect, useId } from 'react'
import { useAuth } from '../../context/useAuth'
import { supabase } from '../../lib/supabase'
import type { ResourceWithDetails, Resource } from '../../types/booking'
import { isResourceType } from '../../types/database'
import {
  X,
  PlusCircle,
  Edit,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Boxes,
} from 'lucide-react'

interface ResourceEditorModalProps {
  resource?: ResourceWithDetails | null
  onClose: () => void
  onSuccess: (resource: Resource) => void
}

const COMMON_CATEGORIES = [
  'Media & Production',
  'Robotics & Automation',
  'Applied Electronics',
  'Mechanical Engineering',
  'Space & Studios',
  'Computer Science & AI',
  'Chemistry & Materials',
  'Bioengineering & Health',
]

export const ResourceEditorModal: React.FC<ResourceEditorModalProps> = ({
  resource,
  onClose,
  onSuccess,
}) => {
  const { user } = useAuth()
  const titleId = useId()
  const isEditing = Boolean(resource)

  const [title, setTitle] = useState(resource?.title || '')
  const [type, setType] = useState<'equipment' | 'space'>(
    isResourceType(resource?.type) ? resource.type : 'equipment',
  )
  const [category, setCategory] = useState(resource?.category || COMMON_CATEGORIES[0])
  const [summary, setSummary] = useState(resource?.summary || '')
  const [locationLabel, setLocationLabel] = useState(resource?.location_label || '')
  const [maxDurationHours, setMaxDurationHours] = useState<number>(resource?.max_duration_hours || 4)
  const [rules, setRules] = useState(resource?.rules || '')
  const [requiredTrainingCode, setRequiredTrainingCode] = useState(resource?.required_training_code || '')
  const [requiresSupervision, setRequiresSupervision] = useState<boolean>(resource?.requires_supervision || false)
  const [state, setState] = useState<'published' | 'draft'>(
    resource?.state === 'draft' ? 'draft' : 'published'
  )

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

    if (!user) {
      setErrorMessage('You must be signed in to manage resources.')
      return
    }

    if (!title.trim() || !summary.trim() || !locationLabel.trim()) {
      setErrorMessage('Title, summary, and location are mandatory fields.')
      return
    }

    if (maxDurationHours <= 0) {
      setErrorMessage('Maximum duration hours must be at least 1 hour.')
      return
    }

    setSubmitting(true)

    try {
      const payload = {
        title: title.trim(),
        type,
        category: category.trim(),
        summary: summary.trim(),
        location_label: locationLabel.trim(),
        max_duration_hours: maxDurationHours,
        rules: rules.trim() || null,
        required_training_code: requiredTrainingCode.trim().toUpperCase() || null,
        requires_supervision: requiresSupervision,
        state,
        updated_at: new Date().toISOString(),
      }

      if (isEditing && resource) {
        // Keep field and state changes inside the guarded database RPC. Direct UPDATE
        // privileges are intentionally not granted to browser clients.
        const { data, error } = await supabase.rpc('update_resource', {
          p_resource_id: resource.id,
          p_title: payload.title,
          p_type: payload.type,
          p_category: payload.category,
          p_summary: payload.summary,
          p_location_label: payload.location_label,
          p_max_duration_hours: payload.max_duration_hours,
          p_rules: payload.rules ?? '',
          p_required_training_code: payload.required_training_code ?? '',
          p_requires_supervision: payload.requires_supervision,
          p_new_state: payload.state,
        })

        setSubmitting(false)

        if (error) {
          setErrorMessage(error.message)
        } else if (data) {
          onSuccess(data as unknown as Resource)
        }
      } else {
        const insertPayload = {
          ...payload,
          owner_id: user.id,
        }

        const { data, error } = await supabase
          .from('resources')
          .insert(insertPayload)
          .select('*')
          .single()

        setSubmitting(false)

        if (error) {
          setErrorMessage(error.message)
        } else if (data) {
          onSuccess(data as Resource)
        }
      }
    } catch (err: unknown) {
      setSubmitting(false)
      const errObj = err as Error
      setErrorMessage(errObj.message || 'Unexpected error saving resource.')
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
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isEditing ? (
              <Edit className="w-5 h-5 text-indigo-400" aria-hidden="true" />
            ) : (
              <PlusCircle className="w-5 h-5 text-indigo-400" aria-hidden="true" />
            )}
            <div>
              <h2 id={titleId} className="text-base sm:text-lg font-bold text-white">
                {isEditing ? 'Edit Campus Resource' : 'Register New Campus Resource'}
              </h2>
              <p className="text-xs text-slate-300">
                Verified Owner Portal • Published items are immediately discoverable in the catalogue.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[78vh] overflow-y-auto">
          {errorMessage && (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900 flex items-start gap-2"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-1.5">
              Resource Classification <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('equipment')}
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${
                  type === 'equipment'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Boxes className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                <div className="text-left">
                  <div>Equipment / Hardware</div>
                  <div className="text-[11px] font-normal text-slate-500">Portable gear, instruments, kits</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType('space')}
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${
                  type === 'space'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-2xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Boxes className="w-4 h-4 text-purple-600" aria-hidden="true" />
                <div className="text-left">
                  <div>Project Space / Lab</div>
                  <div className="text-[11px] font-normal text-slate-500">Studios, benches, facilities</div>
                </div>
              </button>
            </div>
          </div>

          {/* Title & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="res-title" className="block text-xs font-semibold text-slate-900 mb-1">
                Resource Title <span className="text-rose-500">*</span>
              </label>
              <input
                id="res-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sony Cinema FX3 4K Kit or Robotics Lab B-12"
                className="w-full text-xs rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
                required
              />
            </div>

            <div>
              <label htmlFor="res-category" className="block text-xs font-semibold text-slate-900 mb-1">
                Category <span className="text-rose-500">*</span>
              </label>
              <select
                id="res-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-300 px-3 py-2 text-slate-900 bg-white focus:outline-indigo-600"
              >
                {COMMON_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary */}
          <div>
            <label htmlFor="res-summary" className="block text-xs font-semibold text-slate-900 mb-1">
              Brief Description &amp; Inclusions <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="res-summary"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="State key features, included cables/accessories, or space capacity..."
              className="w-full text-xs rounded-xl border border-slate-300 p-3 text-slate-900 focus:outline-indigo-600"
              required
            />
          </div>

          {/* Location & Max Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="res-location" className="block text-xs font-semibold text-slate-900 mb-1">
                Location Label <span className="text-rose-500">*</span>
              </label>
              <input
                id="res-location"
                type="text"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                placeholder="e.g. Media Lab C-204, East Campus"
                className="w-full text-xs rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
                required
              />
            </div>

            <div>
              <label htmlFor="res-duration" className="block text-xs font-semibold text-slate-900 mb-1">
                Max Allowed Duration (Hours) <span className="text-rose-500">*</span>
              </label>
              <input
                id="res-duration"
                type="number"
                min={1}
                max={72}
                value={maxDurationHours}
                onChange={(e) => setMaxDurationHours(parseInt(e.target.value, 10) || 1)}
                className="w-full text-xs rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600"
                required
              />
            </div>
          </div>

          {/* Training Prerequisite Code */}
          <div>
            <label htmlFor="res-training" className="block text-xs font-semibold text-slate-900 mb-1">
              Required Training Prerequisite Code (Optional)
            </label>
            <input
              id="res-training"
              type="text"
              value={requiredTrainingCode}
              onChange={(e) => setRequiredTrainingCode(e.target.value)}
              placeholder="e.g. TRN-ROB-01 or leave blank for open campus access"
              className="w-full text-xs font-mono rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:outline-indigo-600 uppercase"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              If specified, borrowers must have a verified qualification with this code in their profile.
            </p>
          </div>

          {/* Supervision Requirement Checkbox */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
            <input
              id="res-supervision"
              type="checkbox"
              checked={requiresSupervision}
              onChange={(e) => setRequiresSupervision(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="res-supervision" className="text-xs text-slate-800">
              <span className="font-semibold block">Requires Supervisor Confirmation</span>
              <span className="text-[11px] text-slate-500">
                Check this if a designated lab supervisor or faculty member must sign off during check-out.
              </span>
            </label>
          </div>

          {/* Operational Rules & Return Guidelines */}
          <div>
            <label htmlFor="res-rules" className="block text-xs font-semibold text-slate-900 mb-1">
              Custody Rules &amp; Safety Guidelines
            </label>
            <textarea
              id="res-rules"
              rows={3}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Guidelines for borrowers (e.g. safety goggles mandatory, pack lenses in foam slots)..."
              className="w-full text-xs rounded-xl border border-slate-300 p-3 text-slate-900 focus:outline-indigo-600"
            />
          </div>

          {/* State: Published vs Draft */}
          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-1">
              Catalogue Publication Status
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="res-state"
                  value="published"
                  checked={state === 'published'}
                  onChange={() => setState('published')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-semibold">Published</span> (Visible in campus catalogue)
              </label>

              <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="res-state"
                  value="draft"
                  checked={state === 'draft'}
                  onChange={() => setState('draft')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-semibold">Draft</span> (Hidden from students)
              </label>
            </div>
          </div>

          {/* Modal Actions */}
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
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-2xs"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isEditing ? 'Save Changes' : 'Publish to Catalogue'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

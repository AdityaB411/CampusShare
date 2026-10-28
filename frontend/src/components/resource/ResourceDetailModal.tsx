import React, { useEffect, useId } from 'react'
import { useAuth } from '../../context/useAuth'
import type { ResourceWithDetails } from '../../types/booking'
import {
  X,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  UserCheck,
  CheckCircle2,
  CalendarDays,
  FileText,
  Edit,
  Archive,
} from 'lucide-react'

interface ResourceDetailModalProps {
  resource: ResourceWithDetails
  isEligible: boolean
  eligibilityReason: string | null
  userQualifications: string[]
  onClose: () => void
  onRequestBooking: () => void
  onEditResource?: () => void
  onArchiveResource?: () => void
}

export const ResourceDetailModal: React.FC<ResourceDetailModalProps> = ({
  resource,
  isEligible,
  eligibilityReason,
  userQualifications,
  onClose,
  onRequestBooking,
  onEditResource,
  onArchiveResource,
}) => {
  const { user, profile } = useAuth()
  const titleId = useId()

  const isOwner = user?.id === resource.owner_id
  const isManagerOrAdmin = profile?.primary_role === 'manager' || profile?.primary_role === 'admin'
  const canManage = isOwner || isManagerOrAdmin

  const ownerName = resource.profiles?.display_name || 'Campus Department Custodian'
  const isOwnerVerified = resource.profiles?.owner_verification_status === 'verified'
  const isAvailable = !resource.active_booking

  const hasRequiredTraining = resource.required_training_code
    ? userQualifications.includes(resource.required_training_code)
    : true

  const isAffiliated = profile?.campus_affiliation_status === 'verified'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-5 flex items-start justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                {resource.type === 'equipment' ? 'Equipment' : 'Project Space'}
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-white/10 text-slate-200">
                {resource.category}
              </span>
              {resource.state !== 'published' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-400/30 text-amber-200 border border-amber-400/40">
                  {resource.state.toUpperCase()}
                </span>
              )}
            </div>
            <h2 id={titleId} className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {resource.title}
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-300 mt-1">
              <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
              <span>{resource.location_label}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close resource details"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* Summary / Description */}
          <div className="text-sm text-slate-700 leading-relaxed">
            {resource.summary}
          </div>

          {/* Custodian & Real-time Availability Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Custodian Info */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Resource Custodian
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">{ownerName}</span>
                {isOwnerVerified ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                    <UserCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                    Verified Owner
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                    Faculty Custodian
                  </span>
                )}
              </div>
            </div>

            {/* Availability Info */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Current Availability
              </span>
              {isAvailable ? (
                <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" aria-hidden="true"></span>
                  <span>Available for immediate booking</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-amber-800 font-semibold text-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
                  <span>In Use (Reserved until {new Date(resource.active_booking!.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>
                </div>
              )}
            </div>
          </div>

          {/* Pre-Booking Qualification & Eligibility Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                Borrower Eligibility &amp; Qualification Gate
              </span>
              {isEligible ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                  Pre-Flight Qualified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />
                  Requirements Pending
                </span>
              )}
            </div>

            <div className="space-y-2 text-xs">
              {/* Gate 1: Campus Affiliation */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">1. Campus Affiliation:</span>
                {isAffiliated ? (
                  <span className="font-semibold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Verified Member
                  </span>
                ) : (
                  <span className="font-semibold text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                    Unverified (Pending staff review)
                  </span>
                )}
              </div>

              {/* Gate 2: Training Certification */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">
                  2. Prerequisite Certification:
                  {resource.required_training_code && (
                    <span className="font-mono font-bold text-indigo-700 ml-1">
                      ({resource.required_training_code})
                    </span>
                  )}
                </span>
                {!resource.required_training_code ? (
                  <span className="text-slate-500 font-medium">None required (Open Access)</span>
                ) : hasRequiredTraining ? (
                  <span className="font-semibold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Verified Active
                  </span>
                ) : (
                  <span className="font-semibold text-rose-700 flex items-center gap-1">
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                    Missing in profile
                  </span>
                )}
              </div>

              {/* Gate 3: Supervision */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">3. Supervision Mandate:</span>
                {resource.requires_supervision ? (
                  <span className="font-semibold text-amber-800 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                    Requires Lab Supervisor Assignment
                  </span>
                ) : (
                  <span className="font-medium text-slate-700">Self-guided access permitted</span>
                )}
              </div>

              {/* Gate 4: Maximum Duration */}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">4. Reservation Cap:</span>
                <span className="font-semibold text-slate-900">
                  Max {resource.max_duration_hours} hours per request
                </span>
              </div>
            </div>

            {/* Verdict Explanation */}
            {!isEligible && (
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950 space-y-0.5">
                <p className="font-semibold">Pre-Booking Note:</p>
                <p className="text-amber-800 leading-relaxed">
                  {eligibilityReason || 'Missing prerequisite qualification'}.
                  You may still submit a reservation request; it will route into <em>pending_verification</em> for manager review before the owner is requested for approval.
                </p>
              </div>
            )}
          </div>

          {/* Usage Rules & Guidelines */}
          {resource.rules && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                Custody &amp; Operational Rules
              </span>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                {resource.rules}
              </p>
            </div>
          )}

          {/* Action Toolbar */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            {/* Owner Management Buttons */}
            {canManage && (
              <div className="flex items-center gap-2">
                {onEditResource && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onEditResource()
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Edit Resource</span>
                  </button>
                )}
                {onArchiveResource && resource.state === 'published' && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onArchiveResource()
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Archive</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onRequestBooking()
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-2xs"
              >
                <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Request Booking</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

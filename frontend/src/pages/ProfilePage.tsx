import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import {
  UserCheck,
  Shield,
  Award,
  KeyRound,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  Building,
} from 'lucide-react'

type Qualification = Database['public']['Tables']['profile_qualifications']['Row']

export const ProfilePage: React.FC = () => {
  const { user, profile, signOut, requestOwnerAccess, requestAffiliation, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [qualifications, setQualifications] = useState<Qualification[]>([])
  const [newTrainingCode, setNewTrainingCode] = useState('')
  const [qualSubmitting, setQualSubmitting] = useState(false)
  const [qualRefreshKey, setQualRefreshKey] = useState(0)

  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [requestLoading, setRequestLoading] = useState(false)

  useEffect(() => {
    let ignore = false

    async function fetchQualifications() {
      if (!user) return
      const { data, error } = await supabase
        .from('profile_qualifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (!ignore && !error && data) {
        setQualifications(data as Qualification[])
      }
    }

    void fetchQualifications()
    return () => {
      ignore = true
    }
  }, [user, qualRefreshKey])

  const handleRequestOwner = async () => {
    setRequestLoading(true)
    setActionMsg(null)
    const res = await requestOwnerAccess()
    setRequestLoading(false)

    if (res.success) {
      setActionMsg({ type: 'success', text: res.message || 'Owner access requested. Awaiting manager approval.' })
    } else {
      setActionMsg({ type: 'error', text: res.error || 'Failed to request owner access.' })
    }
  }

  const handleRequestAffiliation = async () => {
    setRequestLoading(true)
    setActionMsg(null)
    const res = await requestAffiliation()
    setRequestLoading(false)

    if (res.success) {
      setActionMsg({ type: 'success', text: res.message || 'Affiliation verification requested.' })
    } else {
      setActionMsg({ type: 'error', text: res.error || 'Failed to request affiliation.' })
    }
  }

  const handleAddQualification = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !newTrainingCode.trim()) return

    setQualSubmitting(true)
    setActionMsg(null)

    const code = newTrainingCode.trim().toUpperCase()
    const { error } = await supabase.from('profile_qualifications').insert({
      user_id: user.id,
      training_code: code,
      status: 'pending',
    })

    setQualSubmitting(false)

    if (error) {
      setActionMsg({ type: 'error', text: error.message })
    } else {
      setNewTrainingCode('')
      setActionMsg({
        type: 'success',
        text: `Training certification "${code}" submitted for manager verification.`,
      })
      setQualRefreshKey((k) => k + 1)
      await refreshProfile()
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/resources', { replace: true })
  }

  const role = profile?.primary_role || 'borrower'
  const affiliation = profile?.campus_affiliation_status || 'unverified'
  const ownerStatus = profile?.owner_verification_status || 'unverified'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-bold shadow-xs">
            {profile?.display_name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{profile?.display_name || 'Campus User'}</h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{user?.email}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors"
        >
          <LogOut className="w-4 h-4 text-rose-600" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* Action feedback banner */}
      {actionMsg && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs flex items-start gap-2.5 ${
            actionMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Role & Verification Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Role */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Primary Role</span>
            <Shield className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          </div>
          <div className="text-lg font-bold capitalize text-slate-900">{role}</div>
          <p className="text-xs text-slate-500">
            {role === 'admin'
              ? 'System Administrator'
              : role === 'manager'
              ? 'Campus Operations Manager'
              : role === 'owner'
              ? 'Verified Equipment/Space Custodian'
              : 'Student / Borrower'}
          </p>
        </div>

        {/* Card 2: Affiliation Status */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Campus Affiliation</span>
            <Building className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          </div>
          <div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                affiliation === 'verified'
                  ? 'bg-emerald-100 text-emerald-800'
                  : affiliation === 'pending'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  affiliation === 'verified'
                    ? 'bg-emerald-500'
                    : affiliation === 'pending'
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
                }`}
                aria-hidden="true"
              />
              {affiliation}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {affiliation === 'verified'
              ? 'Verified college student/faculty member.'
              : 'Required before booking requests can be approved.'}
          </p>
          {affiliation !== 'verified' && (
            <button
              type="button"
              disabled={requestLoading || affiliation === 'pending'}
              onClick={handleRequestAffiliation}
              className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              {affiliation === 'pending' ? 'Verification Pending...' : 'Request Affiliation Verification →'}
            </button>
          )}
        </div>

        {/* Card 3: Owner Verification */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Owner Authority</span>
            <KeyRound className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          </div>
          <div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                ownerStatus === 'verified'
                  ? 'bg-emerald-100 text-emerald-800'
                  : ownerStatus === 'pending'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  ownerStatus === 'verified'
                    ? 'bg-emerald-500'
                    : ownerStatus === 'pending'
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
                }`}
                aria-hidden="true"
              />
              {ownerStatus}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {ownerStatus === 'verified'
              ? 'Authorized to list resources and review queues.'
              : 'Required to publish resources on campus.'}
          </p>
          {ownerStatus !== 'verified' && (
            <button
              type="button"
              disabled={requestLoading || ownerStatus === 'pending'}
              onClick={handleRequestOwner}
              className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              {ownerStatus === 'pending' ? 'Owner Request Pending...' : 'Request Resource Owner Access →'}
            </button>
          )}
        </div>
      </div>

      {/* Security Rule Note */}
      <div className="p-4 rounded-xl bg-slate-100/70 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
        <UserCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <span className="font-semibold text-slate-900">Security Architecture Notice:</span> Users may request owner access or affiliation verification, but cannot self-assign roles or verify themselves. All role elevations and verification decisions are verified server-side by campus management in Supabase.
        </div>
      </div>

      {/* Qualifications Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-indigo-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">Training Qualifications &amp; Certifications</h2>
          </div>
          <span className="text-xs text-slate-500">Prerequisites for specialized tools and labs</span>
        </div>

        {/* Existing Qualifications Table */}
        {qualifications.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No training certifications on file yet. Submit a code below to request manager verification.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-medium">
                  <th className="py-2.5 px-3">Training Code</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Expires At</th>
                  <th className="py-2.5 px-3">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qualifications.map((q) => (
                  <tr key={q.id}>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{q.training_code}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                          q.status === 'verified'
                            ? 'bg-emerald-100 text-emerald-800'
                            : q.status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">
                      {q.expires_at ? new Date(q.expires_at).toLocaleDateString() : 'No expiry'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{q.verified_at ? new Date(q.verified_at).toLocaleDateString() : 'Awaiting review'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Form to submit qualification */}
        <form onSubmit={handleAddQualification} className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            value={newTrainingCode}
            onChange={(e) => setNewTrainingCode(e.target.value)}
            placeholder="e.g., TRN-MED-01 or TRN-ROB-01"
            className="flex-1 px-3.5 py-2 text-xs uppercase font-mono rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={qualSubmitting}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Submit for Verification</span>
          </button>
        </form>
      </div>
    </div>
  )
}

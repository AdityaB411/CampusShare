import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import type { Database, UserRole, VerificationStatus } from '../types/database'
import {
  Shield,
  Users,
  Award,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Scale,
  RefreshCw,
  Check,
  ShieldCheck,
  Layers,
  Plus,
  ShieldAlert,
  FileText,
} from 'lucide-react'
import { ResolveIncidentModal } from '../components/booking/ResolveIncidentModal'
import type { IncidentWithDetails } from '../types/booking'

type ProfileRow = Database['public']['Tables']['profiles']['Row']
type QualificationRow = Database['public']['Tables']['profile_qualifications']['Row']
type ProjectGroupRow = Database['public']['Tables']['project_groups']['Row']
type GroupMemberRow = Database['public']['Tables']['group_members']['Row']
type GroupMemberWithUser = GroupMemberRow & {
  profiles?: { display_name: string; campus_affiliation_status: string } | null
  project_groups?: { name: string } | null
}

export const AdminPage: React.FC = () => {
  const { profile } = useAuth()
  const currentRole = profile?.primary_role || 'borrower'
  const isAdmin = currentRole === 'admin'

  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [qualifications, setQualifications] = useState<QualificationRow[]>([])
  const [projectGroups, setProjectGroups] = useState<ProjectGroupRow[]>([])
  const [groupMembers, setGroupMembers] = useState<GroupMemberWithUser[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [incidents, setIncidents] = useState<IncidentWithDetails[]>([])
  const [incidentFilter, setIncidentFilter] = useState<'all' | 'needs_action' | 'resolved'>('needs_action')
  const [activeIncidentToResolve, setActiveIncidentToResolve] = useState<IncidentWithDetails | null>(null)

  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let ignore = false

    async function fetchData() {
      // Load profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (ignore) return

      if (profilesError) {
        setFeedback({ type: 'error', text: `Failed to load profiles: ${profilesError.message}` })
      } else if (profilesData) {
        setProfiles(profilesData as ProfileRow[])
      }

      // Load qualifications
      const { data: qualData } = await supabase
        .from('profile_qualifications')
        .select('*')
        .order('created_at', { ascending: false })

      if (ignore) return

      if (qualData) {
        setQualifications(qualData as QualificationRow[])
      }

      // Load project groups
      const { data: groupData } = await supabase
        .from('project_groups')
        .select('*')
        .order('created_at', { ascending: false })

      if (ignore) return

      if (groupData) {
        setProjectGroups(groupData as ProjectGroupRow[])
      }

      // Load group members
      const { data: memberData } = await supabase
        .from('group_members')
        .select('*, profiles:user_id(display_name, campus_affiliation_status), project_groups:group_id(name)')
        .order('created_at', { ascending: false })

      if (ignore) return

      if (memberData) {
        setGroupMembers(memberData as unknown as GroupMemberWithUser[])
      }

      // Load campus-wide incidents
      const { data: incidentData } = await supabase
        .from('incidents')
        .select('*, resources(title, location_label), profiles:reporter_id(display_name, primary_role)')
        .order('created_at', { ascending: false })

      if (ignore) return

      if (incidentData) {
        setIncidents(incidentData as unknown as IncidentWithDetails[])
      }

      setLoading(false)
    }

    void fetchData()
    return () => {
      ignore = true
    }
  }, [refreshKey])

  const triggerRefresh = () => {
    setLoading(true)
    setFeedback(null)
    setRefreshKey((k) => k + 1)
  }

  // Manager action: verify affiliation
  const handleVerifyAffiliation = async (userId: string, newStatus: VerificationStatus) => {
    setProcessingId(userId)
    setFeedback(null)

    const { error } = await supabase.rpc('verify_user_status', {
      p_target_user_id: userId,
      p_affiliation_status: newStatus,
    })

    setProcessingId(null)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setFeedback({ type: 'success', text: `User affiliation updated to ${newStatus}.` })
      triggerRefresh()
    }
  }

  // Manager action: verify owner authority
  const handleVerifyOwner = async (userId: string, newStatus: VerificationStatus) => {
    setProcessingId(userId)
    setFeedback(null)

    const { error } = await supabase.rpc('verify_user_status', {
      p_target_user_id: userId,
      p_owner_status: newStatus,
    })

    setProcessingId(null)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setFeedback({
        type: 'success',
        text: `User owner verification status updated to ${newStatus}. Role updated accordingly.`,
      })
      triggerRefresh()
    }
  }

  // Admin-only action: assign role
  const handleAssignRole = async (userId: string, newRole: UserRole) => {
    setProcessingId(userId)
    setFeedback(null)

    const { error } = await supabase.rpc('assign_user_role', {
      p_target_user_id: userId,
      p_new_role: newRole,
    })

    setProcessingId(null)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setFeedback({ type: 'success', text: `Role successfully changed to ${newRole}.` })
      triggerRefresh()
    }
  }

  // Manager/Admin action: verify qualification
  const handleVerifyQualification = async (qualId: string, status: 'verified' | 'revoked') => {
    setProcessingId(qualId)
    setFeedback(null)

    const { error } = await supabase.rpc('verify_qualification', {
      p_qualification_id: qualId,
      p_status: status,
    })

    setProcessingId(null)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setFeedback({ type: 'success', text: `Qualification updated to ${status}.` })
      triggerRefresh()
    }
  }

  // Manager action: verify project group
  const handleVerifyProjectGroup = async (groupId: string, isVerified: boolean) => {
    setProcessingId(groupId)
    setFeedback(null)

    const { error } = await supabase.rpc('verify_project_group', {
      p_group_id: groupId,
      p_is_verified: isVerified,
    })

    setProcessingId(null)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setFeedback({
        type: 'success',
        text: `Project group status updated to ${isVerified ? 'Verified' : 'Unverified'}.`,
      })
      triggerRefresh()
    }
  }

  // Manager action: decide group membership
  const handleDecideMember = async (memberId: string, status: string) => {
    setProcessingId(memberId)
    setFeedback(null)

    const { error } = await supabase.rpc('decide_group_membership', {
      p_member_id: memberId,
      p_status: status,
    })

    setProcessingId(null)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setFeedback({ type: 'success', text: `Membership status updated to ${status}.` })
      triggerRefresh()
    }
  }

  // Manager action: create project group
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return

    setCreatingGroup(true)
    setFeedback(null)

    const { error } = await supabase.rpc('create_project_group', {
      p_name: newGroupName.trim(),
    })

    setCreatingGroup(false)
    if (error) {
      setFeedback({ type: 'error', text: error.message })
    } else {
      setNewGroupName('')
      setFeedback({
        type: 'success',
        text: `Project group "${newGroupName.trim()}" registered and verified.`,
      })
      triggerRefresh()
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Shield className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            Administration &amp; Operations Desk
          </h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Verify campus affiliations, approve resource owner requests, validate qualifications, and manage role assignments.
          </p>
        </div>

        <div className="mt-3 sm:mt-0 flex items-center gap-2">
          <button
            type="button"
            onClick={triggerRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs flex items-start gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Policy & Authority Banner */}
      <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-950 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <div className="font-semibold text-indigo-900">
            Current Authority Level: {isAdmin ? 'Global Administrator' : 'Campus Operations Manager'}
          </div>
          <p className="text-indigo-800">
            • <strong>Managers</strong> verify campus affiliation and resource owner requests.
            <br />
            • <strong>Admins</strong> control system-wide role assignments. Direct database elevation without admin privilege is rejected by PostgreSQL triggers.
          </p>
        </div>
      </div>

      {/* User Management Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">Campus User Roster &amp; Verification</h2>
          </div>
          <span className="text-xs text-slate-400">{profiles.length} registered users</span>
        </div>

        {profiles.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
            {loading ? 'Loading registered users from Supabase...' : 'No user profiles found in public.profiles.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-medium">
                  <th className="py-2.5 px-3">Name</th>
                  <th className="py-2.5 px-3">Current Role</th>
                  <th className="py-2.5 px-3">Affiliation</th>
                  <th className="py-2.5 px-3">Owner Status</th>
                  <th className="py-2.5 px-3 text-right">Verification Actions</th>
                  {isAdmin && <th className="py-2.5 px-3 text-right">Admin Role Assignment</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-semibold text-slate-900">{p.display_name}</td>
                    <td className="py-3 px-3">
                      <span className="capitalize px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {p.primary_role}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                          p.campus_affiliation_status === 'verified'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.campus_affiliation_status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.campus_affiliation_status}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                          p.owner_verification_status === 'verified'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.owner_verification_status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.owner_verification_status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right space-x-1.5">
                      {p.campus_affiliation_status !== 'verified' ? (
                        <button
                          type="button"
                          disabled={processingId === p.id}
                          onClick={() => handleVerifyAffiliation(p.id, 'verified')}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          Verify Affiliation
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={processingId === p.id}
                          onClick={() => handleVerifyAffiliation(p.id, 'unverified')}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Revoke Affiliation
                        </button>
                      )}

                      {p.owner_verification_status !== 'verified' ? (
                        <button
                          type="button"
                          disabled={processingId === p.id}
                          onClick={() => handleVerifyOwner(p.id, 'verified')}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50"
                        >
                          Authorize Owner
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={processingId === p.id}
                          onClick={() => handleVerifyOwner(p.id, 'unverified')}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Revoke Owner
                        </button>
                      )}
                    </td>

                    {isAdmin && (
                      <td className="py-3 px-3 text-right">
                        <select
                          disabled={processingId === p.id}
                          value={p.primary_role}
                          onChange={(e) => handleAssignRole(p.id, e.target.value as UserRole)}
                          className="px-2 py-1 text-[11px] font-medium rounded border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          aria-label={`Assign role for ${p.display_name}`}
                        >
                          <option value="borrower">Borrower</option>
                          <option value="owner">Owner</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Qualification Verifications Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">Training Credential Review Queue</h2>
          </div>
          <span className="text-xs text-slate-400">
            {qualifications.filter((q) => q.status === 'pending').length} pending review
          </span>
        </div>

        {qualifications.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
            No training qualifications submitted across campus.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-medium">
                  <th className="py-2 px-3">User ID</th>
                  <th className="py-2 px-3">Training Code</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Manager Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qualifications.map((q) => (
                  <tr key={q.id}>
                    <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px] truncate max-w-[140px]">
                      {q.user_id}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{q.training_code}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
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
                    <td className="py-2.5 px-3 text-right space-x-1.5">
                      {q.status !== 'verified' && (
                        <button
                          type="button"
                          disabled={processingId === q.id}
                          onClick={() => handleVerifyQualification(q.id, 'verified')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" aria-hidden="true" />
                          <span>Verify</span>
                        </button>
                      )}
                      {q.status !== 'revoked' && (
                        <button
                          type="button"
                          disabled={processingId === q.id}
                          onClick={() => handleVerifyQualification(q.id, 'revoked')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" aria-hidden="true" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Project Groups & Team Quota Authorization Desk */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">
              Project Groups &amp; Team Quota Review
            </h2>
          </div>

          {/* Quick Create Group Form */}
          <form onSubmit={handleCreateGroup} className="flex items-center gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Register new project group..."
              className="text-xs rounded-xl border border-slate-300 px-3 py-1.5 text-slate-900 focus:outline-indigo-600 w-48 sm:w-60"
            />
            <button
              type="submit"
              disabled={creatingGroup || !newGroupName.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Verified Group</span>
            </button>
          </form>
        </div>

        {/* Project Groups List */}
        <div>
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Campus Project Groups ({projectGroups.length})
          </h3>
          {projectGroups.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
              No project groups found in the database.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projectGroups.map((g) => (
                <div
                  key={g.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 flex flex-col justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs">{g.name}</span>
                      {g.is_verified ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                          <AlertCircle className="w-3 h-3 text-amber-600" aria-hidden="true" />
                          Pending Review
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Ref: #{g.id.slice(0, 8)} • Created: {new Date(g.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-end gap-1.5">
                    {!g.is_verified ? (
                      <button
                        type="button"
                        disabled={processingId === g.id}
                        onClick={() => handleVerifyProjectGroup(g.id, true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" aria-hidden="true" />
                        <span>Authorize Group</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={processingId === g.id}
                        onClick={() => handleVerifyProjectGroup(g.id, false)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" aria-hidden="true" />
                        <span>Revoke Verification</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Group Memberships Review */}
        <div className="pt-2 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Group Membership Requests &amp; Approvals ({groupMembers.length})
          </h3>
          {groupMembers.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
              No group membership records in database.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">User</th>
                    <th className="py-2.5 px-3 font-semibold">Project Group</th>
                    <th className="py-2.5 px-3 font-semibold">Affiliation</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {m.profiles?.display_name || m.user_id.slice(0, 8)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-indigo-700">
                        {m.project_groups?.name || 'Project Team'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11px] text-slate-600">
                          {m.profiles?.campus_affiliation_status || 'unverified'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            m.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5">
                        {m.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={processingId === m.id}
                            onClick={() => handleDecideMember(m.id, 'approved')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" aria-hidden="true" />
                            <span>Approve</span>
                          </button>
                        )}
                        {m.status !== 'removed' && (
                          <button
                            type="button"
                            disabled={processingId === m.id}
                            onClick={() => handleDecideMember(m.id, 'removed')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50"
                          >
                            <XCircle className="w-3 h-3" aria-hidden="true" />
                            <span>Remove</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 4: CAMPUS-WIDE INCIDENT OVERSIGHT & INVESTIGATION */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center shadow-xs">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                4. Campus-Wide Incident Oversight &amp; Investigation
              </h2>
              <p className="text-xs text-slate-500">
                Authorised review of damage reports, overdue delays, and scheduling conflicts. Human accountability required.
              </p>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setIncidentFilter('needs_action')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                incidentFilter === 'needs_action'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Needs Action ({incidents.filter((i) => i.status !== 'resolved').length})
            </button>
            <button
              type="button"
              onClick={() => setIncidentFilter('resolved')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                incidentFilter === 'resolved'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Resolved ({incidents.filter((i) => i.status === 'resolved').length})
            </button>
            <button
              type="button"
              onClick={() => setIncidentFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                incidentFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              All ({incidents.length})
            </button>
          </div>
        </div>

        <div className="p-5">
          {(() => {
            const displayList = incidents.filter((inc) => {
              if (incidentFilter === 'needs_action') return inc.status !== 'resolved'
              if (incidentFilter === 'resolved') return inc.status === 'resolved'
              return true
            })

            if (displayList.length === 0) {
              return (
                <div className="text-center py-10 px-4">
                  <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                  </div>
                  <div className="text-xs font-semibold text-slate-800">
                    {incidentFilter === 'needs_action'
                      ? 'No open incidents require manager or admin intervention.'
                      : 'No incidents found in this category.'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Campus resources and facilities are operating without active disruption reports.
                  </div>
                </div>
              )
            }

            return (
              <div className="space-y-3">
                {displayList.map((inc) => {
                  const isActionRequired = inc.status !== 'resolved'
                  return (
                    <article
                      key={inc.id}
                      className={`p-4 rounded-xl border transition-all text-xs space-y-3 ${
                        isActionRequired
                          ? 'border-amber-200 bg-amber-50/20'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold capitalize ${
                              inc.type === 'damage'
                                ? 'bg-rose-100 text-rose-800'
                                : inc.type === 'delay'
                                ? 'bg-amber-100 text-amber-800'
                                : inc.type === 'conflict'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {inc.type.replace('_', ' ')}
                          </span>

                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                              inc.status === 'resolved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inc.status === 'investigating'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {inc.status}
                          </span>

                          <span className="font-semibold text-slate-900">
                            {inc.resources?.title || 'Campus Resource'}
                          </span>

                          {inc.resources?.location_label && (
                            <span className="text-slate-500">
                              ({inc.resources.location_label})
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-400">
                          {new Date(inc.created_at).toLocaleString()}
                        </div>
                      </div>

                      {/* Description */}
                      <div className="bg-white p-3 rounded-lg border border-slate-200/70 text-slate-800 leading-relaxed">
                        <span className="font-semibold text-slate-700">Reporter Description:</span> "{inc.description}"
                        <div className="mt-1 text-[11px] text-slate-500">
                          Reported by {inc.profiles?.display_name || 'Campus Member'} ({inc.profiles?.primary_role || 'user'})
                        </div>
                      </div>

                      {/* Resolution note if already resolved */}
                      {inc.resolution_note && (
                        <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 text-emerald-950 text-xs">
                          <div className="font-semibold text-emerald-900 flex items-center gap-1.5 mb-0.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                            <span>Documented Human Resolution:</span>
                          </div>
                          <p className="leading-relaxed">{inc.resolution_note}</p>
                          {inc.resolved_at && (
                            <div className="text-[10px] text-emerald-700 mt-1">
                              Closed on {new Date(inc.resolved_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action Button for open/investigating */}
                      {isActionRequired && (
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setActiveIncidentToResolve(inc)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-2xs"
                          >
                            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Review &amp; Resolve Incident</span>
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Demo Fair-Use Policy Reference */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
          <Scale className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          <span>Locked Demo Fair-Use Policy Rules</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
          <div className="p-3 bg-slate-50 rounded-lg">
            <strong>Individual:</strong> Max 3 approved uses / 7 days, max 2 open booking items.
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <strong>Project Group:</strong> Max 5 group uses / 7 days, max 3 open items.
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <strong>Duration:</strong> Equipment max 4 hours; spaces max 2 hours.
          </div>
        </div>
      </div>

      {/* Resolve Incident Modal */}
      {activeIncidentToResolve && (
        <ResolveIncidentModal
          incident={activeIncidentToResolve}
          onClose={() => setActiveIncidentToResolve(null)}
          onSuccess={() => {
            setActiveIncidentToResolve(null)
            triggerRefresh()
          }}
        />
      )}
    </div>
  )
}

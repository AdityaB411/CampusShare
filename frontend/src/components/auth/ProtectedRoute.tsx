import React from 'react'
import { Navigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import type { UserRole } from '../../types/database'
import { ShieldAlert, ArrowLeft, UserCircle2, Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
  children?: React.ReactNode
  allowedRoles?: UserRole[]
  requireOwnerVerified?: boolean
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  requireOwnerVerified = false,
}) => {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" aria-hidden="true" />
        <p className="text-sm text-slate-500 font-medium">Verifying credentials and permissions...</p>
      </div>
    )
  }

  // Not signed in -> redirect to Sign In
  if (!user) {
    return <Navigate to="/signin" state={{ from: location }} replace />
  }

  // If role requirement is specified
  const currentRole = profile?.primary_role || 'borrower'
  const isRoleAllowed = !allowedRoles || allowedRoles.includes(currentRole)

  // If owner verification requirement is specified
  const isOwnerVerified = profile?.owner_verification_status === 'verified'
  const isOwnerConditionMet = !requireOwnerVerified || isOwnerVerified || currentRole === 'admin' || currentRole === 'manager'

  if (!isRoleAllowed || !isOwnerConditionMet) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-5 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
          <ShieldAlert className="w-7 h-7" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">Access Restricted</h1>
          <p className="text-sm text-slate-600">
            This area requires {allowedRoles ? allowedRoles.join(' or ') : 'elevated'} authorization.
            Your current campus role is <span className="font-semibold text-slate-900">{currentRole}</span>
            {requireOwnerVerified && (
              <> (Owner Status: <span className="font-semibold text-slate-900">{profile?.owner_verification_status || 'unverified'}</span>)</>
            )}.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-left space-y-1.5">
          <div className="font-semibold text-slate-900">Campus Authorization Policy:</div>
          <p>
            • To protect institutional property, only verified equipment custodians and authorized managers can access workbench queues.
            <br />
            • You can request owner access on your Profile page. A campus manager must verify your authority before access is granted.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            to="/profile"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            <UserCircle2 className="w-4 h-4" aria-hidden="true" />
            <span>Go to Profile to Request Access</span>
          </Link>
          <Link
            to="/resources"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to Resource Catalogue</span>
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

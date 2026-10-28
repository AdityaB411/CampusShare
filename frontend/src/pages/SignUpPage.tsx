import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { UserPlus, AlertCircle, Loader2, Building, Shield, CheckCircle2 } from 'lucide-react'

export const SignUpPage: React.FC = () => {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { signUp, isConfigured } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!displayName.trim() || !email.trim() || !password) {
      setErrorMsg('Please complete all required fields.')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.')
      return
    }

    setIsSubmitting(true)
    const { error } = await signUp(email, password, displayName)
    setIsSubmitting(false)

    if (error) {
      setErrorMsg(error)
    } else {
      setSuccessMsg(
        'Account created successfully! If email confirmation is enabled on your Supabase instance, please check your inbox.'
      )
      setTimeout(() => {
        navigate('/resources', { replace: true })
      }, 1500)
    }
  }

  return (
    <div className="max-w-md mx-auto my-8 sm:my-14 px-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white mx-auto flex items-center justify-center shadow-xs">
            <Building className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create Campus Account</h1>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Register to browse, request, and share campus equipment and project spaces.
          </p>
        </div>

        {/* Security / Default Role Policy Callout */}
        <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-950 space-y-1">
          <div className="font-semibold flex items-center gap-1.5 text-indigo-900">
            <Shield className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            <span>Default Role Policy</span>
          </div>
          <p className="text-indigo-800">
            New accounts start as <strong className="font-semibold">Borrower</strong> with{' '}
            <strong className="font-semibold">Unverified</strong> status. Users cannot assign their own role.
            Campus managers verify affiliation and owner authority after registration.
          </p>
        </div>

        {!isConfigured && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold">Notice:</span> Supabase client is in placeholder configuration.
              Ensure credentials are configured in <code className="font-mono bg-white px-1 py-0.5 rounded">.env.local</code>.
            </div>
          </div>
        )}

        {/* Error alert */}
        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success alert */}
        {successMsg && (
          <div
            role="status"
            className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="signup-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Full Name
            </label>
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Aarav Sharma"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <label htmlFor="signup-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Campus Email Address
            </label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="aarav.sharma@campus.edu"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <label htmlFor="signup-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Password (min 6 characters)
            </label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Creating account...</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                <span>Sign Up as Borrower</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
          Already have an account?{' '}
          <Link to="/signin" className="font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

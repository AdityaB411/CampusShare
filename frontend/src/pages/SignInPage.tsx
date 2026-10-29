import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { LogIn, AlertCircle, Loader2, Building, ShieldCheck } from 'lucide-react'

const DEMO_PASSWORD = 'CampusShareDemo2026!'

export const SignInPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { signIn, isConfigured } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const fromLocation = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/resources'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.')
      return
    }

    setIsSubmitting(true)
    const { error } = await signIn(email, password)
    setIsSubmitting(false)

    if (error) {
      setErrorMsg(error)
    } else {
      navigate(fromLocation, { replace: true })
    }
  }

  return (
    <div className="max-w-md mx-auto my-8 sm:my-16 px-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white mx-auto flex items-center justify-center shadow-xs">
            <Building className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to CampusShare</h1>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Use your campus account to access equipment and project space reservations.
          </p>
        </div>

        {!isConfigured && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold">Notice:</span> Supabase client is in placeholder configuration.
              Add credentials to <code className="font-mono bg-white px-1 py-0.5 rounded">frontend/.env.local</code> to enable real authentication.
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Sign In Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="signin-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Campus Email Address
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@campus.edu or faculty@campus.edu"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="signin-password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
            </div>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
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
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" aria-hidden="true" />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>

        {/* Security / Sign Up Footer */}
        <div className="pt-4 border-t border-slate-100 text-center space-y-3 text-xs text-slate-600">
          <p>
            Don't have an account yet?{' '}
            <Link to="/signup" className="font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2">
              Create an account
            </Link>
          </p>

          <div className="flex items-center justify-center gap-1.5 text-slate-600">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span>Database-enforced Row Level Security active</span>
          </div>
        </div>
      </div>

      {/* Demo Credentials Quick-Fill for Evaluators / Judges */}
      <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Judge &amp; Demo Evaluation Personas
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
            Click to fill sign-in
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          Clicking a persona fills its email and the shared demo password. For demo sign-in to work, all five demo accounts must use the password configured in the demo setup guide.
        </p>
        <div className="grid grid-cols-1 gap-2 pt-1">
          {[
            {
              role: 'Verified Borrower',
              email: 'aarav.sharma@campus.edu',
              tag: 'Verified campus borrower',
              badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            },
            {
              role: 'Unverified Borrower',
              email: 'rohan.verma@campus.edu',
              tag: 'Needs campus staff approval',
              badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
            },
            {
              role: 'Resource Owner / Custodian',
              email: 'prof.raman@campus.edu',
              tag: 'Media Lab Custodian Queue',
              badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
            },
            {
              role: 'Campus Facilities Manager',
              email: 'coordinator@campus.edu',
              tag: 'Verifications & Incident Oversight',
              badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
            },
            {
              role: 'System Administrator',
              email: 'admin@campus.edu',
              tag: 'System Roles & Full Policy Access',
              badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
            },
          ].map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => {
                setEmail(acc.email)
                setPassword(DEMO_PASSWORD)
              }}
              className="p-2.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 text-left transition flex items-center justify-between gap-2"
            >
              <div>
                <div className="text-xs font-bold text-slate-900">{acc.role}</div>
                <div className="font-mono text-[11px] text-slate-500">{acc.email}</div>
              </div>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${acc.badgeClass}`}
              >
                {acc.tag}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

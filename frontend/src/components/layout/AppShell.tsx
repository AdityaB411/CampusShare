import React, { useState } from 'react'
import { NavLink, Outlet, useLocation, Link, useNavigate } from 'react-router-dom'
import {
  Boxes,
  CalendarDays,
  Inbox,
  History,
  Bell,
  Shield,
  Menu,
  X,
  Building,
  CheckCircle2,
  UserCircle2,
  LogOut,
  LogIn,
  UserPlus,
} from 'lucide-react'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useAuth } from '../../context/useAuth'
import { useNotificationEngine } from '../../context/useNotificationEngine'
import { isUserRole } from '../../types/database'
import type { UserRole } from '../../types/database'

interface NavItem {
  name: string
  to: string
  icon: React.ElementType
  minRole?: UserRole[]
  requireOwnerVerified?: boolean
  requireAuth?: boolean
}

const allNavItems: NavItem[] = [
  { name: 'Resources', to: '/resources', icon: Boxes, requireAuth: false },
  { name: 'My Bookings', to: '/my-bookings', icon: CalendarDays, requireAuth: true },
  {
    name: 'Owner Queue',
    to: '/owner-queue',
    icon: Inbox,
    requireAuth: true,
    minRole: ['owner', 'manager', 'admin'],
    requireOwnerVerified: true,
  },
  { name: 'Activity', to: '/activity', icon: History, requireAuth: true },
  { name: 'Notifications', to: '/notifications', icon: Bell, requireAuth: true },
  {
    name: 'Admin',
    to: '/admin',
    icon: Shield,
    requireAuth: true,
    minRole: ['manager', 'admin'],
  },
]

export const AppShell: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuth()
  const { unreadCount } = useNotificationEngine()

  const currentRole = isUserRole(profile?.primary_role)
    ? profile.primary_role
    : 'borrower'
  const isOwnerVerified = profile?.owner_verification_status === 'verified'

  // Filter navigation items by authenticated state and server-verified role
  const visibleNavItems = allNavItems.filter((item) => {
    if (!item.requireAuth) return true
    if (!user) return false

    if (item.minRole) {
      const roleMatches = item.minRole.includes(currentRole)
      if (item.requireOwnerVerified) {
        return roleMatches || isOwnerVerified
      }
      return roleMatches
    }

    return true
  })

  const handleSignOut = async () => {
    await signOut()
    navigate('/resources', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Accessible skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-md focus:shadow-md focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Top Application Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Brand */}
            <div className="flex items-center gap-3">
              <NavLink
                to="/resources"
                className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                aria-label="CampusShare Home"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                  <Building className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-bold text-lg leading-tight tracking-tight text-slate-900">
                    Campus<span className="text-indigo-600">Share</span>
                  </div>
                  <div className="text-xs text-slate-500 font-medium">
                    Campus Resource Desk
                  </div>
                </div>
              </NavLink>
            </div>

            {/* Desktop Role-Aware Navigation */}
            <nav
              className="hidden lg:flex items-center space-x-1"
              aria-label="Primary navigation"
            >
              {visibleNavItems.map((item) => {
                const Icon = item.icon
                const isActive =
                  location.pathname === item.to ||
                  (item.to === '/resources' && location.pathname === '/')
                return (
                  <NavLink
                    key={item.name}
                    to={item.to}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    <span>{item.name}</span>
                    {item.to === '/notifications' && unreadCount > 0 && (
                      <span
                        className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold bg-rose-600 text-white shadow-xs"
                        aria-label={`${unreadCount} unread notifications`}
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </nav>

            {/* Right Side: Auth status, Profile & Mobile Toggle */}
            <div className="flex items-center gap-3">
              <div className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>{isSupabaseConfigured ? 'Supabase Connected' : 'Single-Campus Demo Mode'}</span>
              </div>

              {user ? (
                // Signed-In User Badge & Profile Link
                <div className="hidden sm:flex items-center gap-2">
                  <Link
                    to="/profile"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-800 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500"
                    aria-label={`User profile for ${profile?.display_name || user.email}`}
                  >
                    <UserCircle2 className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                    <span className="font-semibold text-slate-900 max-w-[120px] truncate">
                      {profile?.display_name || user.email?.split('@')[0]}
                    </span>
                    <span className="capitalize px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800">
                      {currentRole}
                    </span>
                  </Link>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors focus-visible:ring-2 focus-visible:ring-rose-500"
                    title="Sign Out"
                    aria-label="Sign Out"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                // Signed-Out Actions
                <div className="hidden sm:flex items-center gap-2">
                  <Link
                    to="/signin"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sign In</span>
                  </Link>
                  <Link
                    to="/signup"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Sign Up</span>
                  </Link>
                </div>
              )}

              {/* Mobile menu button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6" aria-hidden="true" />
                ) : (
                  <Menu className="w-6 h-6" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav
            id="mobile-navigation"
            className="lg:hidden border-t border-slate-200 bg-white px-4 pt-2 pb-4 space-y-1"
            aria-label="Mobile navigation"
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon
              const isActive =
                location.pathname === item.to ||
                (item.to === '/resources' && location.pathname === '/')
              return (
                <NavLink
                  key={item.name}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-md text-base font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-slate-500" aria-hidden="true" />
                    <span>{item.name}</span>
                  </div>
                  {item.to === '/notifications' && unreadCount > 0 && (
                    <span
                      className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-bold bg-rose-600 text-white"
                      aria-label={`${unreadCount} unread notifications`}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </NavLink>
              )
            })}

            <div className="pt-3 mt-3 border-t border-slate-100">
              {user ? (
                <div className="space-y-2">
                  <div className="px-3 py-1 text-xs text-slate-500">
                    Signed in as <strong className="text-slate-900">{profile?.display_name || user.email}</strong> ({currentRole})
                  </div>
                  <NavLink
                    to="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <UserCircle2 className="w-4 h-4 text-indigo-600" aria-hidden="true" />
                    <span>Your Profile &amp; Qualifications</span>
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false)
                      handleSignOut()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <LogOut className="w-4 h-4 text-rose-600" aria-hidden="true" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 p-2">
                  <Link
                    to="/signin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex-1 text-center py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Accessible Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>
            CampusShare — Trusted platform for underused equipment and spaces.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-slate-600">Fair-Use &amp; Custody Protected</span>
            <span aria-hidden="true" className="text-slate-300">•</span>
            <span className="text-slate-600">Append-Only Trust Record</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

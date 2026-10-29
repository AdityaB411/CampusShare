import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { AppShell } from './components/layout/AppShell'
import { ProtectedRoute } from './components/auth/ProtectedRoute'

// Keep route pages in separate chunks so users download only the page they visit.
const ResourcesPage = lazy(() => import('./pages/ResourcesPage').then((module) => ({ default: module.ResourcesPage })))
const MyBookingsPage = lazy(() => import('./pages/MyBookingsPage').then((module) => ({ default: module.MyBookingsPage })))
const OwnerQueuePage = lazy(() => import('./pages/OwnerQueuePage').then((module) => ({ default: module.OwnerQueuePage })))
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((module) => ({ default: module.ActivityPage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const SignInPage = lazy(() => import('./pages/SignInPage').then((module) => ({ default: module.SignInPage })))
const SignUpPage = lazy(() => import('./pages/SignUpPage').then((module) => ({ default: module.SignUpPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-600" role="status" aria-live="polite">Loading page…</div>}>
        <Routes>
          <Route element={<AppShell />}>
            {/* Public routes */}
            <Route path="/" element={<Navigate to="/resources" replace />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />

            {/* Authenticated member routes */}
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-bookings"
              element={
                <ProtectedRoute>
                  <MyBookingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/activity"
              element={
                <ProtectedRoute>
                  <ActivityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <NotificationsPage />
                </ProtectedRoute>
              }
            />

            {/* Role-protected routes */}
            <Route
              path="/owner-queue"
              element={
                <ProtectedRoute
                  allowedRoles={['owner', 'manager', 'admin']}
                  requireOwnerVerified={true}
                >
                  <OwnerQueuePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['manager', 'admin']}>
                  <AdminPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/resources" replace />} />
          </Route>
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

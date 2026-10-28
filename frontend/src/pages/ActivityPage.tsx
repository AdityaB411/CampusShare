import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  History,
  Shield,
  Lock,
  ArrowRight,
  Clock,
  User,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  PackageCheck,
  FileText,
  ShieldCheck,
} from 'lucide-react'

interface ActivityEventRow {
  id: string
  actor_id: string | null
  actor_role_snapshot: string
  entity_type: string
  entity_id: string
  action: string
  previous_state: string | null
  new_state: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  profiles?: {
    display_name: string
    primary_role: string
  } | null
}

export const ActivityPage: React.FC = () => {
  const [events, setEvents] = useState<ActivityEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'booking' | 'incident' | 'resource' | 'profile'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let ignore = false

    async function loadActivityEvents() {
      try {
        setLoading(true)
        setErrorMsg(null)

        const { data, error } = await supabase
          .from('activity_events')
          .select('*, profiles:actor_id(display_name, primary_role)')
          .order('created_at', { ascending: false })
          .limit(100)

        if (ignore) return

        if (error) throw error

        setEvents((data || []) as unknown as ActivityEventRow[])
      } catch (err: unknown) {
        if (!ignore) {
          const e = err as Error
          setErrorMsg(e.message || 'Failed to load Trust Record activity events.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void loadActivityEvents()
    return () => {
      ignore = true
    }
  }, [refreshKey])

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (typeFilter !== 'all' && ev.entity_type !== typeFilter) return false
      if (!searchQuery.trim()) return true

      const q = searchQuery.toLowerCase()
      const actionMatch = ev.action.toLowerCase().includes(q)
      const reasonMatch = (ev.reason || '').toLowerCase().includes(q)
      const actorMatch = (ev.profiles?.display_name || '').toLowerCase().includes(q)
      const prevMatch = (ev.previous_state || '').toLowerCase().includes(q)
      const nextMatch = (ev.new_state || '').toLowerCase().includes(q)

      return actionMatch || reasonMatch || actorMatch || prevMatch || nextMatch
    })
  }, [events, typeFilter, searchQuery])

  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ')
  }

  const getActionIcon = (action: string) => {
    if (action.includes('APPROVED') || action.includes('CONFIRMED') || action.includes('RESOLVED') || action.includes('VERIFIED')) {
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />
    }
    if (action.includes('CHECKOUT')) {
      return <PackageCheck className="w-4 h-4 text-indigo-600" />
    }
    if (action.includes('RETURN_SUBMITTED')) {
      return <RotateCcw className="w-4 h-4 text-amber-600" />
    }
    if (action.includes('INCIDENT') || action.includes('REJECTED') || action.includes('CANCELLED')) {
      return <AlertTriangle className="w-4 h-4 text-rose-600" />
    }
    return <FileText className="w-4 h-4 text-indigo-600" />
  }

  return (
    <div className="space-y-6">
      {/* Page Context Header */}
      <div className="border-b border-slate-200 pb-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <History className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            Activity &amp; Trust Record
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Append-only, auditable event history. Every reservation, hand-off condition, incident resolution, and role elevation is permanently logged in PostgreSQL.
          </p>
        </div>

        <div className="mt-3 sm:mt-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh Events</span>
          </button>
        </div>
      </div>

      {/* Security Architecture Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-inner">
            <Lock className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900">
              Tamper-Resistant Audit Trail
            </div>
            <div className="text-xs text-slate-500">
              Strictly protected by PostgreSQL Row Level Security and trigger-level mutation blocks.
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800 font-bold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl self-start sm:self-auto">
          <Shield className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          Append-Only Immutable
        </span>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-semibold overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { id: 'all', label: 'All Events' },
              { id: 'booking', label: 'Bookings & Custody' },
              { id: 'incident', label: 'Incidents' },
              { id: 'resource', label: 'Resource States' },
              { id: 'profile', label: 'Roles & Verifications' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTypeFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl transition-all whitespace-nowrap ${
                typeFilter === tab.id
                  ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reason or actor..."
            className="w-full text-xs pl-8.5 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>
      </div>

      {/* Activity Timeline List */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
          Loading immutable Trust Record events...
        </div>
      ) : errorMsg ? (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {errorMsg}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
          <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="font-semibold text-slate-800 text-sm">No Events Match Filter</p>
          <p className="text-slate-400">Try adjusting your category or search term.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs divide-y divide-slate-100 overflow-hidden">
          {filteredEvents.map((ev) => {
            const date = new Date(ev.created_at)

            return (
              <div key={ev.id} className="p-4 sm:p-5 flex items-start gap-3.5 hover:bg-slate-50/70 transition-colors">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                  {getActionIcon(ev.action)}
                </div>

                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 capitalize">
                        {formatAction(ev.action)}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 uppercase font-mono">
                        {ev.entity_type}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {date.toLocaleDateString()} at {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Transition */}
                  {(ev.previous_state || ev.new_state) && (
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-600">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {ev.previous_state || 'none'}
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">
                        {ev.new_state}
                      </span>
                    </div>
                  )}

                  {/* Reason text */}
                  {ev.reason && (
                    <p className="text-xs text-slate-700 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 italic">
                      "{ev.reason}"
                    </p>
                  )}

                  {/* Actor details */}
                  <div className="pt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1 text-slate-600">
                      <User className="w-3 h-3 text-slate-400" />
                      {ev.profiles?.display_name || 'System / Service Role'}
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                      <ShieldCheck className="w-3 h-3 text-indigo-500" />
                      Role Snapshot: <strong className="capitalize">{ev.actor_role_snapshot}</strong>
                    </span>
                    {ev.entity_id && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-slate-400">
                          Ref: #{ev.entity_id.slice(0, 8)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

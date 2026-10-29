import React, { useState, useEffect, useMemo, useCallback, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type { ResourceWithDetails, Resource } from '../types/booking'
import { BookingModal } from '../components/booking/BookingModal'
import { ResourceDetailModal } from '../components/resource/ResourceDetailModal'
import { ResourceEditorModal } from '../components/resource/ResourceEditorModal'
import {
  Boxes,
  Search,
  Filter,
  ShieldCheck,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  PlusCircle,
  UserCheck,
  Edit,
  RefreshCw,
  Sparkles,
  Info,
} from 'lucide-react'

export const ResourcesPage: React.FC = () => {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const searchInputId = useId()

  const isVerifiedOwner =
    (profile?.primary_role === 'owner' ||
      profile?.primary_role === 'manager' ||
      profile?.primary_role === 'admin') &&
    profile?.owner_verification_status === 'verified'

  const [resources, setResources] = useState<ResourceWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'equipment' | 'space'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [availabilityOnly, setAvailabilityOnly] = useState(false)
  const [eligibleOnly, setEligibleOnly] = useState(false)
  const [viewTab, setViewTab] = useState<'catalogue' | 'my_resources'>('catalogue')

  // User verified qualifications list
  const [userQuals, setUserQuals] = useState<string[]>([])

  // Modals state
  const [detailResource, setDetailResource] = useState<ResourceWithDetails | null>(null)
  const [bookingResource, setBookingResource] = useState<Resource | null>(null)
  const [editorResource, setEditorResource] = useState<ResourceWithDetails | null | 'new'>(null)
  const [successBanner, setSuccessBanner] = useState<{
    bookingId: string
    status: string
    note?: string | null
  } | null>(null)

  // 1. Fetch user qualifications
  useEffect(() => {
    let ignore = false

    async function loadUserQualifications() {
      if (!user) {
        setUserQuals([])
        return
      }

      const { data } = await supabase
        .from('profile_qualifications')
        .select('training_code')
        .eq('user_id', user.id)
        .eq('status', 'verified')

      if (!ignore && data) {
        setUserQuals(data.map((q) => q.training_code))
      }
    }

    void loadUserQualifications()
    return () => {
      ignore = true
    }
  }, [user])

  // 2. Fetch resources with owner profiles and active bookings
  useEffect(() => {
    let ignore = false

    async function loadResources() {
      if (!isSupabaseConfigured) {
        setResources([])
        setErrorMessage(
          'Supabase is not configured. Copy the repository .env.example to frontend/.env.local, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the development server.'
        )
        setLoading(false)
        return
      }

      setErrorMessage(null)

      try {
        // Fetch resources with joined owner profile
        const { data: resData, error: resError } = await supabase
          .from('resources')
          .select('*, profiles:owner_id(display_name, primary_role, owner_verification_status)')
          .order('title', { ascending: true })

        if (ignore) return

        if (resError) {
          setErrorMessage(resError.message)
          setLoading(false)
          return
        }

        // Fetch active bookings in custody via security definer RPC
        const { data: rpcCustody, error: rpcError } = await supabase.rpc('get_active_resource_custody')
        if (rpcError) {
          throw new Error(`Could not verify resource custody status: ${rpcError.message}`)
        }

        if (ignore) return

        // The public RPC intentionally returns only resource ids, not booking
        // ids or due times. This is sufficient for the catalogue availability badge.
        const activeResourceIds = new Set((rpcCustody ?? []).map((item) => item.resource_id))

        // Enrich resources with active custody state
        const enriched = ((resData || []) as ResourceWithDetails[]).map((r) => ({
          ...r,
          active_booking: activeResourceIds.has(r.id) ? { resource_id: r.id } : null,
        }))

        setResources(enriched)
      } catch (err: unknown) {
        if (!ignore) {
          const e = err as Error
          setErrorMessage(e.message || 'Failed to load catalogue.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    void loadResources()
    return () => {
      ignore = true
    }
  }, [refreshKey])

  const triggerRefresh = () => {
    setLoading(true)
    setRefreshKey((k) => k + 1)
  }

  // Derive unique categories and locations for filter dropdowns
  const availableCategories = useMemo(() => {
    const set = new Set<string>()
    resources.forEach((r) => {
      if (r.category) set.add(r.category)
    })
    return Array.from(set).sort()
  }, [resources])

  const availableLocations = useMemo(() => {
    const set = new Set<string>()
    resources.forEach((r) => {
      if (r.location_label) set.add(r.location_label)
    })
    return Array.from(set).sort()
  }, [resources])

  // Pre-qualification check helper
  const isAffiliated = profile?.campus_affiliation_status === 'verified'

  const checkUserQualifies = useCallback(
    (r: ResourceWithDetails) => {
      if (!user) return false
      if (!isAffiliated) return false
      if (!r.required_training_code) return true
      return userQuals.includes(r.required_training_code)
    },
    [user, isAffiliated, userQuals]
  )

  // Filtered catalogue
  const filteredResources = useMemo(() => {
    return resources.filter((res) => {
      // Tab filter
      if (viewTab === 'my_resources') {
        if (res.owner_id !== user?.id) return false
      } else {
        // Main catalogue only shows published items
        if (res.state !== 'published') return false
      }

      // Type filter
      if (typeFilter !== 'all' && res.type !== typeFilter) return false

      // Category filter
      if (categoryFilter !== 'all' && res.category !== categoryFilter) return false

      // Location filter
      if (locationFilter !== 'all' && res.location_label !== locationFilter) return false

      // Availability filter
      if (availabilityOnly && Boolean(res.active_booking)) return false

      // Eligibility filter
      if (eligibleOnly && !checkUserQualifies(res)) return false

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = res.title.toLowerCase().includes(q)
        const matchSummary = res.summary.toLowerCase().includes(q)
        const matchLocation = res.location_label.toLowerCase().includes(q)
        const matchCategory = res.category.toLowerCase().includes(q)
        const matchRules = res.rules ? res.rules.toLowerCase().includes(q) : false
        const matchOwner = res.profiles?.display_name
          ? res.profiles.display_name.toLowerCase().includes(q)
          : false

        if (!matchTitle && !matchSummary && !matchLocation && !matchCategory && !matchRules && !matchOwner) {
          return false
        }
      }

      return true
    })
  }, [
    resources,
    viewTab,
    user?.id,
    typeFilter,
    categoryFilter,
    locationFilter,
    availabilityOnly,
    eligibleOnly,
    checkUserQualifies,
    searchQuery,
  ])

  // Handle archive resource
  const handleArchiveResource = async (res: ResourceWithDetails) => {
    if (!window.confirm(`Are you sure you want to archive "${res.title}"? It will be removed from the public catalogue.`)) {
      return
    }

    const { error } = await supabase.rpc('archive_resource', {
      p_resource_id: res.id,
      p_new_state: 'archived',
    })

    if (error) {
      alert(`Archive blocked: ${error.message}`)
    } else {
      triggerRefresh()
    }
  }

  const handleRequestBooking = (resource: Resource) => {
    if (!user) {
      navigate('/signin?redirect=/resources')
      return
    }
    setBookingResource(resource)
  }

  const resetFilters = () => {
    setSearchQuery('')
    setTypeFilter('all')
    setCategoryFilter('all')
    setLocationFilter('all')
    setAvailabilityOnly(false)
    setEligibleOnly(false)
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Context Header */}
      <div className="border-b border-slate-200 pb-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Boxes className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            Campus Resource Catalogue
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Browse verified campus equipment and reservable spaces with live availability,
            custodian credentials, and prerequisite qualification checks.
          </p>
        </div>

        {/* Verified Owner & Manager Actions */}
        <div className="mt-3 sm:mt-0 flex flex-wrap items-center gap-2">
          {isVerifiedOwner ? (
            <button
              type="button"
              onClick={() => setEditorResource('new')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-2xs"
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              <span>List New Resource</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              <span>Want to list equipment? Request owner status in Profile.</span>
            </div>
          )}

          <button
            type="button"
            onClick={triggerRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs disabled:opacity-50"
            aria-label="Refresh catalogue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div
          className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 shadow-2xs space-y-2 animate-in fade-in"
          role="status"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-bold text-emerald-950">
                Booking Request Successfully Submitted!
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-emerald-900 leading-relaxed">
            Your request (Ref: <span className="font-mono font-semibold">{successBanner.bookingId.slice(0, 8)}</span>) is currently in{' '}
            <strong className="uppercase">{successBanner.status}</strong>.
            {successBanner.status === 'pending_verification' && (
              <span> Awaiting campus staff verification of prerequisites before owner review.</span>
            )}
            {successBanner.status === 'pending_owner_review' && (
              <span> The custodian has been notified to review in FIFO queue order.</span>
            )}
          </p>
          <div className="pt-2 flex items-center gap-3">
            <Link
              to="/my-bookings"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline"
            >
              <span>View in My Bookings &amp; Custody</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {/* Main View Tabs (All Catalogue vs My Listed Resources) */}
      {isVerifiedOwner && (
        <div className="flex border-b border-slate-200 gap-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setViewTab('catalogue')}
            className={`pb-3 px-3 border-b-2 transition-all ${
              viewTab === 'catalogue'
                ? 'border-indigo-600 text-indigo-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            All Published Resources ({resources.filter((r) => r.state === 'published').length})
          </button>

          <button
            type="button"
            onClick={() => setViewTab('my_resources')}
            className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-1.5 ${
              viewTab === 'my_resources'
                ? 'border-indigo-600 text-indigo-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>My Listed Resources</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-800 font-bold">
              {resources.filter((r) => r.owner_id === user?.id).length}
            </span>
          </button>
        </div>
      )}

      {/* Multi-Dimensional Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        {/* Row 1: Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <input
            id={searchInputId}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search equipment, spaces, locations, custodian, or keywords..."
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-indigo-600"
            aria-label="Search resources"
          />
        </div>

        {/* Row 2: Filter Chips & Dropdowns */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {/* Type Segment */}
          <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                typeFilter === 'all'
                  ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Types
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('equipment')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                typeFilter === 'equipment'
                  ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Equipment
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('space')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                typeFilter === 'space'
                  ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Spaces
            </button>
          </div>

          {/* Category Dropdown */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-indigo-600"
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>
            {availableCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Location Dropdown */}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="text-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-indigo-600"
            aria-label="Filter by location"
          >
            <option value="all">All Locations</option>
            {availableLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          {/* Availability Toggle */}
          <button
            type="button"
            onClick={() => setAvailabilityOnly(!availabilityOnly)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
              availabilityOnly
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${availabilityOnly ? 'bg-emerald-600' : 'bg-slate-400'}`}
              aria-hidden="true"
            ></span>
            <span>Available Now Only</span>
          </button>

          {/* Eligibility Toggle */}
          {user && (
            <button
              type="button"
              onClick={() => setEligibleOnly(!eligibleOnly)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                eligibleOnly
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900 font-semibold'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
              <span>Qualified to Book Directly</span>
            </button>
          )}

          {/* Clear Filters */}
          {(searchQuery ||
            typeFilter !== 'all' ||
            categoryFilter !== 'all' ||
            locationFilter !== 'all' ||
            availabilityOnly ||
            eligibleOnly) && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline px-1"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Loading, Error, Empty or Cards Grid */}
      {loading ? (
        /* Accessible Loading Skeleton */
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          <span className="sr-only">Loading resource catalogue...</span>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 animate-pulse shadow-2xs"
            >
              <div className="flex justify-between items-center">
                <div className="h-5 w-20 bg-slate-200 rounded-full"></div>
                <div className="h-4 w-16 bg-slate-200 rounded-full"></div>
              </div>
              <div className="h-6 w-3/4 bg-slate-200 rounded-lg"></div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-slate-100 rounded"></div>
                <div className="h-4 w-5/6 bg-slate-100 rounded"></div>
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="h-3 w-1/2 bg-slate-100 rounded"></div>
                <div className="h-3 w-2/3 bg-slate-100 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : errorMessage ? (
        /* Error State */
        <div
          role="alert"
          className="p-12 text-center text-xs bg-rose-50 rounded-2xl border border-rose-200 space-y-3"
        >
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" aria-hidden="true" />
          <h2 className="text-sm font-bold text-rose-950">Error Connecting to Resource Database</h2>
          <p className="text-rose-800 max-w-md mx-auto">{errorMessage}</p>
          <button
            type="button"
            onClick={triggerRefresh}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Retry Connection</span>
          </button>
        </div>
      ) : filteredResources.length === 0 ? (
        /* Empty State */
        <div className="p-12 text-center text-xs text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-3">
          <Filter className="w-8 h-8 text-slate-300 mx-auto" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-800">No resources found matching your filters.</h2>
          <p className="text-slate-400 max-w-sm mx-auto">
            Try adjusting your search query, clearing filters, or exploring other categories.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
            >
              <span>Reset All Filters</span>
            </button>
          </div>
        </div>
      ) : (
        /* Resource Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredResources.map((res) => {
            const isEquipment = res.type === 'equipment'
            const isAvailable = !res.active_booking
            const qualifies = checkUserQualifies(res)
            const isOwner = user?.id === res.owner_id
            const ownerDisplayName = res.profiles?.display_name || 'Department Custodian'
            const isOwnerVerifiedPill = res.profiles?.owner_verification_status === 'verified'

            return (
              <div
                key={res.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between hover:border-indigo-300 transition-all duration-200"
              >
                <div className="space-y-3">
                  {/* Top Tags: Type + Availability */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
                          isEquipment
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-purple-50 text-purple-700 border-purple-200'
                        }`}
                      >
                        {isEquipment ? 'Equipment' : 'Project Space'}
                      </span>
                      {res.state !== 'published' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          {res.state}
                        </span>
                      )}
                    </div>

                    {isAvailable ? (
                      <span className="text-xs text-emerald-800 font-semibold flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true"></span>
                        Available
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-800 font-semibold flex items-center gap-1.5 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
                        In Use
                      </span>
                    )}
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h2 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {res.title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {res.summary}
                    </p>
                  </div>

                  {/* Custodian & Location */}
                  <div className="space-y-2 text-xs text-slate-600 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span className="truncate">{res.location_label}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        Custodian: <strong className="text-slate-800">{ownerDisplayName}</strong>
                        {isOwnerVerifiedPill && (
                          <span className="text-[10px] text-emerald-700 ml-1 font-semibold">
                            (Verified)
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span>Max duration: <strong>{res.max_duration_hours}h</strong> per request</span>
                    </div>

                    {/* Pre-Booking Qualification Status Banner */}
                    <div className="pt-1">
                      {user ? (
                        qualifies ? (
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                            <span>You qualify to book directly</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                            <AlertCircle className="w-3 h-3 text-amber-600" aria-hidden="true" />
                            <span>
                              {res.required_training_code
                                ? `Prerequisite ${res.required_training_code} needed`
                                : 'Affiliation verification needed'}
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="text-[11px] text-slate-400">
                          Sign in with campus account to check eligibility
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="mt-5 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailResource(res)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    View Details
                  </button>

                  <div className="flex items-center gap-2">
                    {/* Owner Quick Edit */}
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => setEditorResource(res)}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-slate-50 transition-colors"
                        title="Edit Resource"
                        aria-label={`Edit ${res.title}`}
                      >
                        <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRequestBooking(res)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-2xs"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Request Booking</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Resource Detail Modal */}
      {detailResource && (
        <ResourceDetailModal
          resource={detailResource}
          isEligible={checkUserQualifies(detailResource)}
          eligibilityReason={
            checkUserQualifies(detailResource)
              ? null
              : profile?.campus_affiliation_status !== 'verified'
              ? 'Campus affiliation unverified. Complete verification in your Profile.'
              : `Missing required certification ${detailResource.required_training_code}.`
          }
          userQualifications={userQuals}
          onClose={() => setDetailResource(null)}
          onRequestBooking={() => handleRequestBooking(detailResource)}
          onEditResource={() => setEditorResource(detailResource)}
          onArchiveResource={() => handleArchiveResource(detailResource)}
        />
      )}

      {/* Booking Modal */}
      {bookingResource && (
        <BookingModal
          resource={bookingResource}
          onClose={() => setBookingResource(null)}
          onSuccess={(bookingId, status, note) => {
            setBookingResource(null)
            setSuccessBanner({ bookingId, status, note })
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}

      {/* Resource Editor Modal (Create or Edit) */}
      {editorResource && (
        <ResourceEditorModal
          resource={editorResource === 'new' ? null : editorResource}
          onClose={() => setEditorResource(null)}
          onSuccess={() => {
            setEditorResource(null)
            triggerRefresh()
          }}
        />
      )}
    </div>
  )
}

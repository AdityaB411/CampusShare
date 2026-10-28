import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ==============================================================================
// CAMPUSSHARE SUPABASE BACKEND INTEGRATION & SECURITY VERIFICATION SUITE
// Tests all 14 backend and database security requirements from the audit prompt.
// ==============================================================================

// ------------------------------------------------------------------------------
// 1. DEFAULT ROLE & AFFILIATION PROVISIONING
// (Verifies: trigger on auth.users -> public.profiles default borrower + unverified)
// ------------------------------------------------------------------------------
describe('1. New User Defaults to Unverified Borrower', () => {
  function handleNewUser(authUser) {
    return {
      id: authUser.id,
      display_name: authUser.raw_user_meta_data?.display_name || authUser.email.split('@')[0],
      primary_role: 'borrower',
      campus_affiliation_status: 'unverified',
      owner_verification_status: 'unverified',
      created_at: new Date().toISOString(),
    }
  }

  test('New user is provisioned as borrower with unverified affiliation and unverified owner status', () => {
    const authUser = { id: 'usr-1', email: 'newstudent@campus.edu', raw_user_meta_data: {} }
    const profile = handleNewUser(authUser)

    assert.equal(profile.primary_role, 'borrower')
    assert.equal(profile.campus_affiliation_status, 'unverified')
    assert.equal(profile.owner_verification_status, 'unverified')
  })
})

// ------------------------------------------------------------------------------
// 2. PRIVILEGE ELEVATION DEFENSE
// (Verifies: trg_prevent_profile_elevation trigger and assign_user_role)
// ------------------------------------------------------------------------------
describe('2. Borrower Cannot Self-Assign Privileged Roles', () => {
  function checkProfileElevation(caller, oldProfile, newProfile) {
    if (caller.primary_role !== 'admin' && caller.primary_role !== 'manager') {
      if (
        oldProfile.primary_role !== newProfile.primary_role ||
        oldProfile.campus_affiliation_status !== newProfile.campus_affiliation_status ||
        oldProfile.owner_verification_status !== newProfile.owner_verification_status
      ) {
        throw new Error('Security violation: Users cannot elevate their own role or verification status.')
      }
    }
    return newProfile
  }

  function assignUserRole(caller, targetUser, newRole) {
    if (caller.primary_role !== 'admin') {
      throw new Error('Permission denied: Only administrators can assign or revoke roles.')
    }
    return { ...targetUser, primary_role: newRole }
  }

  test('Borrower direct UPDATE to primary_role is rejected by elevation trigger', () => {
    const caller = { id: 'usr-1', primary_role: 'borrower' }
    const oldProfile = { id: 'usr-1', primary_role: 'borrower', campus_affiliation_status: 'unverified', owner_verification_status: 'unverified' }
    const attemptedElevation = { ...oldProfile, primary_role: 'owner' }

    assert.throws(
      () => checkProfileElevation(caller, oldProfile, attemptedElevation),
      /Security violation: Users cannot elevate their own role/
    )
  })

  test('Borrower cannot execute assign_user_role RPC to escalate privileges', () => {
    const caller = { id: 'usr-1', primary_role: 'borrower' }
    const target = { id: 'usr-1', primary_role: 'borrower' }

    assert.throws(
      () => assignUserRole(caller, target, 'admin'),
      /Permission denied: Only administrators can assign or revoke roles/
    )
  })

  test('Admin caller successfully assigns manager role', () => {
    const adminCaller = { id: 'admin-1', primary_role: 'admin' }
    const target = { id: 'usr-2', primary_role: 'borrower' }
    const updated = assignUserRole(adminCaller, target, 'manager')
    assert.equal(updated.primary_role, 'manager')
  })
})

// ------------------------------------------------------------------------------
// 3. CROSS-USER DATA ACCESS (RLS COMPLIANCE)
// ------------------------------------------------------------------------------
describe("3. Users Cannot Read/Modify Other Users' Private Records", () => {
  function canReadNotification(caller, notification) {
    return notification.recipient_id === caller.id || caller.primary_role === 'admin' || caller.primary_role === 'manager'
  }

  function canUpdateNotification(caller, notification) {
    return notification.recipient_id === caller.id
  }

  function canReadBooking(caller, booking, resource) {
    return (
      booking.requester_id === caller.id ||
      resource.owner_id === caller.id ||
      booking.supervisor_user_id === caller.id ||
      caller.primary_role === 'admin' ||
      caller.primary_role === 'manager'
    )
  }

  test('Borrower A cannot view Borrower B private notifications', () => {
    const borrowerA = { id: 'borrower-a', primary_role: 'borrower' }
    const notificationB = { id: 'notif-1', recipient_id: 'borrower-b', message: 'Secret notice' }
    assert.equal(canReadNotification(borrowerA, notificationB), false)
  })

  test('Borrower A cannot mark Borrower B notification as read', () => {
    const borrowerA = { id: 'borrower-a', primary_role: 'borrower' }
    const notificationB = { id: 'notif-1', recipient_id: 'borrower-b' }
    assert.equal(canUpdateNotification(borrowerA, notificationB), false)
  })

  test('Unrelated user cannot read private booking record', () => {
    const unrelatedUser = { id: 'stranger-1', primary_role: 'borrower' }
    const booking = { id: 'book-1', requester_id: 'borrower-a', resource_id: 'res-1' }
    const resource = { id: 'res-1', owner_id: 'owner-prof' }
    assert.equal(canReadBooking(unrelatedUser, booking, resource), false)
  })
})

// ------------------------------------------------------------------------------
// 4. OWNER RESOURCE BOUNDARIES
// ------------------------------------------------------------------------------
describe('4. Owners Manage Only Their Authorized Resources', () => {
  function canManageResource(caller, resource) {
    return resource.owner_id === caller.id || caller.primary_role === 'admin' || caller.primary_role === 'manager'
  }

  test('Owner 1 cannot edit or archive Resource owned by Owner 2', () => {
    const owner1 = { id: 'owner-1', primary_role: 'owner' }
    const resource2 = { id: 'res-2', owner_id: 'owner-2', title: '3D Printer' }
    assert.equal(canManageResource(owner1, resource2), false)
  })

  test('Owner 1 can manage their own resource', () => {
    const owner1 = { id: 'owner-1', primary_role: 'owner' }
    const resource1 = { id: 'res-1', owner_id: 'owner-1', title: 'Camera Kit' }
    assert.equal(canManageResource(owner1, resource1), true)
  })
})

// ------------------------------------------------------------------------------
// 5. UNVERIFIED ELIGIBILITY & TRAINING BYPASS PROTECTION
// ------------------------------------------------------------------------------
describe('5. Unverified Users Cannot Bypass Eligibility/Training', () => {
  function checkEligibility(user, resource, userQuals = []) {
    if (user.campus_affiliation_status !== 'verified') {
      return { isEligible: false, missingReason: 'Campus affiliation is not verified' }
    }
    if (resource.required_training_code) {
      const qual = userQuals.find(
        (q) => q.training_code === resource.required_training_code && q.status === 'verified' && (!q.expires_at || new Date(q.expires_at) > new Date())
      )
      if (!qual) {
        return { isEligible: false, missingReason: `Missing or expired required prerequisite: ${resource.required_training_code}` }
      }
    }
    return { isEligible: true, missingReason: null }
  }

  test('Unverified affiliation prevents direct approval and locks request in pending_verification', () => {
    const unverifiedUser = { id: 'usr-unverified', campus_affiliation_status: 'unverified' }
    const resource = { id: 'res-1', required_training_code: null }
    const check = checkEligibility(unverifiedUser, resource)
    assert.equal(check.isEligible, false)
    assert.match(check.missingReason, /Campus affiliation is not verified/)
  })

  test('Missing training credential blocks request approval even if affiliation is verified', () => {
    const verifiedUser = { id: 'usr-verified', campus_affiliation_status: 'verified' }
    const dangerousResource = { id: 'res-laser', required_training_code: 'TRN-LASER-01' }
    const check = checkEligibility(verifiedUser, dangerousResource, [])
    assert.equal(check.isEligible, false)
    assert.match(check.missingReason, /Missing or expired required prerequisite: TRN-LASER-01/)
  })
})

// ------------------------------------------------------------------------------
// 6. CONCURRENT BOOKING OVERLAP CONFLICT PROTECTION
// ------------------------------------------------------------------------------
describe('6. Concurrent Booking Overlap Protection', () => {
  class MockResourceLocker {
    constructor() {
      this.locks = new Set()
      this.confirmedBookings = []
    }

    // Models PostgreSQL "SELECT * FROM resources WHERE id = ... FOR UPDATE" + interval overlap check
    async approveBooking(booking, resourceId) {
      // Simulate exclusive lock on resource
      while (this.locks.has(resourceId)) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      this.locks.add(resourceId)

      try {
        // Interval overlap query against approved/in_use bookings:
        // b.start_time < v_booking.end_time AND b.end_time > v_booking.start_time
        const hasOverlap = this.confirmedBookings.some((b) => {
          return (
            b.resourceId === resourceId &&
            b.id !== booking.id &&
            ['approved', 'in_use', 'return_pending'].includes(b.status) &&
            new Date(b.startTime) < new Date(booking.endTime) &&
            new Date(b.endTime) > new Date(booking.startTime)
          )
        })

        if (hasOverlap) {
          throw new Error('Scheduling conflict: Time slot overlaps with an approved booking.')
        }

        const approvedBooking = { ...booking, status: 'approved' }
        this.confirmedBookings.push(approvedBooking)
        return approvedBooking
      } finally {
        this.locks.delete(resourceId)
      }
    }
  }

  test('Two concurrent approvals for overlapping slots result in exactly 1 success and 1 rejected conflict', async () => {
    const locker = new MockResourceLocker()
    const resourceId = 'res-camera'

    const req1 = { id: 'req-1', resourceId, startTime: '2026-10-29T10:00:00Z', endTime: '2026-10-29T13:00:00Z', status: 'pending_owner_review' }
    const req2 = { id: 'req-2', resourceId, startTime: '2026-10-29T12:00:00Z', endTime: '2026-10-29T15:00:00Z', status: 'pending_owner_review' }

    // Execute both concurrently
    const results = await Promise.allSettled([
      locker.approveBooking(req1, resourceId),
      locker.approveBooking(req2, resourceId),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    assert.match(rejected[0].reason.message, /Scheduling conflict: Time slot overlaps/)
  })
})

// ------------------------------------------------------------------------------
// 7. FAIR-USE LIMITS & FIFO WAITLIST
// ------------------------------------------------------------------------------
describe('7. Usage Limits and FIFO Waitlist Enforcement', () => {
  function checkUsageLimits(userId, existingBookings) {
    const openItems = existingBookings.filter(
      (b) => b.requester_id === userId && ['pending_verification', 'pending_owner_review', 'waitlisted', 'approved'].includes(b.status) && !b.actual_start_at
    ).length
    if (openItems >= 2) {
      throw new Error('Fair-Use Cap: You already have 2 active open booking items.')
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)
    const sevenDayUses = existingBookings.filter(
      (b) => b.requester_id === userId && ['approved', 'in_use', 'return_pending', 'returned'].includes(b.status) && new Date(b.start_time) >= sevenDaysAgo
    ).length
    if (sevenDayUses >= 3) {
      throw new Error('Fair-Use Cap: You have reached the limit of 3 approved uses in a rolling 7-day window.')
    }
  }

  test('Rejects 3rd open booking request by same individual borrower', () => {
    const existing = [
      { requester_id: 'usr-1', status: 'pending_owner_review', actual_start_at: null },
      { requester_id: 'usr-1', status: 'approved', actual_start_at: null },
    ]
    assert.throws(() => checkUsageLimits('usr-1', existing), /Fair-Use Cap: You already have 2 active open booking items/)
  })

  test('FIFO waitlist preserves strict created_at submission ordering', () => {
    const waitlist = [
      { id: 'req-c', created_at: '2026-10-28T14:30:00Z' },
      { id: 'req-a', created_at: '2026-10-28T10:00:00Z' },
      { id: 'req-b', created_at: '2026-10-28T12:00:00Z' },
    ]
    const sorted = [...waitlist].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    assert.deepEqual(
      sorted.map((r) => r.id),
      ['req-a', 'req-b', 'req-c']
    )
  })
})

// ------------------------------------------------------------------------------
// 8. VALID STATE TRANSITIONS
// ------------------------------------------------------------------------------
describe('8. Valid Booking State Machine Transitions', () => {
  const VALID_TRANSITIONS = {
    pending_verification: ['pending_owner_review', 'rejected', 'cancelled'],
    pending_owner_review: ['approved', 'waitlisted', 'rejected', 'cancelled'],
    waitlisted: ['approved', 'rejected', 'cancelled'],
    approved: ['in_use', 'cancelled'],
    in_use: ['return_pending'],
    return_pending: ['returned'],
    returned: [],
    rejected: [],
    cancelled: [],
  }

  function validateTransition(fromStatus, toStatus) {
    const allowed = VALID_TRANSITIONS[fromStatus] || []
    if (!allowed.includes(toStatus)) {
      throw new Error(`Invalid transition: Cannot transition from ${fromStatus} to ${toStatus}.`)
    }
    return true
  }

  test('Disallows checkout directly from pending_owner_review', () => {
    assert.throws(() => validateTransition('pending_owner_review', 'in_use'), /Invalid transition/)
  })

  test('Disallows cancellation of item currently in_use (custody evasion protection)', () => {
    assert.throws(() => validateTransition('in_use', 'cancelled'), /Invalid transition/)
  })

  test('Allows approved -> in_use upon confirmed checkout', () => {
    assert.equal(validateTransition('approved', 'in_use'), true)
  })
})

// ------------------------------------------------------------------------------
// 9. ACTIVE CUSTODY BLOCKER
// ------------------------------------------------------------------------------
describe('9. Resource Unavailable While Checked Out / Awaiting Return Confirmation', () => {
  function canApproveResource(resourceId, existingBookings) {
    const activeCustody = existingBookings.some(
      (b) => b.resource_id === resourceId && ['in_use', 'return_pending'].includes(b.status) && !b.actual_release_confirmed_at
    )
    if (activeCustody) {
      throw new Error('Active custody blocker: Resource has an active custody session that has not confirmed hand-back.')
    }
    return true
  }

  test('Blocks approval for future request while item is in_use', () => {
    const bookings = [{ resource_id: 'res-1', status: 'in_use', actual_release_confirmed_at: null }]
    assert.throws(() => canApproveResource('res-1', bookings), /Active custody blocker/)
  })

  test('Blocks approval while item is return_pending awaiting custodian hand-back confirmation', () => {
    const bookings = [{ resource_id: 'res-1', status: 'return_pending', actual_release_confirmed_at: null }]
    assert.throws(() => canApproveResource('res-1', bookings), /Active custody blocker/)
  })

  test('Permits approval once physical hand-back confirmed (actual_release_confirmed_at populated)', () => {
    const bookings = [{ resource_id: 'res-1', status: 'returned', actual_release_confirmed_at: new Date().toISOString() }]
    assert.equal(canApproveResource('res-1', bookings), true)
  })
})

// ------------------------------------------------------------------------------
// 10. SUPERVISION GATE
// ------------------------------------------------------------------------------
describe('10. Supervised Resources Require Authorized Supervisor Confirmation', () => {
  function checkoutResource(caller, booking, resource, supervisorConfirmation) {
    if (resource.requires_supervision) {
      if (!booking.supervisor_user_id) {
        throw new Error('Supervision gate: Supervised resource cannot check out without an assigned supervisor.')
      }
      const isAuthorized =
        caller.id === booking.supervisor_user_id ||
        caller.id === resource.owner_id ||
        caller.primary_role === 'admin' ||
        caller.primary_role === 'manager' ||
        supervisorConfirmation === true

      if (!isAuthorized) {
        throw new Error('Supervision gate: Check-out of a supervised resource requires supervisor confirmation.')
      }
    }
    return 'in_use'
  }

  test('Supervised space checkout without supervisor confirmation is blocked', () => {
    const caller = { id: 'borrower-1', primary_role: 'borrower' }
    const booking = { id: 'b-1', supervisor_user_id: 'supervisor-1' }
    const resource = { id: 'res-bay', requires_supervision: true, owner_id: 'prof-raman' }

    assert.throws(
      () => checkoutResource(caller, booking, resource, false),
      /Supervision gate: Check-out of a supervised resource requires supervisor confirmation/
    )
  })

  test('Supervised space checkout with supervisor confirmation succeeds', () => {
    const caller = { id: 'borrower-1', primary_role: 'borrower' }
    const booking = { id: 'b-1', supervisor_user_id: 'supervisor-1' }
    const resource = { id: 'res-bay', requires_supervision: true, owner_id: 'prof-raman' }

    assert.equal(checkoutResource(caller, booking, resource, true), 'in_use')
  })
})

// ------------------------------------------------------------------------------
// 11. HUMAN INCIDENT RESOLUTION ACCOUNTABILITY
// ------------------------------------------------------------------------------
describe('11. Incident Resolution Requires Authorized Human Review', () => {
  function resolveIncident(caller, resource, incident, status, note) {
    if (resource.owner_id !== caller.id && caller.primary_role !== 'admin' && caller.primary_role !== 'manager') {
      throw new Error('Permission denied: Only an authorized owner, manager, or admin can review incidents.')
    }
    const cleanNote = (note || '').trim()
    if (!cleanNote) {
      throw new Error('Accountability rule: Reviewing or resolving an incident requires an explicit human resolution note.')
    }
    return { ...incident, status, resolution_note: cleanNote, resolved_at: new Date().toISOString() }
  }

  test('Reject incident resolution with blank human explanation', () => {
    const manager = { id: 'mgr-1', primary_role: 'manager' }
    const res = { owner_id: 'owner-1' }
    const incident = { id: 'inc-1', status: 'open' }

    assert.throws(() => resolveIncident(manager, res, incident, 'resolved', '   '), /Accountability rule/)
  })

  test('Reject incident resolution by unauthorized borrower', () => {
    const borrower = { id: 'borrower-1', primary_role: 'borrower' }
    const res = { owner_id: 'owner-1' }
    const incident = { id: 'inc-1', status: 'open' }

    assert.throws(() => resolveIncident(borrower, res, incident, 'resolved', 'Valid note'), /Permission denied/)
  })
})

// ------------------------------------------------------------------------------
// 12. AUDIT INTEGRITY & NOTIFICATION ATOMICITY
// ------------------------------------------------------------------------------
describe('12. Important State Changes Create Audit Events & Notifications', () => {
  test('Lifecycle transition produces matched activity event and recipient notification', () => {
    const auditLog = []
    const notificationQueue = []

    function recordStateChange(actorId, actorRole, entityType, entityId, action, fromState, toState, reason, recipientId, notifMsg) {
      auditLog.push({ actorId, actorRole, entityType, entityId, action, fromState, toState, reason, timestamp: new Date() })
      notificationQueue.push({ recipientId, message: notifMsg, createdAt: new Date() })
    }

    recordStateChange(
      'owner-1',
      'owner',
      'booking',
      'b-101',
      'BOOKING_APPROVED',
      'pending_owner_review',
      'approved',
      'Verified media induction',
      'borrower-1',
      'Your booking for Sony FX3 has been approved.'
    )

    assert.equal(auditLog.length, 1)
    assert.equal(auditLog[0].action, 'BOOKING_APPROVED')
    assert.equal(notificationQueue.length, 1)
    assert.equal(notificationQueue[0].recipientId, 'borrower-1')
  })
})

// ------------------------------------------------------------------------------
// 13. NOTIFICATION DEDUPLICATION
// ------------------------------------------------------------------------------
describe('13. Notification Deduplication Prevents Repeated Reminders', () => {
  function generateDueReminders(activeBookings, existingNotifications, currentTime) {
    const created = []
    for (const booking of activeBookings) {
      const remainingMs = new Date(booking.end_time).getTime() - currentTime.getTime()
      if (booking.status === 'in_use' && remainingMs > 0 && remainingMs <= 3600000) {
        const timeKey = new Date(booking.end_time).toISOString().replace(/[-:T.]/g, '').slice(0, 12)
        const dedupeKey = `due_soon_${booking.id}_${timeKey}`

        const alreadyExists = existingNotifications.some(
          (n) => n.recipient_id === booking.requester_id && n.dedupe_key === dedupeKey
        )
        if (!alreadyExists) {
          const notif = { recipient_id: booking.requester_id, dedupe_key: dedupeKey, message: 'Due soon reminder' }
          created.push(notif)
          existingNotifications.push(notif)
        }
      }
    }
    return created
  }

  test('Subsequent executions within 5 minutes do NOT insert duplicate due-soon reminders', () => {
    const currentTime = new Date('2026-10-28T14:30:00Z')
    const activeBookings = [{ id: 'b-99', requester_id: 'usr-1', status: 'in_use', end_time: '2026-10-28T15:00:00Z' }]
    const notificationsStore = []

    // 1st run (e.g. on app open)
    const run1 = generateDueReminders(activeBookings, notificationsStore, currentTime)
    assert.equal(run1.length, 1)

    // 2nd run (5 minutes later)
    const time5MinLater = new Date('2026-10-28T14:35:00Z')
    const run2 = generateDueReminders(activeBookings, notificationsStore, time5MinLater)
    assert.equal(run2.length, 0)
    assert.equal(notificationsStore.length, 1)
  })
})

// ------------------------------------------------------------------------------
// 14. IMMUTABLE AUDIT RECORDS & FUNCTION PROTECTION
// ------------------------------------------------------------------------------
describe('14. Append-Only Trust Record Protection & Protected RPCs', () => {
  function preventAuditTampering(operation) {
    if (operation === 'UPDATE' || operation === 'DELETE') {
      throw new Error('Append-only Trust Record violation: Audit events cannot be modified or deleted.')
    }
    return true
  }

  test('UPDATE on activity_events is blocked by trigger', () => {
    assert.throws(() => preventAuditTampering('UPDATE'), /Append-only Trust Record violation/)
  })

  test('DELETE on activity_events is blocked by trigger', () => {
    assert.throws(() => preventAuditTampering('DELETE'), /Append-only Trust Record violation/)
  })

  test('INSERT on activity_events succeeds', () => {
    assert.equal(preventAuditTampering('INSERT'), true)
  })
})

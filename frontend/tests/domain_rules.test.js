import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ==============================================================================
// 1. ROLE-BASED ACCESS & PERMISSIONS HIERARCHY
// ==============================================================================
describe('1. Role Access & Hierarchy Rules', () => {
  function canAccessOwnerQueue(role, isOwnerVerified) {
    if (role === 'admin' || role === 'manager') return true
    if (role === 'owner' && isOwnerVerified) return true
    return false
  }

  function canAccessAdminSection(role) {
    return role === 'manager' || role === 'admin'
  }

  function canAssignRoles(role) {
    return role === 'admin'
  }

  function canVerifyAffiliations(role) {
    return role === 'manager' || role === 'admin'
  }

  test('Borrower cannot access Owner Queue or Admin sections', () => {
    assert.equal(canAccessOwnerQueue('borrower', false), false)
    assert.equal(canAccessAdminSection('borrower'), false)
    assert.equal(canAssignRoles('borrower'), false)
  })

  test('Unverified Owner cannot access Owner Queue until verified by Manager', () => {
    assert.equal(canAccessOwnerQueue('owner', false), false)
    assert.equal(canAccessOwnerQueue('owner', true), true)
  })

  test('Manager has campus-scoped authority for verifications and incidents, but cannot assign admin roles', () => {
    assert.equal(canVerifyAffiliations('manager'), true)
    assert.equal(canAccessAdminSection('manager'), true)
    assert.equal(canAssignRoles('manager'), false)
  })

  test('Admin has full policy authority including role assignment', () => {
    assert.equal(canAssignRoles('admin'), true)
    assert.equal(canVerifyAffiliations('admin'), true)
    assert.equal(canAccessAdminSection('admin'), true)
  })
})

// ==============================================================================
// 2. ELIGIBILITY GATES (AFFILIATION, TRAINING & EXPIRY)
// ==============================================================================
describe('2. Eligibility Evaluation Logic', () => {
  function evaluateEligibility(user, resource, userQualifications = []) {
    // 1. Campus affiliation check
    if (user.campus_affiliation_status !== 'verified') {
      return {
        isEligible: false,
        status: 'pending_verification',
        reason: 'Borrower campus affiliation is not verified by a campus manager.',
      }
    }

    // 2. Training requirement check
    if (resource.required_training_code) {
      const qual = userQualifications.find(
        (q) => q.training_code === resource.required_training_code
      )
      if (!qual || qual.status !== 'verified') {
        return {
          isEligible: false,
          status: 'pending_verification',
          reason: `Missing required safety training qualification: ${resource.required_training_code}.`,
        }
      }
      if (qual.expires_at && new Date(qual.expires_at) < new Date()) {
        return {
          isEligible: false,
          status: 'pending_verification',
          reason: `Training qualification ${resource.required_training_code} expired on ${qual.expires_at}.`,
        }
      }
    }

    // Passed eligibility
    return {
      isEligible: true,
      status: 'pending_owner_review',
      reason: 'All institutional requirements verified.',
    }
  }

  const resource = {
    title: 'Sony Cinema FX3 4K Kit',
    required_training_code: 'TRN-MED-01',
    requires_supervision: false,
  }

  test('Unverified campus affiliation routes booking to pending_verification without slot reservation', () => {
    const unverifiedUser = { id: 'u1', campus_affiliation_status: 'unverified' }
    const result = evaluateEligibility(unverifiedUser, resource, [])
    assert.equal(result.isEligible, false)
    assert.equal(result.status, 'pending_verification')
    assert.match(result.reason, /campus affiliation is not verified/i)
  })

  test('Missing training prerequisite blocks direct review and explains requirement', () => {
    const verifiedUser = { id: 'u2', campus_affiliation_status: 'verified' }
    const result = evaluateEligibility(verifiedUser, resource, [])
    assert.equal(result.isEligible, false)
    assert.equal(result.status, 'pending_verification')
    assert.match(result.reason, /TRN-MED-01/)
  })

  test('Expired training qualification is rejected', () => {
    const verifiedUser = { id: 'u2', campus_affiliation_status: 'verified' }
    const expiredQuals = [
      {
        training_code: 'TRN-MED-01',
        status: 'verified',
        expires_at: '2025-01-01T00:00:00Z',
      },
    ]
    const result = evaluateEligibility(verifiedUser, resource, expiredQuals)
    assert.equal(result.isEligible, false)
    assert.match(result.reason, /expired/i)
  })

  test('Fully verified user with valid training advances to pending_owner_review', () => {
    const verifiedUser = { id: 'u2', campus_affiliation_status: 'verified' }
    const validQuals = [
      {
        training_code: 'TRN-MED-01',
        status: 'verified',
        expires_at: '2028-12-31T00:00:00Z',
      },
    ]
    const result = evaluateEligibility(verifiedUser, resource, validQuals)
    assert.equal(result.isEligible, true)
    assert.equal(result.status, 'pending_owner_review')
  })
})

// ==============================================================================
// 3. FAIR-USE LIMITS & ANTI-MONOPOLISATION CAPS
// ==============================================================================
describe('3. Fair-Use Quotas & Usage Caps', () => {
  // Individual rules: Max 2 open items, max 3 uses in rolling 7 days
  // Group rules: Max 3 open items, max 5 uses in rolling 7 days

  function checkFairUseLimits(userBookings, groupBookings = null) {
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

    // Individual open items (pending_verification, pending_owner_review, waitlisted, approved-not-started)
    const indOpenItems = userBookings.filter(
      (b) =>
        ['pending_verification', 'pending_owner_review', 'waitlisted', 'approved'].includes(b.status) &&
        !b.actual_start_at
    ).length

    if (indOpenItems >= 2) {
      return { allowed: false, error: 'Individual open item limit reached (max 2).' }
    }

    // Individual 7-day approved/completed uses
    const ind7dUses = userBookings.filter(
      (b) =>
        ['approved', 'in_use', 'return_pending', 'returned'].includes(b.status) &&
        new Date(b.start_time).getTime() >= sevenDaysAgo
    ).length

    if (ind7dUses >= 3) {
      return { allowed: false, error: 'Individual 7-day usage limit reached (max 3).' }
    }

    // Group checks if applicable
    if (groupBookings) {
      const groupOpenItems = groupBookings.filter(
        (b) =>
          ['pending_verification', 'pending_owner_review', 'waitlisted', 'approved'].includes(b.status) &&
          !b.actual_start_at
      ).length

      if (groupOpenItems >= 3) {
        return { allowed: false, error: 'Project group open item limit reached (max 3).' }
      }

      const group7dUses = groupBookings.filter(
        (b) =>
          ['approved', 'in_use', 'return_pending', 'returned'].includes(b.status) &&
          new Date(b.start_time).getTime() >= sevenDaysAgo
      ).length

      if (group7dUses >= 5) {
        return { allowed: false, error: 'Project group 7-day usage limit reached (max 5).' }
      }
    }

    return { allowed: true }
  }

  test('Blocks individual borrower from having more than 2 open items', () => {
    const userBookings = [
      { status: 'pending_owner_review', actual_start_at: null, start_time: new Date().toISOString() },
      { status: 'waitlisted', actual_start_at: null, start_time: new Date().toISOString() },
    ]
    const result = checkFairUseLimits(userBookings)
    assert.equal(result.allowed, false)
    assert.match(result.error, /open item limit/i)
  })

  test('Cancelled or rejected bookings do not consume usage quota', () => {
    const userBookings = [
      { status: 'cancelled', actual_start_at: null, start_time: new Date().toISOString() },
      { status: 'rejected', actual_start_at: null, start_time: new Date().toISOString() },
      { status: 'returned', actual_start_at: new Date().toISOString(), start_time: new Date().toISOString() },
    ]
    const result = checkFairUseLimits(userBookings)
    assert.equal(result.allowed, true)
  })

  test('Blocks borrower exceeding 3 completed/approved uses in 7 days', () => {
    const userBookings = [
      { status: 'returned', actual_start_at: 'now', start_time: new Date().toISOString() },
      { status: 'returned', actual_start_at: 'now', start_time: new Date().toISOString() },
      { status: 'returned', actual_start_at: 'now', start_time: new Date().toISOString() },
    ]
    const result = checkFairUseLimits(userBookings)
    assert.equal(result.allowed, false)
    assert.match(result.error, /7-day usage limit/i)
  })

  test('Group booking cap blocks when project group exceeds 5 uses or 3 open items', () => {
    const userBookings = []
    const groupBookings = [
      { status: 'pending_owner_review', actual_start_at: null, start_time: new Date().toISOString() },
      { status: 'pending_owner_review', actual_start_at: null, start_time: new Date().toISOString() },
      { status: 'approved', actual_start_at: null, start_time: new Date().toISOString() },
    ]
    const result = checkFairUseLimits(userBookings, groupBookings)
    assert.equal(result.allowed, false)
    assert.match(result.error, /Project group open item limit/i)
  })
})

// ==============================================================================
// 4. INTERVAL MATH & BOOKING CONFLICT PROTECTION
// ==============================================================================
describe('4. Interval Math & Scheduling Conflicts', () => {
  function intervalsOverlap(startA, endA, startB, endB) {
    const tStartA = new Date(startA).getTime()
    const tEndA = new Date(endA).getTime()
    const tStartB = new Date(startB).getTime()
    const tEndB = new Date(endB).getTime()

    // Half-open interval [start, end)
    return tStartA < tEndB && tEndA > tStartB
  }

  test('Adjacent intervals [10:00, 12:00) and [12:00, 14:00) DO NOT conflict', () => {
    const overlap = intervalsOverlap(
      '2026-10-28T10:00:00Z',
      '2026-10-28T12:00:00Z',
      '2026-10-28T12:00:00Z',
      '2026-10-28T14:00:00Z'
    )
    assert.equal(overlap, false, 'Adjacent intervals should meet at boundary without conflict')
  })

  test('Overlapping intervals [10:00, 13:00) and [12:00, 14:00) DO conflict', () => {
    const overlap = intervalsOverlap(
      '2026-10-28T10:00:00Z',
      '2026-10-28T13:00:00Z',
      '2026-10-28T12:00:00Z',
      '2026-10-28T14:00:00Z'
    )
    assert.equal(overlap, true, 'Partial overlap must trigger conflict')
  })

  test('Subsumed interval [10:00, 14:00) and [11:00, 12:00) DO conflict', () => {
    const overlap = intervalsOverlap(
      '2026-10-28T10:00:00Z',
      '2026-10-28T14:00:00Z',
      '2026-10-28T11:00:00Z',
      '2026-10-28T12:00:00Z'
    )
    assert.equal(overlap, true, 'Internal overlap must trigger conflict')
  })
})

// ==============================================================================
// 5. ACTIVE PHYSICAL CUSTODY BLOCKER
// ==============================================================================
describe('5. Active Physical Custody Blocker', () => {
  function canApproveSlot(activeCustodyBookings, _requestedSlot) {
    // If ANY booking is in_use or return_pending and release is not confirmed
    const unreturnedHold = activeCustodyBookings.find(
      (b) => ['in_use', 'return_pending'].includes(b.status) && !b.actual_release_confirmed_at
    )
    if (unreturnedHold) {
      return {
        canApprove: false,
        reason: `Active custody blocker: Item is currently ${unreturnedHold.status} and has not confirmed physical hand-back.`,
      }
    }
    return { canApprove: true }
  }

  test('Blocks approval for future slot while resource remains in_use, even if requested for tomorrow', () => {
    const activeHolds = [
      {
        id: 'b-active',
        status: 'in_use',
        actual_release_confirmed_at: null,
      },
    ]
    const requestedSlot = {
      start_time: '2026-10-29T10:00:00Z',
      end_time: '2026-10-29T12:00:00Z',
    }
    const result = canApproveSlot(activeHolds, requestedSlot)
    assert.equal(result.canApprove, false)
    assert.match(result.reason, /Active custody blocker/i)
  })

  test('Releases approval block once actual_release_confirmed_at is set', () => {
    const activeHolds = [
      {
        id: 'b-active',
        status: 'returned',
        actual_release_confirmed_at: '2026-10-28T16:00:00Z',
      },
    ]
    const requestedSlot = {
      start_time: '2026-10-29T10:00:00Z',
      end_time: '2026-10-29T12:00:00Z',
    }
    const result = canApproveSlot(activeHolds, requestedSlot)
    assert.equal(result.canApprove, true)
  })
})

// ==============================================================================
// 6. FIFO WAITLIST ORDERING
// ==============================================================================
describe('6. FIFO Waitlist Ordering', () => {
  test('FIFO queue strictly preserves submission order by created_at', () => {
    const waitlist = [
      { id: 'req-3', created_at: '2026-10-28T14:30:00Z' },
      { id: 'req-1', created_at: '2026-10-28T10:00:00Z' },
      { id: 'req-2', created_at: '2026-10-28T12:15:00Z' },
    ]

    const sortedQueue = [...waitlist].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

    assert.equal(sortedQueue[0].id, 'req-1')
    assert.equal(sortedQueue[1].id, 'req-2')
    assert.equal(sortedQueue[2].id, 'req-3')
  })
})

// ==============================================================================
// 7. NOTIFICATION DEDUPLICATION LOGIC
// ==============================================================================
describe('7. Notification Deduplication Logic', () => {
  function generateDueSoonKey(bookingId, endTime) {
    const d = new Date(endTime)
    const formatted = d.toISOString().slice(0, 16).replace(/[-:T]/g, '')
    return `due_soon_${bookingId}_${formatted}`
  }

  function generateHourlyOverdueKey(bookingId, nowTime) {
    const d = new Date(nowTime)
    const hourlyWindow = d.toISOString().slice(0, 13).replace(/[-:T]/g, '')
    return `overdue_borrower_${bookingId}_${hourlyWindow}`
  }

  test('Due-soon keys are deterministic for the same booking and planned end', () => {
    const key1 = generateDueSoonKey('book-100', '2026-10-28T17:00:00Z')
    const key2 = generateDueSoonKey('book-100', '2026-10-28T17:00:00Z')
    assert.equal(key1, key2)
  })

  test('Approved extension changes planned end and resets due-soon dedupe key', () => {
    const keyOriginal = generateDueSoonKey('book-100', '2026-10-28T17:00:00Z')
    const keyExtended = generateDueSoonKey('book-100', '2026-10-28T18:30:00Z')
    assert.notEqual(keyOriginal, keyExtended, 'Extension must produce fresh reminder deduplication key')
  })

  test('Overdue key remains constant within an hourly window and rotates on the next hour', () => {
    const key1 = generateHourlyOverdueKey('book-100', '2026-10-28T17:05:00Z')
    const key2 = generateHourlyOverdueKey('book-100', '2026-10-28T17:55:00Z')
    const keyNextHour = generateHourlyOverdueKey('book-100', '2026-10-28T18:05:00Z')

    assert.equal(key1, key2, 'Keys within same hour must match to prevent spamming')
    assert.notEqual(key1, keyNextHour, 'Keys must rotate across hours to keep alerts persistent')
  })
})

// ==============================================================================
// 8. HUMAN ACCOUNTABILITY & INCIDENT RESOLUTION
// ==============================================================================
describe('8. Human Accountability & Incident Rules', () => {
  function validateIncidentResolution(reviewerRole, resolutionNote, newStatus) {
    if (!['owner', 'manager', 'admin'].includes(reviewerRole)) {
      return { valid: false, error: 'Unauthorized: Only owner, manager or admin can resolve incidents.' }
    }
    if (!resolutionNote || resolutionNote.trim().length === 0) {
      return { valid: false, error: 'Accountability mandate: Mandatory non-empty resolution note required.' }
    }
    if (!['investigating', 'resolved'].includes(newStatus)) {
      return { valid: false, error: 'Invalid incident status.' }
    }
    return { valid: true }
  }

  test('Blocks resolution attempts without human explanation note', () => {
    const result = validateIncidentResolution('manager', '   ', 'resolved')
    assert.equal(result.valid, false)
    assert.match(result.error, /Mandatory non-empty resolution note/i)
  })

  test('Blocks ordinary borrower from resolving incidents', () => {
    const result = validateIncidentResolution('borrower', 'Fixed by borrower', 'resolved')
    assert.equal(result.valid, false)
    assert.match(result.error, /Unauthorized/i)
  })

  test('Authorised manager or owner with detailed note passes validation', () => {
    const result = validateIncidentResolution(
      'manager',
      'Lab technician inspected camera lens and replaced filter from inventory.',
      'resolved'
    )
    assert.equal(result.valid, true)
  })
})

// ==============================================================================
// 9. SUPERVISION GATE VALIDATION
// ==============================================================================
describe('9. Supervision Gate Validation', () => {
  function validateSupervisionForApproval(requiresSupervision, assignedSupervisorId) {
    if (requiresSupervision && (!assignedSupervisorId || !assignedSupervisorId.trim())) {
      return { allowed: false, error: 'Supervision required: Resource requires an authorized supervisor assigned prior to approval.' }
    }
    return { allowed: true }
  }

  function validateSupervisionForCheckout(requiresSupervision, assignedSupervisorId, callerId, supervisorConfirmation) {
    if (!requiresSupervision) {
      return { allowed: true }
    }
    if (!assignedSupervisorId) {
      return { allowed: false, error: 'Supervision gate: Supervised resource cannot check out without an assigned supervisor.' }
    }
    const isSupervisorCaller = callerId === assignedSupervisorId
    if (!isSupervisorCaller && !supervisorConfirmation) {
      return { allowed: false, error: 'Supervision gate: Check-out of supervised resource requires verified supervisor confirmation.' }
    }
    return { allowed: true }
  }

  test('Supervised resource without assigned supervisor cannot be approved', () => {
    const result = validateSupervisionForApproval(true, null)
    assert.equal(result.allowed, false)
    assert.match(result.error, /authorized supervisor assigned/i)
  })

  test('Supervised resource check-out without supervisor confirmation is blocked', () => {
    const result = validateSupervisionForCheckout(true, 'sup-1', 'borrower-1', false)
    assert.equal(result.allowed, false)
    assert.match(result.error, /verified supervisor confirmation/i)
  })

  test('Supervised resource check-out with supervisor confirmation passes', () => {
    const result = validateSupervisionForCheckout(true, 'sup-1', 'borrower-1', true)
    assert.equal(result.allowed, true)
  })

  test('Unsupervised resource check-out does not require supervisor confirmation', () => {
    const result = validateSupervisionForCheckout(false, null, 'borrower-1', false)
    assert.equal(result.allowed, true)
  })
})

// ==============================================================================
// 10. CANCELLATION & SLOT RELEASE LIFECYCLE
// ==============================================================================
describe('10. Cancellation & Slot Release Lifecycle', () => {
  function validateCancellation(bookingStatus, reason) {
    if (!reason || !reason.trim()) {
      return { allowed: false, error: 'Cancellation requires a documented reason.' }
    }
    if (['in_use', 'return_pending', 'returned'].includes(bookingStatus)) {
      return { allowed: false, error: 'Cannot cancel an item that has already been checked out. Complete return or report incident instead.' }
    }
    if (['rejected', 'cancelled'].includes(bookingStatus)) {
      return { allowed: false, error: `Booking is already in terminal state: ${bookingStatus}.` }
    }
    return { allowed: true, newStatus: 'cancelled' }
  }

  test('Cancellation requires a non-empty human reason', () => {
    const result = validateCancellation('pending_owner_review', '  ')
    assert.equal(result.allowed, false)
    assert.match(result.error, /documented reason/i)
  })

  test('Cancellation before checkout releases slot and updates status to cancelled', () => {
    const result = validateCancellation('approved', 'Project schedule shifted to next semester.')
    assert.equal(result.allowed, true)
    assert.equal(result.newStatus, 'cancelled')
  })

  test('Post-checkout cancellation is prohibited to prevent custody evasion', () => {
    const result = validateCancellation('in_use', 'Trying to cancel checked out item.')
    assert.equal(result.allowed, false)
    assert.match(result.error, /already been checked out/i)
  })
})

// ==============================================================================
// 11. EXTENSION DURATION & CONFLICT RE-EVALUATION
// ==============================================================================
describe('11. Extension Duration & Conflict Re-Evaluation', () => {
  function evaluateExtension(bookingStartTime, currentEndTime, newEndTime, maxDurationHours, otherApprovedBookings = []) {
    const startMs = new Date(bookingStartTime).getTime()
    const newEndMs = new Date(newEndTime).getTime()
    const currentEndMs = new Date(currentEndTime).getTime()

    if (newEndMs <= currentEndMs) {
      return { allowed: false, error: 'New end time must be strictly after the current end time.' }
    }

    const totalHours = (newEndMs - startMs) / (1000 * 60 * 60)
    if (totalHours > maxDurationHours) {
      return { allowed: false, error: `Total duration (${totalHours}h) exceeds resource limit of ${maxDurationHours}h.` }
    }

    // Check conflict for extended interval [currentEndTime, newEndTime)
    const hasConflict = otherApprovedBookings.some((b) => {
      const bStart = new Date(b.start_time).getTime()
      const bEnd = new Date(b.end_time).getTime()
      return currentEndMs < bEnd && newEndMs > bStart
    })

    if (hasConflict) {
      return { allowed: false, error: 'Extension conflicts with a subsequent approved booking.' }
    }

    return { allowed: true, newEndTime }
  }

  test('Extension exceeding resource max duration cap is blocked', () => {
    // 3h original on 4h max resource, requesting 2h extension (total 5h > 4h)
    const result = evaluateExtension(
      '2026-10-28T10:00:00Z',
      '2026-10-28T13:00:00Z',
      '2026-10-28T15:00:00Z',
      4,
      []
    )
    assert.equal(result.allowed, false)
    assert.match(result.error, /exceeds resource limit/i)
  })

  test('Extension overlapping with subsequent approved booking is blocked', () => {
    // Extension from 13:00 to 14:00, but next booking starts at 13:30
    const subsequent = [{ start_time: '2026-10-28T13:30:00Z', end_time: '2026-10-28T15:30:00Z' }]
    const result = evaluateExtension(
      '2026-10-28T10:00:00Z',
      '2026-10-28T13:00:00Z',
      '2026-10-28T14:00:00Z',
      4,
      subsequent
    )
    assert.equal(result.allowed, false)
    assert.match(result.error, /conflicts with a subsequent approved booking/i)
  })

  test('Conflict-free extension within duration cap succeeds', () => {
    const result = evaluateExtension(
      '2026-10-28T10:00:00Z',
      '2026-10-28T12:00:00Z',
      '2026-10-28T13:30:00Z',
      4,
      []
    )
    assert.equal(result.allowed, true)
    assert.equal(result.newEndTime, '2026-10-28T13:30:00Z')
  })
})

// ==============================================================================
// 12. FIFO QUEUE TIE-BREAKING BY REQUEST ID
// ==============================================================================
describe('12. FIFO Queue Tie-Breaking by Request ID', () => {
  test('Identical created_at timestamps are deterministically sorted by request ID', () => {
    const sameTimestamp = '2026-10-28T14:00:00.000Z'
    const queue = [
      { id: 'uuid-ccc', created_at: sameTimestamp },
      { id: 'uuid-aaa', created_at: sameTimestamp },
      { id: 'uuid-bbb', created_at: sameTimestamp },
    ]

    const sorted = [...queue].sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id.localeCompare(b.id)
    })

    assert.equal(sorted[0].id, 'uuid-aaa')
    assert.equal(sorted[1].id, 'uuid-bbb')
    assert.equal(sorted[2].id, 'uuid-ccc')
  })
})

// ==============================================================================
// 13. RETURN CONDITION MISMATCH & INCIDENT AUTO-FLAGGING
// ==============================================================================
describe('13. Return Condition Mismatch & Incident Auto-Flagging', () => {
  function evaluateReturnCondition(initialCode, returnCode, notes) {
    const conditionRanks = { good: 1, fair: 2, damaged: 3, missing_parts: 4 }
    const initialRank = conditionRanks[initialCode] || 1
    const returnRank = conditionRanks[returnCode] || 1

    const isWorsened = returnRank > initialRank || returnCode === 'damaged' || returnCode === 'missing_parts'

    if (isWorsened) {
      return {
        status: 'return_pending',
        incidentCreated: true,
        incidentType: returnCode === 'missing_parts' ? 'custody_mismatch' : 'damage',
        incidentDescription: notes || `Condition changed from ${initialCode} to ${returnCode}.`,
      }
    }

    return {
      status: 'return_pending',
      incidentCreated: false,
    }
  }

  test('Worsened return condition (good to damaged) automatically flags an incident for review', () => {
    const result = evaluateReturnCondition('good', 'damaged', 'Cracked tripod bracket.')
    assert.equal(result.incidentCreated, true)
    assert.equal(result.incidentType, 'damage')
    assert.equal(result.status, 'return_pending')
  })

  test('Missing parts on return automatically flags custody_mismatch incident', () => {
    const result = evaluateReturnCondition('good', 'missing_parts', 'Missing power adapter.')
    assert.equal(result.incidentCreated, true)
    assert.equal(result.incidentType, 'custody_mismatch')
  })

  test('Matching condition (good to good) completes return without automatic incident', () => {
    const result = evaluateReturnCondition('good', 'good', 'Returned clean.')
    assert.equal(result.incidentCreated, false)
  })
})

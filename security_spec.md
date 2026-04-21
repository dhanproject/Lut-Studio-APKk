# Security Specification - LUT Batch Processor

## Data Invariants
1. **User Profiles**: Only the owner can read/write their own profile. Profile IDs must match the Firebase Auth UID.
2. **Jobs**: 
   - Jobs are created and managed ONLY by the server (Admin SDK).
   - Users can only read jobs where `userId` matches their UID.
   - Job IDs must be valid UUIDs.
   - Jobs must have a terminal state lock; once `status` is 'completed' or 'failed', no further updates are allowed (though users can't update anyway, this is for server-side logic and future-proofing).
   - Timestamps `createdAt` and `updatedAt` must be valid server times.

## The "Dirty Dozen" Payloads (Denial Tests)

| #  | Target Path | Operation | Payload / Condition | Expected Result | Reason |
|----|-------------|-----------|----------------------|-----------------|--------|
| 1  | /users/A    | Create    | { uid: 'B' }         | DENIED          | Identity Spoofing (UID mismatch) |
| 2  | /users/A    | Read      | As User B            | DENIED          | Privacy Violation (Not owner) |
| 3  | /jobs/J1    | Create    | As User A            | DENIED          | System Integrity (Server-only write) |
| 4  | /jobs/J1    | Update    | { status: 'done' }   | DENIED          | System Integrity (Server-only write) |
| 5  | /jobs/J1    | Read      | As User B (J1 belongs to A) | DENIED | Privacy Violation (Not owner) |
| 6  | /jobs/..    | List      | Query without userId filter | DENIED | Query Trust (Missing securing filter) |
| 7  | /jobs/J1    | Read      | Unauthenticated      | DENIED          | Authentication Required |
| 8  | /users/A    | Update    | { isAdmin: true }    | DENIED          | Privilege Escalation |
| 9  | /jobs/very-long-id... | Read | Valid Auth | DENIED | Resource Poisoning (ID size limit) |
| 10 | /jobs/J1    | Create    | { createdAt: 'old' } | DENIED          | Temporal Integrity (Must be request.time) |
| 11 | /jobs/J1    | Update    | As Admin (if supported) | ALLOWED | Admin Escape Hatch |
| 12 | /jobs/J1    | Delete    | As Owner             | DENIED          | Data Retention (Server-only delete) |

## The Test Runner (Mock Logic)
The following behaviors will be verified in `firestore.rules.test.ts`.

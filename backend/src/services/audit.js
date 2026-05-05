// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Thin write-side wrapper around audit_logs.
//
// Spec (per PR review):
//   logAudit({ action, entityType, entityId, userId, metadata, ipAddress, userAgent })
//
// Schema today (audit_logs):
//   user_id (uuid)  ← userId
//   action          ← action
//   resource        ← entityType
//   resource_id     ← entityId (cast to string, varchar 100)
//   new_value jsonb ← { ...metadata, user_agent }  -- folded since no column yet
//   ip_address      ← ipAddress
//
// Notes:
//   - userAgent is folded into new_value until audit_logs gains a user_agent column.
//   - Audit failures NEVER raise — they're logged and swallowed so the calling
//     request flow is never broken by a logging error.
//   - Existing inline INSERT INTO audit_logs in other routes are intentionally
//     left untouched — we'll consolidate in a separate PR.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { pool } = require('../db');

async function logAudit({
  action,
  entityType = null,
  entityId = null,
  userId = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
} = {}) {
  if (!action) {
    console.warn('[audit.logAudit] called without action — skipped');
    return;
  }

  let merged = null;
  if (metadata != null || userAgent) {
    const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : (metadata == null ? {} : { value: metadata });
    merged = userAgent ? { ...base, user_agent: userAgent } : base;
  }

  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, resource, resource_id, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        userId,
        String(action).slice(0, 100),
        entityType ? String(entityType).slice(0, 100) : null,
        entityId == null ? null : String(entityId).slice(0, 100),
        merged == null ? null : JSON.stringify(merged),
        ipAddress,
      ]
    );
  } catch (e) {
    console.warn('[audit.logAudit] insert failed:', e.message);
  }
}

module.exports = { logAudit };

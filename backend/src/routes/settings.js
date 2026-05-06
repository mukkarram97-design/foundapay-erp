// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Integrations settings — encrypted credential vault.
//
// SECURITY:
//   - Saved tokens are AES-256-GCM encrypted at rest (services/crypto.js).
//   - Tokens are NEVER returned to the client. GET endpoints expose only
//     a configured boolean + non-secret metadata (profile ID, environment).
//   - Test endpoint decrypts in memory, runs the call, drops the plaintext.
//   - Audit log records every save/test (action, who, when — never the token).
//
// Endpoints under /api/settings/integrations (super_admin / owner only):
//   GET  /                    list provider statuses
//   GET  /wise                wise status (configured + metadata + last test)
//   POST /wise                upsert wise creds (token + profile_id + env)
//   POST /wise/test           run live test against current creds
//   DELETE /wise              clear stored credentials
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const cryptoSvc = require('../services/crypto');
const integrationCreds = require('../services/integrationCredentials');
const wise = require('../services/wise');

const router = express.Router();
router.use(authRequired);

const SUPER_ROLES = ['super_admin', 'owner'];
function requireSuper(req, res, next) {
  if (!SUPER_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Super admin only' });
  next();
}

router.use(requireSuper);

// Cryptographic key sanity gate. If APP_ENCRYPTION_KEY is missing the vault
// can't safely store or read tokens — surface this clearly.
function requireCryptoConfigured(req, res, next) {
  if (!cryptoSvc.isConfigured()) {
    return res.status(503).json({
      error: 'APP_ENCRYPTION_KEY missing on server. Set it in .env (min 16 chars), then pm2 restart.',
    });
  }
  next();
}

// Sanitize Wise metadata for client return (no token here ever).
function publicWiseStatus(status) {
  return {
    configured: !!status?.configured,
    metadata: {
      profile_id: status?.metadata?.profile_id || null,
      environment: status?.metadata?.environment || 'sandbox',
    },
    configuredAt: status?.configuredAt || null,
    lastTest: status?.lastTest || null,
  };
}

// ━━━ GET / — overview of every supported provider ━━━
router.get('/', async (req, res) => {
  try {
    const wiseS = await integrationCreds.getStatus('wise');
    res.json({
      cryptoConfigured: cryptoSvc.isConfigured(),
      providers: {
        wise: publicWiseStatus(wiseS),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ GET /wise ━━━
router.get('/wise', async (req, res) => {
  try {
    const s = await integrationCreds.getStatus('wise');
    res.json(publicWiseStatus(s));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /wise — upsert Wise creds ━━━
// Body: { token?, profile_id?, environment? }
//   - If token is provided, it's encrypted and stored. If empty string, cleared.
//   - profile_id and environment go into metadata (non-secret).
router.post('/wise', requireCryptoConfigured, async (req, res) => {
  try {
    const { token, profile_id, environment } = req.body || {};
    if (token === undefined && profile_id === undefined && environment === undefined) {
      return res.status(400).json({ error: 'No fields provided' });
    }
    if (environment && !['live', 'sandbox'].includes(environment)) {
      return res.status(400).json({ error: 'environment must be live | sandbox' });
    }

    // Build metadata object preserving existing values for keys not touched
    const cur = await integrationCreds.getStatus('wise');
    const metadata = { ...cur.metadata };
    if (profile_id !== undefined) metadata.profile_id = String(profile_id || '').trim() || null;
    if (environment !== undefined) metadata.environment = environment;

    await integrationCreds.setCredentials('wise', {
      token: token === undefined ? undefined : String(token || ''),
      metadata,
      userId: req.user.id,
    });
    wise.invalidateCache();

    await logAudit({
      action: 'integrations.wise_saved',
      entityType: 'integration_credentials', entityId: 'wise',
      userId: req.user.id,
      metadata: {
        token_changed: token !== undefined,
        token_cleared: token === '',
        profile_id_changed: profile_id !== undefined,
        environment: metadata.environment,
      },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    const s = await integrationCreds.getStatus('wise');
    res.json(publicWiseStatus(s));
  } catch (err) {
    console.error('[settings wise save]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ POST /wise/test ━━━
router.post('/wise/test', requireCryptoConfigured, async (req, res) => {
  try {
    const start = Date.now();
    let ok = false, message = '';
    try {
      const balances = await wise.getBalances();
      ok = true;
      const summary = Array.isArray(balances)
        ? balances.map((a) => `${a.currency || a.amount?.currency}: ${a.amount?.value ?? a.amount}`).join(', ')
        : '(no balances returned)';
      message = `Connected (${Date.now() - start}ms). ${summary}`;
    } catch (e) {
      ok = false;
      message = e.message || 'Wise call failed';
    }

    await integrationCreds.recordTest('wise', { ok, message });
    await logAudit({
      action: 'integrations.wise_tested',
      entityType: 'integration_credentials', entityId: 'wise',
      userId: req.user.id,
      metadata: { ok, message: message.slice(0, 200), latency: Date.now() - start },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    if (ok) res.json({ ok: true, message, latency: Date.now() - start });
    else    res.status(400).json({ ok: false, error: message });
  } catch (err) {
    console.error('[settings wise test]', err);
    res.status(500).json({ error: err.message });
  }
});

// ━━━ DELETE /wise ━━━
router.delete('/wise', async (req, res) => {
  try {
    await integrationCreds.setCredentials('wise', { token: '', userId: req.user.id });
    wise.invalidateCache();
    await logAudit({
      action: 'integrations.wise_cleared',
      entityType: 'integration_credentials', entityId: 'wise',
      userId: req.user.id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

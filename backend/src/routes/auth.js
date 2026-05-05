const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { pool } = require('../db');
const { signToken, authRequired } = require('../middleware/auth');
const email = require('../services/email');

const router = express.Router();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email: emailIn, password } = req.body || {};
  if (!emailIn || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const r = await pool.query(
      `SELECT id, email, name, role, password_hash, is_active, client_id, login_count
         FROM users WHERE email = $1`,
      [emailIn.toLowerCase()]
    );
    const user = r.rows[0];

    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = req.headers['user-agent'] || null;

    if (!user || !user.is_active) {
      await pool.query(
        `INSERT INTO login_history (user_id, ip_address, user_agent, status)
         VALUES (NULL, $1, $2, 'failed_no_user')`,
        [ip, ua]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await pool.query(
        `INSERT INTO login_history (user_id, ip_address, user_agent, status)
         VALUES ($1, $2, $3, 'failed_password')`,
        [user.id, ip, ua]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await pool.query(
      `UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO login_history (user_id, ip_address, user_agent, status)
       VALUES ($1, $2, $3, 'success')`,
      [user.id, ip, ua]
    );

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        client_id: user.client_id,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', authRequired, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', authRequired, async (req, res) => {
  // Stateless JWT — client just discards. We log it.
  await pool.query(
    `INSERT INTO login_history (user_id, ip_address, user_agent, status)
     VALUES ($1, $2, $3, 'logout')`,
    [req.user.id, req.ip || null, req.headers['user-agent'] || null]
  );
  res.json({ ok: true });
});

// ── POST /api/auth/forgot-password ───────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email: emailIn } = req.body || {};
  // Always reply with the same message — never reveal whether email exists
  const genericReply = { message: 'If this email is registered, a reset link has been sent.' };

  if (!emailIn) return res.status(400).json({ error: 'Email required' });

  try {
    const r = await pool.query(
      `SELECT id, email, name FROM users WHERE email = $1 AND is_active = true`,
      [emailIn.toLowerCase()]
    );
    if (!r.rows.length) return res.json(genericReply);

    const user = r.rows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at, used)
       VALUES ($1, $2, $3, false)`,
      [user.id, tokenHash, expires]
    );

    // Send email (or log to console if MAIL_USER not set)
    email.sendPasswordReset(user.email, user.name, rawToken).catch((e) => {
      console.error('[forgot-password] email send error:', e.message);
    });

    return res.json(genericReply);
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    return res.json(genericReply);
  }
});

// ── GET /api/auth/validate-reset-token ───────────────────────
router.get('/validate-reset-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ valid: false });
  try {
    const tokenHash = sha256(token);
    const r = await pool.query(
      `SELECT prt.user_id, prt.expires_at, prt.used, u.email
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token = $1`,
      [tokenHash]
    );
    if (!r.rows.length) return res.json({ valid: false });
    const t = r.rows[0];
    if (t.used) return res.json({ valid: false, reason: 'used' });
    if (new Date(t.expires_at) < new Date()) return res.json({ valid: false, reason: 'expired' });

    // Mask email: a***@b***.com
    const [local, domain] = t.email.split('@');
    const masked = `${local.slice(0, 1)}***@${domain.replace(/^[^.]+/, (m) => m.slice(0, 1) + '***')}`;
    res.json({ valid: true, email: masked });
  } catch (err) {
    console.error('[auth/validate-reset-token]', err);
    res.json({ valid: false });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const tokenHash = sha256(token);
    const r = await pool.query(
      `SELECT id, user_id, expires_at, used
         FROM password_reset_tokens
        WHERE token = $1`,
      [tokenHash]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Invalid token' });
    const t = r.rows[0];
    if (t.used) return res.status(400).json({ error: 'Token already used' });
    if (new Date(t.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, t.user_id]);
    await pool.query(`UPDATE password_reset_tokens SET used = true WHERE id = $1`, [t.id]);

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

module.exports = router;

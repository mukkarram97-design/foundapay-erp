const jwt = require('jsonwebtoken');
const { pool } = require('../db');

function signToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    client_id: user.client_id || null,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
}

async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const r = await pool.query(
      'SELECT id, email, name, role, client_id, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (!r.rows.length || !r.rows[0].is_active) {
      return res.status(401).json({ error: 'User not active' });
    }
    req.user = r.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Enforce that a client_user only acts on their own client_id.
// Looks for :id or req.body.client_id; if user.role === 'client_user', it must match user.client_id.
function clientScoped(req, res, next) {
  if (req.user.role !== 'client_user') return next();
  const targetId = req.params.id || req.body.client_id || req.query.client_id;
  if (targetId && targetId !== req.user.client_id) {
    return res.status(403).json({ error: 'Forbidden — outside client scope' });
  }
  next();
}

module.exports = { signToken, authRequired, requireRole, clientScoped };

const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// GET /api/global-search?q=<query>
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ transactions: [], clients: [], entities: [], cards: [] });

    const isClientUser = req.user.role === 'client_user';
    const clientFilter = isClientUser ? `AND client_id = '${req.user.client_id}'` : '';

    const like = `%${q}%`;
    const isInt = /^\d+$/.test(q);

    const [txs, cls, ents, cards] = await Promise.all([
      pool.query(`
        SELECT t.id, t.date_received, t.type, t.counterparty_name, t.gross_amount, t.status, t.client_id
          FROM transactions t
         WHERE 1=1 ${clientFilter}
           AND (t.counterparty_name ILIKE $1
             OR t.notes ILIKE $1
             ${isInt ? `OR t.id = ${parseInt(q, 10)}` : ''})
         ORDER BY t.date_received DESC, t.id DESC
         LIMIT 5
      `, [like]),
      isClientUser ? { rows: [] } :
        pool.query(`SELECT id, name, balance_owed, status FROM clients
                    WHERE name ILIKE $1 OR company_name ILIKE $1 LIMIT 5`, [like]),
      isClientUser ? { rows: [] } :
        pool.query(`SELECT id, legal_name, owner_name FROM entities
                    WHERE legal_name ILIKE $1 OR owner_name ILIKE $1 LIMIT 3`, [like]),
      isClientUser ? { rows: [] } :
        pool.query(`SELECT id, nickname, last4, bank_name FROM cards
                    WHERE nickname ILIKE $1 OR last4 = $2 OR bank_name ILIKE $1 LIMIT 3`,
                   [like, q.slice(-4)]),
    ]);

    res.json({
      transactions: txs.rows,
      clients: cls.rows,
      entities: ents.rows,
      cards: cards.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

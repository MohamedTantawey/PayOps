const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const db = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const PRICES = { starter: 900, pro: 2900, business: 9900 };

const DECLINED = {
  4000000000000002: 'Card declined',
  4000000000009995: 'Insufficient funds',
};

function isValidCard(number) {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return number.length >= 13 && number.length <= 19 && sum % 10 === 0;
}

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ app: 'ok', database: 'ok' });
  } catch {
    res.status(500).json({ app: 'ok', database: 'down' });
  }
});

app.get('/api/payments', async (req, res) => {
  const result = await db.query('SELECT * FROM payments ORDER BY id DESC LIMIT 20');
  res.json(result.rows);
});

app.post('/api/payments', async (req, res) => {
  const { name, plan, cardNumber, expiry, cvc } = req.body;
  const number = String(cardNumber).replace(/\s/g, '');
  const [month, year] = String(expiry).split('/').map(Number);

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!PRICES[plan]) return res.status(400).json({ error: 'Choose a plan' });
  if (!/^\d+$/.test(number) || !isValidCard(number)) return res.status(400).json({ error: 'Invalid card number' });
  if (!month || month > 12 || new Date(2000 + year, month) < new Date()) return res.status(400).json({ error: 'Card expired' });
  if (!/^\d{3,4}$/.test(cvc)) return res.status(400).json({ error: 'Invalid CVC' });

  const status = DECLINED[number] || 'Paid';

  const result = await db.query(
    'INSERT INTO payments (name, plan, amount, card_last4, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, plan, PRICES[plan], number.slice(-4), status],
  );

  console.log(`Payment #${result.rows[0].id}: ${status} (card ****${number.slice(-4)})`);
  res.json(result.rows[0]);
});

app.listen(3000, () => console.log('PayOps running on port 3000'));

process.on('SIGTERM', () => process.exit(0));

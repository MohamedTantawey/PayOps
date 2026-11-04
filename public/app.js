const form = document.getElementById('pay-form');
const message = document.getElementById('message');
const table = document.getElementById('payments');

const safe = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function loadPayments() {
  const res = await fetch('/api/payments');
  const payments = await res.json();
  table.innerHTML = payments
    .map(
      (p) => `<tr>
        <td>${p.id}</td>
        <td>${safe(p.name)}</td>
        <td>${p.plan}</td>
        <td>$${(p.amount / 100).toFixed(2)}</td>
        <td>**** ${p.card_last4}</td>
        <td class="${p.status === 'Paid' ? 'ok' : 'fail'}">${p.status}</td>
      </tr>`,
    )
    .join('');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));

  const res = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();

  if (result.error) {
    message.textContent = result.error;
    message.className = 'fail';
  } else if (result.status === 'Paid') {
    message.textContent = `Payment successful! Receipt #${result.id}`;
    message.className = 'ok';
    form.reset();
  } else {
    message.textContent = `Payment failed: ${result.status}`;
    message.className = 'fail';
  }
  loadPayments();
});

loadPayments();

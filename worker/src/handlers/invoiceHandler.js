const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../../../backend/src/shared/config');
const db = require('../../../backend/src/shared/db');
const logger = require('../../../backend/src/shared/logger');

function formatMoney(amountCents, currency) {
  const val = (Number(amountCents || 0) / 100).toFixed(2);
  return `${String(currency || 'USD').toUpperCase()} ${val}`;
}

function renderInvoicePdf({ invoice, intent, merchantName, outputPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outputPath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    doc.fontSize(22).fillColor('#0f172a').text('PayOps', { continued: true });
    doc.fontSize(12).fillColor('#64748b').text('  Payment Receipt & Tax Invoice', { align: 'right' });
    doc.moveDown(1.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#0f172a');
    doc.text(`Invoice Number: ${invoice.invoice_number}`);
    doc.text(`Environment Mode: ${String(invoice.env_mode).toUpperCase()}`);
    doc.text(`Issued Date: ${new Date().toISOString().slice(0, 10)}`);
    doc.text(`Merchant: ${merchantName || invoice.merchant_id}`);
    doc.text(`Customer Email: ${invoice.customer_email || 'N/A'}`);
    if (intent) {
      doc.text(`Payment Intent ID: ${intent.id}`);
      doc.text(`Payment Status: ${String(intent.status).toUpperCase()}`);
    }

    doc.moveDown(1.5);
    doc.fontSize(13).fillColor('#0f172a').text('Line Summary', { underline: true });
    doc.moveDown(0.5);

    const description = intent?.description || 'PayOps Processed Merchant Settlement';
    doc.fontSize(11).fillColor('#334155').text(`Description: ${description}`);
    doc.moveDown(0.5);
    doc.fontSize(15).fillColor('#0f172a').text(`Total Paid: ${formatMoney(invoice.amount_cents, invoice.currency)}`);

    doc.moveDown(3);
    doc.fontSize(9).fillColor('#94a3b8').text(
      'Generated asynchronously by PayOps Worker Engine. Cardholder PAN/CVV isolated in PayOps Vault.',
      { align: 'center' }
    );

    doc.end();
  });
}

async function generateInvoicePdf({ invoiceId, intentId, merchantId, envMode }) {
  const invoice = await db.queryOne(
    `SELECT * FROM invoices WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
    [invoiceId, merchantId, envMode]
  );

  if (!invoice) {
    logger.warn({ invoiceId }, 'Invoice row not found for PDF generation');
    return null;
  }

  try {
    const intent = intentId
      ? await db.queryOne(`SELECT * FROM payment_intents WHERE id = $1`, [intentId])
      : null;
    const merchant = await db.queryOne(`SELECT name FROM merchants WHERE id = $1`, [merchantId]);

    const storageDir = config.storage.localStoragePath;
    fs.mkdirSync(storageDir, { recursive: true });

    const filePath = path.join(storageDir, `${invoice.invoice_number}.pdf`);
    await renderInvoicePdf({
      invoice,
      intent,
      merchantName: merchant?.name,
      outputPath: filePath,
    });

    const stats = fs.statSync(filePath);

    const updated = await db.queryOne(
      `UPDATE invoices
       SET status = 'ready',
           object_key = $1,
           storage_driver = 'local',
           file_size_bytes = $2,
           generated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [filePath, stats.size, invoice.id]
    );

    logger.info({ invoiceId: invoice.id, filePath, sizeBytes: stats.size }, 'Generated PDF invoice');
    return updated;
  } catch (err) {
    logger.error({ err: err.message, invoiceId }, 'Invoice PDF generation failed');
    await db.query(`UPDATE invoices SET status = 'failed' WHERE id = $1`, [invoice.id]).catch(() => {});
    throw err;
  }
}

module.exports = { generateInvoicePdf };

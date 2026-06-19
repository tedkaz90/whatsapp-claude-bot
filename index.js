'use strict';

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const fsp     = fs.promises;
const Redis   = require('ioredis');
require('dotenv').config();

// ─── Constants ───────────────────────────────────────────────────────────────

const LOG_FILE     = '/data/conversations.json';
const ARCHIVE_FILE = '/data/conversations-archive.json';
const MAX_HISTORY  = 20;
const HISTORY_TTL  = 7 * 24 * 60 * 60; // 7 days in seconds

const SYSTEM_PROMPT = `You are the customer-facing bot for Fresh Quality Produce and L.A. Vegetable — a vertically integrated wholesale distributor, grower, and financier for farmers, based in Los Angeles. We've been in business for 18 years and own our own farms in Mexico, growing Persian cucumbers and Roma tomatoes ourselves. One vendor, field to dock. Both fruit and vegetables on one truck.

Your job is to be helpful, straight-talking, and quick. These are busy store owners and buyers, drivers, vendors, and visitors. Get to the point.

LANGUAGE: Detect the language the customer writes in and respond in that same language. Supported: English, Spanish, Arabic, Farsi, Armenian. Default to English if unclear.

HOURS:
- Warehouse/receiving: Mon-Fri 12:30AM to 4PM, Saturday 12:30AM to 2PM, Sunday CLOSED
- Sales team: 3AM to 12PM at the office, then by cell after 12PM
- Accounting: 8AM to 4PM
- Special requests after hours: call 213-891-1122

WHAT WE CARRY: Full range of fresh fruits and vegetables including organic options. Key specialty items include Persian cucumbers, Roma tomatoes, grape tomatoes, cluster tomatoes, bell peppers, avocado, pomegranate, stone fruit, melons, grapes, berries, citrus, mangoes, garlic, ginger, onions, potatoes, mushrooms, yam, walnut, and more.

WHO WE SERVE: Independent ethnic supermarkets, specialty grocery stores, produce markets, caterers, catering companies, and distributors across greater Los Angeles, San Diego, Orange County, San Fernando Valley, Santa Clarita, Simi Valley, Glendale, Santa Monica, and surrounding regions.

DELIVERY & PICKUP: First come, first served. No appointment needed. All drivers check in and sign in at the warehouse. A delivery charge may apply on smaller orders — reflected on invoice, set by the sales team based on order size and location.

CONTACT: Phone 213-891-1122, Email sales@freshqp.com

NEVER answer questions about: pricing, product availability, order status, delivery ETA, account terms, credit, or payment. Always route these to the sales team: 213-891-1122 or sales@freshqp.com.

GREETING: Only on the very first message in a conversation say exactly: 'Hey, this is Fresh Quality Produce & L.A. Vegetable. What can we help you with today?' Do NOT repeat this greeting in subsequent messages in the same thread.

CHECK-IN & SITE GUIDE: If anyone asks about check-in, parking, dock locations, where to go, how to get in, or directions on site, give them this information:
- MAIN ENTRANCE (check in here first): 2010-2016 Violet St. All visitors, drivers, and employees must sign in at the check-in desk before anything else.
- SHIPPING & PICKUPS: Main entrance, doors D5-D8 (2010-2016 Violet St, west end).
- RECEIVING & DELIVERIES: Doors D1-D4 (2038-2042 Violet St, east end toward Santa Fe Ave).
- PARKING: 902 Mateo St. Visitors and employees only. NO semi trucks in the parking lot.
- Our listed address is 2022 Violet St but the check-in entrance is at 2010-2016 Violet St.
Respond in the language the person is writing in. For Spanish speakers, use the Spanish equivalents naturally.

INBOUND DELIVERY & PICKUP COORDINATION: If someone texts to let us know they are bringing a delivery, making a pickup, or coordinating an arrival — whether they are a driver, vendor, supplier, or customer — collect the following: their name, their company, what they are bringing or picking up, and their expected arrival time. Once you have all of that, confirm it back to them and say: 'I've notified the team about your arrival. See you soon.' Then add this tag on its own line at the very end: [SEND_ARRIVAL]

ORDER INTAKE: If a customer indicates they want to place an order, have a natural back-and-forth conversation to collect the following six things: their name, their company name, their phone number, their email address, what they want to order (items and quantities), and whether they need delivery or pickup. Do not ask for all of this at once — let the conversation flow naturally. Start by asking for their name. Then ask for their company. Weave in the remaining details as the chat progresses.

Once you have all six pieces of information, confirm the order back to them in a clean summary and say: 'All orders are subject to daily pricing and availability. Our sales team will call you in the morning to confirm.'

TONE: Straight-talking and family-run. We don't oversell. Answer the question. If it needs to go to sales, say so and move on. No filler, no corporate language.

FALLBACK: If you don't know, say: 'I don't have that info handy. Call us at 213-891-1122 or email sales@freshqp.com and we'll take care of you.'`;

// ─── App + Redis setup ────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('connect',    () => console.log('Redis connected.'));
redis.on('error', (e) => console.error('Redis error:', e.message));

// ─── In-memory dedup ─────────────────────────────────────────────────────────

const processedMessageIds = new Set();

// ─── Conversation history helpers (Redis-backed) ──────────────────────────────

async function getHistory(phone) {
  const data = await redis.get(`history:${phone}`);
  return data ? JSON.parse(data) : [];
}

async function appendToHistory(phone, role, content) {
  const history = await getHistory(phone);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  await redis.setex(`history:${phone}`, HISTORY_TTL, JSON.stringify(history));
}

async function hasOrderBeenSent(phone) {
  return (await redis.exists(`order_sent:${phone}`)) === 1;
}

async function markOrderSent(phone) {
  await redis.setex(`order_sent:${phone}`, 24 * 60 * 60, '1');
}

// ─── Disk logging (async) ────────────────────────────────────────────────────

async function loadLog() {
  try {
    const data = await fsp.readFile(LOG_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveLog(entries) {
  try {
    await fsp.writeFile(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    console.error('Log save error:', e.message);
  }
}

async function archiveEntries(entries) {
  try {
    let archive = [];
    try {
      const data = await fsp.readFile(ARCHIVE_FILE, 'utf8');
      archive = JSON.parse(data);
    } catch {
      // Archive doesn't exist yet — start fresh
    }
    archive = archive.concat(entries);
    await fsp.writeFile(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  } catch (e) {
    console.error('Archive save error:', e.message);
  }
}

async function logConversation(from, message, response) {
  const entries = await loadLog();
  entries.push({
    timestamp: new Date().toISOString(),
    phone:     from,
    message,
    response
  });
  await saveLog(entries);
}

// ─── Order email ──────────────────────────────────────────────────────────────

function buildOrderEmail(phone, conversationHistory) {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  let thread = '';
  conversationHistory.forEach(msg => {
    const label = msg.role === 'user' ? 'Customer' : 'Bot';
    thread += `<p><strong>${label}:</strong> ${msg.content}</p>`;
  });

  return `
    <h2>New WhatsApp Order — Fresh QP Bot</h2>
    <p><strong>Received:</strong> ${timestamp} (Pacific)</p>
    <p><strong>Customer WhatsApp:</strong> +${phone}</p>
    <hr>
    <h3>Full Conversation</h3>
    ${thread}
    <hr>
    <p><em>All orders subject to daily pricing and availability. Call customer to confirm.</em></p>
  `;
}

// ─── Arrival notification email ──────────────────────────────────────────────

function buildArrivalEmail(phone, conversationHistory) {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  let thread = '';
  conversationHistory.forEach(msg => {
    const label = msg.role === 'user' ? 'Person' : 'Bot';
    thread += `<p><strong>${label}:</strong> ${msg.content}</p>`;
  });

  return `
    <h2>Inbound Arrival Notification — Fresh QP Bot</h2>
    <p><strong>Received:</strong> ${timestamp} (Pacific)</p>
    <p><strong>WhatsApp:</strong> +${phone}</p>
    <hr>
    <h3>Full Conversation</h3>
    ${thread}
    <hr>
    <p><em>Someone is coordinating an arrival. See details above.</em></p>
  `;
}

// ─── Email via Resend ────────────────────────────────────────────────────────

async function sendEmail(to, subject, html, attachments = []) {
  const body = {
    from:    'Fresh QP Bot <ted@freshqp.com>',
    to:      [to],
    subject,
    html,
  };
  if (attachments.length > 0) {
    body.attachments = attachments;
  }
  const resp = await axios.post(
    'https://api.resend.com/emails',
    body,
    {
      headers: {
        Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return resp.status;
}

// ─── Daily summary + nightly archive backup ───────────────────────────────────

function buildSummaryEmail(entries) {
  const reportDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });

  let emailBody  = '<h2>Fresh QP WhatsApp Bot — Daily Summary</h2>';
  emailBody += `<p><strong>Conversations for:</strong> ${reportDate} (midnight to midnight, Pacific)</p>`;
  emailBody += `<p><strong>Total conversations:</strong> ${entries.length}</p><hr>`;

  entries.forEach((entry, i) => {
    const time = new Date(entry.timestamp)
      .toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    emailBody += `<p><strong>#${i + 1} — ${time}</strong><br>`;
    emailBody += `Phone: ${entry.phone}<br>`;
    emailBody += `Message: ${entry.message}<br>`;
    emailBody += `Bot response: ${entry.response}</p><hr>`;
  });

  return { today: reportDate, html: emailBody };
}

async function sendArchiveBackup() {
  try {
    const data = await fsp.readFile(ARCHIVE_FILE, 'utf8');
    const base64Content = Buffer.from(data).toString('base64');
    const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
    await sendEmail(
      'ted@freshqp.com',
      `Fresh QP Bot — Archive Backup ${date}`,
      '<p>Nightly archive backup attached.</p>',
      [{ filename: `conversations-archive-${date.replace(/\//g, '-')}.json`, content: base64Content }]
    );
    console.log('Archive backup email sent.');
  } catch (e) {
    console.log('Archive backup skipped (file may not exist yet):', e.message);
  }
}

async function sendDailySummary() {
  const entries = await loadLog();
  if (entries.length === 0) {
    console.log('No conversations to report.');
  } else {
    const summary = buildSummaryEmail(entries);
    try {
      const status = await sendEmail(
        'ted@freshqp.com',
        `WhatsApp Bot Daily Summary — ${summary.today}`,
        summary.html
      );
      console.log(`Daily summary sent. HTTP ${status}.`);
      await archiveEntries(entries);
      await saveLog([]);
    } catch (error) {
      const detail = error.response
        ? `${error.response.status} ${JSON.stringify(error.response.data)}`
        : error.message;
      console.error(`Email send FAILED — keeping conversations for next run. Resend said: ${detail}`);
    }
  }
  await sendArchiveBackup();
}

// ─── Scheduler (DST-aware midnight Pacific) ───────────────────────────────────

function msUntilNextPacificMidnight() {
  const now        = new Date();
  const pacificStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const pacificNow = new Date(pacificStr);
  const nextMidnight = new Date(pacificNow);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() - pacificNow.getTime();
}

function scheduleDailySummary() {
  const ms = msUntilNextPacificMidnight();
  console.log(`Next daily summary in ${Math.round(ms / 60000)} min (fires at midnight Pacific).`);
  setTimeout(async () => {
    await sendDailySummary();
    scheduleDailySummary();
  }, ms);
}

// ─── Claude API ──────────────────────────────────────────────────────────────

async function askClaude(phone, userMessage) {
  await appendToHistory(phone, 'user', userMessage);
  const history = await getHistory(phone);

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-haiku-4-5',
        max_tokens: 1024,
        system:     SYSTEM_PROMPT,
        messages:   history
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json'
        }
      }
    );

    let reply = response.data.content[0].text;

    const cleanReply = reply
      .replace(/\[SEND_ORDER\]/g, '')
      .replace(/\[SEND_ARRIVAL\]/g, '')
      .trim();

    // Order trigger — phrase-based, does not rely on Haiku appending tag
    const orderTriggered =
      reply.includes('[SEND_ORDER]') ||
      reply.includes('sales team will call you in the morning to confirm');

    // Arrival trigger
    const arrivalTriggered =
      reply.includes('[SEND_ARRIVAL]') ||
      reply.includes("I've notified the team about your arrival");

    await appendToHistory(phone, 'assistant', cleanReply);

    if (orderTriggered && !(await hasOrderBeenSent(phone))) {
      await markOrderSent(phone);
      const currentHistory = await getHistory(phone);
      const orderHtml = buildOrderEmail(phone, currentHistory);
      sendEmail('sales@freshqp.com', `New WhatsApp Order — ${phone}`, orderHtml)
        .then(status => console.log(`Order email sent for ${phone}. HTTP ${status}.`))
        .catch(err => console.error(`Order email FAILED for ${phone}:`, err.message));
    }

    if (arrivalTriggered) {
      const currentHistory = await getHistory(phone);
      const arrivalHtml = buildArrivalEmail(phone, currentHistory);
      sendEmail('sales@freshqp.com', `Inbound Arrival Notice — ${phone}`, arrivalHtml)
        .then(status => console.log(`Arrival email sent for ${phone}. HTTP ${status}.`))
        .catch(err => console.error(`Arrival email FAILED for ${phone}:`, err.message));
    }

    return cleanReply;
  } catch (error) {
    console.error('Claude API error:', error.message);
    return 'Sorry, I could not process your request.';
  }
}

// ─── WhatsApp sender ──────────────────────────────────────────────────────────

async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization:  `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error(`WhatsApp send error to ${to}:`, error.response?.data || error.message);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified.');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Test email
app.get('/test-email', async (req, res) => {
  if (req.query.key !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  try {
    const status = await sendEmail(
      'ted@freshqp.com',
      `Fresh QP Bot — Test Email ${new Date().toISOString()}`,
      '<p>Test email from Fresh QP bot. Resend is working.</p>'
    );
    res.status(200).send(`Test email sent via Resend. HTTP ${status}.`);
  } catch (error) {
    const detail = error.response
      ? `${error.response.status} ${JSON.stringify(error.response.data)}`
      : error.message;
    res.status(500).send(`Test email FAILED: ${detail}`);
  }
});

// Conversation log viewer
// GET /logs?key=<WEBHOOK_VERIFY_TOKEN>&file=archive
app.get('/logs', async (req, res) => {
  if (req.query.key !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  try {
    const useArchive = req.query.file === 'archive';
    const filePath   = useArchive ? ARCHIVE_FILE : LOG_FILE;
    const entries    = JSON.parse(await fsp.readFile(filePath, 'utf8'));

    // Optional: filter by phone
    const phone  = req.query.phone;
    const filtered = phone
      ? entries.filter(e => e.phone === phone)
      : entries;

    // Build a simple HTML page — readable in browser, no dependencies
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Fresh QP Bot Logs</title>
<style>
  body { font-family: monospace; background: #111; color: #eee; padding: 24px; }
  h1 { color: #f90; }
  .entry { border: 1px solid #333; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
  .meta { color: #888; font-size: 12px; margin-bottom: 8px; }
  .msg { color: #aef; }
  .bot { color: #cfc; }
  .label { font-weight: bold; }
</style></head><body>
<h1>Fresh QP Bot — ${useArchive ? 'Archive' : 'Today\'s'} Logs</h1>
<p style="color:#888">${filtered.length} conversation${filtered.length !== 1 ? 's' : ''}${phone ? ` for ${phone}` : ''}</p>`;

    filtered.forEach((entry, i) => {
      const time = new Date(entry.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
      html += `<div class="entry">
  <div class="meta">#${i + 1} &nbsp;|&nbsp; ${time} &nbsp;|&nbsp; ${entry.phone}</div>
  <div class="msg"><span class="label">Customer:</span> ${entry.message}</div>
  <div class="bot"><span class="label">Bot:</span> ${entry.response}</div>
</div>`;
    });

    html += '</body></html>';
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return res.status(200).send('No log file yet — no conversations recorded.');
    }
    res.status(500).send(`Log read error: ${e.message}`);
  }
});

// Reset order-sent flag for a phone number (testing only)
// GET /reset-order?key=<WEBHOOK_VERIFY_TOKEN>&phone=<phone>
app.get('/reset-order', async (req, res) => {
  if (req.query.key !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  const phone = req.query.phone;
  if (!phone) return res.status(400).send('Missing phone param');
  await redis.del(`order_sent:${phone}`);
  res.status(200).send(`order_sent key cleared for ${phone}`);
});

// Inbound WhatsApp messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body    = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || message.type !== 'text') return;

    const messageId = message.id;

    if (processedMessageIds.has(messageId)) {
      console.log(`Duplicate message ignored: ${messageId}`);
      return;
    }
    processedMessageIds.add(messageId);

    if (processedMessageIds.size > 1000) {
      const first = processedMessageIds.values().next().value;
      processedMessageIds.delete(first);
    }

    const from = message.from;
    const text = message.text.body;

    console.log(`Message from ${from}: ${text}`);

    const claudeResponse = await askClaude(from, text);
    await sendWhatsAppMessage(from, claudeResponse);

    logConversation(from, text, claudeResponse).catch(e =>
      console.error('Log write error:', e.message)
    );
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

scheduleDailySummary();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

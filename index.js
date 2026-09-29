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

const SYSTEM_PROMPT = `You are the WhatsApp bot for Fresh Quality Produce and L.A. Vegetable, wholesale produce distributors at 2022 Violet St, Los Angeles. You text like someone who has been in produce for 20 years: straight, friendly, busy, specific. Never like a marketing agency. If a buyer read your reply out loud, it should sound like one of us on the phone.

WHO WE ARE (these facts are real, use them, never add to them)
- 20+ years in business
- PrimusGFS certified
- 300+ accounts across 10+ states
- We grow our own Persian cucumbers and Roma tomatoes on our farms in Mexico, and we finance growers.
- Fresh Quality Produce (FQP) is fruit and specialty: Persian cucumbers, Roma and cluster tomatoes, oranges, lemons, and hard to source items at real volume. The promise: the same quality every load.
- L.A. Vegetable (LAV) is the vegetable line: cilantro, green onion, celery, cauliflower, green beans and 100+ other commodities. The promise: one call covers the whole vegetable order.
- This WhatsApp line covers both companies, so a customer can order from both in one chat. When you talk about what we do, keep each company's items and promise with that company. Don't blend them into one brand.

HOW TO WRITE
1. Get to the point. The first sentence answers the question.
2. Short. Most replies are 1 to 3 short lines. Go longer only for hours, check in directions, an order summary, or a sourcing request summary.
3. Friendly, not formal. "Hey Mike" beats "Dear customer."
4. No dashes of any kind. No em dashes, no en dashes, no hyphens between words, times or days. Use a period, a comma, "to", or a new sentence.
5. Specific beats pretty. "Persian cukes out of Nogales" beats "premium quality cucumbers."
6. One ask per message. End with the one thing you need from them next.
7. Never overpromise. No "always the freshest", no "guaranteed lowest price", no delivery times. Promise only what we control: consistency, reliable delivery, straight answers.
8. Never say anything negative about a competitor, grower or customer.
9. Never type bank, wire or ACH details. If asked, say our office sends the approved form and give sales@freshqp.com.
10. Words we use: straight, reliable, consistent, on the floor, in stock, ready to ship, we've got you, let me know, give us a shot.
Words we never use: synergy, solutions, leverage, world class, best in class, premium quality, "we are pleased to inform you", "please do not hesitate to contact us", "as per my last email".
11. Trade terms (cs, lb, FOB, pack out, cluster, Roma, Persian) are fine with buyers and drivers. With a consumer or someone new to produce, use plain words.
12. Never cut corners on facts. Write times in full (4:00 PM, never 4 PM or 4pm). Write days in full (Monday to Friday, never Mon-Fri). Copy hours, addresses and phone numbers exactly as written below.
13. WhatsApp formatting: *single asterisks* for bold labels is fine. No headers, no tables.

LANGUAGE
Reply in English or Spanish, matching the customer. Spanish means natural Mexican Spanish, casual and direct, the way you'd talk to a customer at the dock. Not formal, not translated word for word. Keep all accents. If someone writes in any other language, reply in simple English and let them know we can help in English or Spanish.

GREETING
Only in your very first reply in a conversation, start with: "Hey, this is Fresh Quality Produce & L.A. Vegetable." Then answer their message in the same reply. If their first message is just a hello, follow with: "What can we help you with today?" In Spanish: "Hola, le habla Fresh Quality Produce y L.A. Vegetable." Never repeat the greeting later in the thread.

HOURS (copy exactly, never shorten)
*Warehouse and receiving:* Monday to Friday, 1:30 AM to 4:00 PM. Saturday, 1:30 AM to 2:00 PM. Sunday closed.
*Office and accounting:* Monday to Friday, 8:00 AM to 4:00 PM.
*Sales team:* 3:00 AM to 12:00 PM at the office, by cell after 12:00 PM.
*After hours special requests:* call 213 891 1122.
In Spanish, translate the labels and days and keep the same time format.

CONTACT
Phone 213 891 1122. Email sales@freshqp.com.

WHO WE SERVE
Independent and ethnic supermarkets, specialty grocers, produce markets, restaurants, caterers and distributors across Los Angeles, Orange County, San Diego, the San Fernando Valley, Santa Clarita, Simi Valley, Glendale, Santa Monica and surrounding areas, plus accounts in 10+ states.

WHAT WE HANDLE
This is the range we carry across both companies. It is NOT today's stock. Use it to tell people whether something is in our line. Never use it to confirm something is available today, or how much we have.
FQP fruit and specialty: apples, pears, peaches, nectarines, plums, pluots, plumcots, apriums, apricots, cherries, red, green and specialty grapes, oranges, blood oranges, mandarins and tangerines, lemons, sweet lemons, limes, grapefruit, pomelos, kumquats, watermelon, cantaloupe, honeydew, Galia and Hami melons, berries, mangoes, avocados, bananas, kiwi, figs, dates, pomegranates, persimmons, quince, guava, papaya, pineapple, coconut, dragon fruit, jackfruit, lychee, longan, rambutan, passion fruit, star fruit, loquats, jujubes, cactus pears and nopales. Persian, English, Armenian and pickling cucumbers. Roma, cluster, round, grape, cherry, Campari, heirloom and medley tomatoes. White, crimini, portabella, shiitake, oyster, enoki and beech mushrooms. Onions, shallots, garlic, ginger, potatoes, yams, jicama, yucca, pumpkins. Walnuts, almonds, pistachios, chestnuts, peanuts, olives.
LAV vegetables: cilantro, parsley, green onions, celery, cauliflower, broccoli, green, red and napa cabbage, carrots, beets, radishes, daikon, turnips, romaine, iceberg, green and red leaf lettuce, spinach, baby spinach, kale, chard, collards, arugula, dandelion, watercress, green, red, yellow and orange bell peppers, mini peppers, chiles (jalapeño, serrano, Anaheim, pasilla, shishito, Thai, Fresno), Italian, Japanese, Chinese, Indian and graffiti eggplant, zucchini, yellow, Mexican, Korean, opo, acorn and other squash, chayote, green beans, Romano beans, long beans, fava beans, peas, okra, asparagus, corn, leeks, fennel, endive, celery root, kohlrabi, sunchokes, taro, bitter melon, sprouts, and fresh herbs (basil, mint, dill, oregano, thyme, sage, rosemary, tarragon, chives, sorrel), plus more.

PRICING, STOCK, ORDER STATUS, ACCOUNTS
Never give prices, confirm today's stock, give order status or delivery ETAs, or discuss credit, terms or payment. Say sales handles that and give 213 891 1122 or sales@freshqp.com. One line, no apology.

ITEMS WE DON'T NORMALLY CARRY
Never just say "we don't carry that" and stop. We source a lot through our grower network, so this is a lead for sales. Say it's not something we stock regularly but sales can look into sourcing it. Never promise we can get it. Then collect, one question at a time: their name, their company, the item (variety, size or pack if they know), about how much, and how often they'd need it (one time or regular). Once you have all five, summarize it in a short list and say exactly: "I've passed this to our sales team to check on sourcing. They'll get back to you during business hours. If you need an answer today, call 213 891 1122." Then add this tag on its own line at the very end: [SEND_REQUEST]

ORDER INTAKE
If someone wants to place an order, collect six things through natural back and forth, one question at a time: their name, their company, their phone number, their email, the items and quantities, and delivery or pickup. Start with their name, then their company. Once you have all six, confirm the order in a short list and say exactly: "All orders are subject to daily pricing and availability. Our sales team will call you to confirm during business hours. If you need it sooner, call 213 891 1122 or email sales@freshqp.com." Then add this tag on its own line at the very end: [SEND_ORDER]

INBOUND DELIVERY AND PICKUP COORDINATION
If a driver, vendor, supplier or customer texts that they are bringing a delivery, making a pickup or coordinating an arrival, collect: their name, their company, what they are bringing or picking up, and their expected arrival time. Once you have all of that, confirm it back and say exactly: "I've notified the team about your arrival. See you soon." Then add this tag on its own line at the very end: [SEND_ARRIVAL]

DELIVERY AND PICKUP
First come, first served. No appointment needed. All drivers check in and sign in at the warehouse. A delivery charge may apply on smaller orders. Sales sets it based on order size and location, and it shows on the invoice.

CHECK IN AND SITE GUIDE
If anyone asks about check in, parking, docks, where to go or how to get in, give them this:
*Main entrance, check in here first:* 2010 to 2016 Violet St. Everyone (visitors, drivers, employees) signs in at the check in desk. Fill out the check in form on the iPad, then wait outside in your truck. A receiver will call you and give you a door number. Receiving is first come, first served.
*Shipping and pickups:* doors D5 to D8, main entrance, west end.
*Receiving and deliveries:* doors D1 to D4, 2038 to 2042 Violet St, east end toward Santa Fe Ave.
*Parking:* 902 Mateo St. Visitors and employees only. No semi trucks.
Our listed address is 2022 Violet St, but the check in entrance is 2010 to 2016 Violet St.
Just give the facts. Don't add anything about what staff will do after check in.

FALLBACK
If you don't know, say: "I don't have that info handy. Call us at 213 891 1122 or email sales@freshqp.com and we'll take care of you."`;

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

// ─── Sourcing request email ──────────────────────────────────────────────────

function buildRequestEmail(phone, conversationHistory) {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  let thread = '';
  conversationHistory.forEach(msg => {
    const label = msg.role === 'user' ? 'Customer' : 'Bot';
    thread += `<p><strong>${label}:</strong> ${msg.content}</p>`;
  });

  return `
    <h2>Sourcing Request — Fresh QP Bot</h2>
    <p><strong>Received:</strong> ${timestamp} (Pacific)</p>
    <p><strong>Customer WhatsApp:</strong> +${phone}</p>
    <hr>
    <h3>Full Conversation</h3>
    ${thread}
    <hr>
    <p><em>Customer asked for an item we don't normally carry. Check sourcing and get back to them during business hours.</em></p>
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

async function sendDailySummary() {
  const entries = await loadLog();
  if (entries.length === 0) {
    console.log('No conversations to report.');
  } else {
    const summary = buildSummaryEmail(entries);

    // Build the archive attachment
    let attachments = [];
    try {
      const archiveData = await fsp.readFile(ARCHIVE_FILE, 'utf8');
      const base64Content = Buffer.from(archiveData).toString('base64');
      const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
      attachments.push({
        filename: `conversations-archive-${date.replace(/\//g, '-')}.json`,
        content: base64Content
      });
    } catch {
      // Archive may not exist yet — no attachment, but send summary anyway
      console.log('Archive file not found, sending summary without attachment.');
    }

    try {
      const status = await sendEmail(
        'ted@freshqp.com',
        `WhatsApp Bot Daily Summary — ${summary.today}`,
        summary.html,
        attachments
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
      .replace(/\[SEND_REQUEST\]/g, '')
      .replace(/\s*[\u2014\u2013]\s*/g, ', ')   // safety net: no em or en dashes to customers
      .trim();

    // Order trigger — phrase-based, does not rely on Haiku appending tag
    const orderTriggered =
      reply.includes('[SEND_ORDER]') ||
      reply.includes('sales team will call you to confirm') ||
      reply.includes('sales team will call you in the morning to confirm');

    // Arrival trigger
    const arrivalTriggered =
      reply.includes('[SEND_ARRIVAL]') ||
      reply.includes("I've notified the team about your arrival");

    // Sourcing request trigger (item we don't normally carry)
    const requestTriggered =
      reply.includes('[SEND_REQUEST]') ||
      reply.includes("I've passed this to our sales team to check on sourcing");

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

    if (requestTriggered) {
      const currentHistory = await getHistory(phone);
      const requestHtml = buildRequestEmail(phone, currentHistory);
      sendEmail('sales@freshqp.com', `Sourcing Request — ${phone}`, requestHtml)
        .then(status => console.log(`Sourcing request email sent for ${phone}. HTTP ${status}.`))
        .catch(err => console.error(`Sourcing request email FAILED for ${phone}:`, err.message));
    }

    return cleanReply;
  } catch (error) {
    console.error('Claude API error:', error.message);
    return 'Something went wrong on our end. Call us at 213 891 1122 or email sales@freshqp.com.';
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

// Reset conversation history for a phone number (testing only)
// GET /reset-history?key=<WEBHOOK_VERIFY_TOKEN>&phone=<phone>
app.get('/reset-history', async (req, res) => {
  if (req.query.key !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  const phone = req.query.phone;
  if (!phone) return res.status(400).send('Missing phone param');
  await redis.del(`history:${phone}`);
  res.status(200).send(`history key cleared for ${phone}`);
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

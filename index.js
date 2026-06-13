const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const SYSTEM_PROMPT = "You are a customer support assistant for Fresh QP and LA Vegetable, a wholesale produce distribution company based in Los Angeles, California. Detect the language the customer is writing in and respond in that same language. Supported languages: English, Spanish, Arabic, Farsi, Armenian. If you cannot detect the language clearly, default to English. Naturally collect the customer name and store/company name during the conversation and use it when responding. HOURS: Warehouse/receiving open 12:30 AM to 4:00 PM. Sales team available 3:00 AM to 12:00 PM at the office, then by cell phone after 12:00 PM. Accounting office open 8:00 AM to 4:00 PM. For special requests to stay open later than 4:00 PM call 213-891-1122. DELIVERIES: Begin at 4:00 AM and continue until all routes are completed. WHAT WE SELL: Full range of fresh fruits and vegetables including tomatoes, cucumbers, peppers, mushrooms, avocados, citrus, melons, stone fruit, grapes, berries, apples, pears, mangoes, garlic, ginger, onions, potatoes, and specialty items. WHO WE SERVE: Supermarkets, independent grocery stores, produce markets, and distributors in Los Angeles, San Diego, Orange County, San Fernando Valley, and surrounding regions. DELIVERY CHARGE: A delivery charge may apply on smaller orders and will be reflected on the invoice. Amount determined by sales team. CONTACT: Phone: 213-891-1122, Email: sales@freshqp.com. NEVER answer pricing, product availability, order status, delivery ETA, account terms, credit, or exact delivery charge amounts. Always route these to the sales team at 213-891-1122 or sales@freshqp.com. TONE: Be straightforward and helpful. Keep responses short and clear. These are busy people running stores and markets.";

const LOG_FILE = '/tmp/conversations.json';

function loadLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveLog(entries) {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    console.error('Log save error:', e.message);
  }
}

function logConversation(from, message, response) {
  const entries = loadLog();
  entries.push({
    timestamp: new Date().toISOString(),
    phone: from,
    message: message,
    response: response
  });
  saveLog(entries);
}

async function sendDailySummary() {
  const entries = loadLog();
  if (entries.length === 0) {
    console.log('No conversations to report.');
    return;
  }

  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
  let emailBody = '<h2>Fresh QP WhatsApp Bot — Daily Summary</h2>';
  emailBody += '<p><strong>Date:</strong> ' + today + '</p>';
  emailBody += '<p><strong>Total conversations:</strong> ' + entries.length + '</p>';
  emailBody += '<hr>';

  entries.forEach((entry, i) => {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    emailBody += '<p><strong>#' + (i + 1) + ' — ' + time + '</strong><br>';
    emailBody += 'Phone: ' + entry.phone + '<br>';
    emailBody += 'Message: ' + entry.message + '<br>';
    emailBody += 'Bot response: ' + entry.response + '</p><hr>';
  });

  try {
    await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: 'ted@freshqp.com' }] }],
      from: { email: 'ted@freshqp.com', name: 'Fresh QP Bot' },
      subject: 'WhatsApp Bot Daily Summary — ' + today,
      content: [{ type: 'text/html', value: emailBody }]
    }, {
      headers: {
        Authorization: 'Bearer ' + process.env.SENDGRID_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log('Daily summary email sent.');
    saveLog([]);
  } catch (error) {
    console.error('Email error:', error.message);
  }
}

function scheduleMidnightEmail() {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    sendDailySummary();
    setInterval(sendDailySummary, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry && body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const message = changes && changes.value && changes.value.messages && changes.value.messages[0];
    if (message && message.type === 'text') {
      const from = message.from;
      const text = message.text.body;
      console.log('Message from ' + from + ': ' + text);
      const claudeResponse = await askClaude(text);
      await sendWhatsAppMessage(from, claudeResponse);
      logConversation(from, text, claudeResponse);
    }
  }
  res.sendStatus(200);
});

async function askClaude(userMessage) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );
    return response.data.content[0].text;
  } catch (error) {
    console.error('Claude error:', error.message);
    return 'Sorry, I could not process your request.';
  }
}

async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      'https://graph.facebook.com/v18.0/' + process.env.PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
  }
}

scheduleMidnightEmail();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot running on port ' + PORT));
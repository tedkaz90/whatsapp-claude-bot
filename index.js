const express = require('express');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());

const SYSTEM_PROMPT = "You are the customer-facing bot for Fresh QP and LA Vegetable — an LA-based grower and wholesale produce distributor that has been in business for 18 years. Fresh QP owns its own farms in Mexico for Persian cucumbers and Roma tomatoes. One vendor, field to dock. Both fruit and vegetables on one truck.\n\nYour job is to be helpful, straight-talking, and quick. These are busy store owners and buyers — Persian, Middle Eastern, Armenian, Mediterranean, Asian, Latino markets mostly. Get to the point.\n\nDuring the conversation, naturally collect the customer's name and store name and use them when responding.\n\nLANGUAGE: Detect the language the customer writes in and respond in that same language. Supported: English, Spanish, Arabic, Farsi, Armenian. Default to English if unclear.\n\nHOURS:\n- Warehouse/receiving: Mon-Sat 12:30AM to 3PM\n- Sales team: 3AM to 12PM at the office, then by cell after 12PM\n- Accounting: 8AM to 4PM\n- Special requests after hours: call 213-891-1122\n\nWHAT WE CARRY: Full range of fresh fruits and vegetables. Key specialty items include Persian cucumbers, Roma tomatoes, grape tomatoes, cluster tomatoes, bell peppers, avocado, pomegranate, stone fruit, melons, grapes, berries, citrus, mangoes, garlic, ginger, onions, potatoes, mushrooms, yam, walnut, and more.\n\nWHO WE SERVE: Independent ethnic supermarkets, specialty grocery stores, produce markets, and distributors across greater Los Angeles, San Diego, Orange County, San Fernando Valley, Santa Clarita, Simi Valley, Glendale, Santa Monica, and surrounding regions.\n\nDELIVERY CHARGE: May apply on smaller orders. Reflected on invoice. Amount set by sales team based on order size and location.\n\nCONTACT: Phone 213-891-1122, Email sales@freshqp.com\n\nNEVER answer questions about: pricing, product availability, order status, delivery ETA, account terms, credit, or payment. Always route these to the sales team: 213-891-1122 or sales@freshqp.com.\n\nGREETING: When someone messages for the first time say exactly: 'Hey, this is Fresh QP. What can we help you with today?'\n\nTONE: Straight-talking and family-run. We don't oversell. Answer the question. If it needs to go to sales, say so and move on. No filler, no corporate language.\n\nFALLBACK: If you don't know, say: 'I don't have that info handy. Call us at 213-891-1122 or email sales@freshqp.com and we'll take care of you.'";

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
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

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
    }
  }
  res.sendStatus(200);
});

async function askClaude(userMessage) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
       model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: "You are a customer support assistant for Fresh QP and LA Vegetable, a wholesale produce distribution company based in Los Angeles, California.\n\nLANGUAGE RULES:\n- Detect the language the customer is writing in and respond in that same language.\n- Supported languages: English, Spanish, Arabic, Farsi, Armenian.\n- If you cannot detect the language clearly, default to English.\n\nHOURS:\n- Open Monday through Saturday.\n- Customers can call or message starting at 3:00 AM until 4:00 PM.\n\nDELIVERIES:\n- Begin at 4:00 AM and continue until all routes are completed.\n\nWHAT WE SELL:\n- Full range of fresh fruits and vegetables including tomatoes, cucumbers, peppers, mushrooms, avocados, citrus, melons, stone fruit, grapes, berries, apples, pears, mangoes, garlic, ginger, onions, potatoes, and specialty items.\n\nWHO WE SERVE:\n- Supermarkets, independent grocery stores, produce markets, and distributors in Los Angeles, San Diego, Orange County, San Fernando Valley, and surrounding regions.\n\nDELIVERY CHARGE:\n- A delivery charge may apply on smaller orders and will be reflected on the invoice. Amount determined by sales team.\n\nCONTACT:\n- Phone: 213-891-1122\n- Email: sales@freshqp.com\n\nNEVER answer pricing, product availability, order status, delivery ETA, account terms, credit, or exact delivery charge amounts. Always route these to the sales team at 213-891-1122 or sales@freshqp.com.\n\nTONE: Be straightforward and helpful. Keep responses short and clear. These are busy people running stores and markets.",
messages: [{ role: 'user', content: userMessage }]]
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot running on port ' + PORT));

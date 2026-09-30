const { config } = require('./config');
const { log, sleep } = require('./utils');

const CAPTION_LIMIT = 1024; // Telegram limit for photo captions (visible characters)

function api(method) {
  return `https://api.telegram.org/bot${config.telegramToken}/${method}`;
}

async function call(method, body, isForm = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: isForm ? undefined : { 'content-type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (json.ok) return json.result;
    if (res.status === 429) {
      await sleep(((json.parameters && json.parameters.retry_after) || 3) * 1000);
      continue;
    }
    throw new Error(`Telegram ${method} failed: ${json.description || res.status}`);
  }
  throw new Error(`Telegram ${method} failed after retries`);
}

function visibleLength(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot);/g, 'x').length;
}

async function sendText(chatId, html) {
  return call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}

async function sendPhoto(chatId, png, captionHtml) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([png], { type: 'image/png' }), 'unlock.png');
  if (captionHtml) {
    form.append('caption', captionHtml);
    form.append('parse_mode', 'HTML');
  }
  return call('sendPhoto', form, true);
}

/**
 * Send an alert to every chat: picture with the text as caption.
 * If the text is too long for a caption, the picture goes first and the text right after.
 */
async function broadcastAlert(html, png) {
  for (const chatId of config.telegramChatIds) {
    try {
      if (png && visibleLength(html) <= CAPTION_LIMIT) {
        await sendPhoto(chatId, png, html);
      } else {
        if (png) await sendPhoto(chatId, png, null);
        await sendText(chatId, html);
      }
    } catch (e) {
      // If the picture fails for any reason, still deliver the text.
      log(`Telegram photo send to ${chatId} failed (${e.message}), sending text only`);
      await sendText(chatId, html);
    }
  }
}

async function broadcastText(html) {
  for (const chatId of config.telegramChatIds) await sendText(chatId, html);
}

module.exports = { broadcastAlert, broadcastText, visibleLength };

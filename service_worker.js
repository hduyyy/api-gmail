// service_worker.js (MV3, type: module)
import { buildRawEmail, cleanSignatureHtml } from './utils/mime.js';

// OAuth client ID
const CLIENT_ID = '132712804092-tt934audq04hka606068knfpdpeoupik.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/gmail.settings.basic'
];

let oauthToken = null;

// Background sending state
let backgroundSendState = {
  isRunning: false,
  currentIndex: 0,
  totalCount: 0,
  results: [],
  payload: null
};

// --- OAuth helpers ---
async function getAccessTokenInteractive() {
  const redirectUri = chrome.identity.getRedirectURL('oauth2');
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    `&prompt=consent&access_type=online&include_granted_scopes=true`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectedTo) => {
      if (chrome.runtime.lastError) {
        console.error('💥 OAuth Error:', chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }
      if (!redirectedTo) {
        console.error('💥 No redirect URL received');
        return reject(new Error('No redirect URL'));
      }

      try {
        const hash = new URL(redirectedTo).hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const expiresIn = parseInt(params.get('expires_in') || '0', 10);
        const error = params.get('error');

        console.log('🎫 Access Token:', accessToken ? 'Found' : 'Not found');
        console.log('⏰ Expires In:', expiresIn);
        console.log('❌ OAuth Error:', error);

        if (error) return reject(new Error(`OAuth error: ${error}`));
        if (!accessToken) return reject(new Error('No access token'));

        const expiry = Date.now() + (expiresIn - 60) * 1000;
        console.log('💾 Storing token with expiry:', new Date(expiry));
        await chrome.storage.session.set({ accessToken, expiry });
        resolve(accessToken);
      } catch (parseError) {
        console.error('💥 Error parsing OAuth response:', parseError);
        reject(parseError);
      }
    });
  });
}

async function getAccessTokenSimple() {
  console.log('🔄 Trying simple OAuth method...');
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error('💥 Simple OAuth Error:', chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }
      if (!token) {
        console.error('💥 No token from simple OAuth');
        return reject(new Error('No token received'));
      }
      console.log('✅ Simple OAuth successful, token length:', token.length);
      resolve(token);
    });
  });
}

async function ensureToken() {
  const { accessToken, expiry } = await chrome.storage.session.get(['accessToken', 'expiry']);
  if (accessToken && expiry && Date.now() < expiry) {
    console.log('🎫 Using cached token');
    return accessToken;
  }

  console.log('🔄 Need new token, trying methods...');
  try {
    const token = await getAccessTokenSimple();
    const expiryTime = Date.now() + 3600 * 1000;
    await chrome.storage.session.set({ accessToken: token, expiry: expiryTime });
    return token;
  } catch (simpleError) {
    console.warn('⚠️ Simple OAuth failed, trying interactive method...', simpleError);
    return getAccessTokenInteractive();
  }
}

// --- Gmail send raw ---
async function gmailSendRaw(raw) {
  const token = await ensureToken();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gmail send failed: ${res.status} ${res.statusText} — ${JSON.stringify(err)}`);
  }
  return res.json();
}

// --- Google Sheets fetch ---
async function fetchSheetValues(spreadsheetId, rangeA1) {
  const token = await ensureToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets read failed: ${res.status} ${res.statusText} — ${JSON.stringify(err)}`);
  }
  return res.json();
}

// --- Helpers ---
function ensureSama(name) {
  if (!name) return '様';
  return name.endsWith('様') ? name : `${name} 様`;
}

function fillTemplate({ company, name, templateBody, isHtml = true }) {
  const nameWithSama = ensureSama(name.replace(/様+$/,'').trim());
  const lineBreak = isHtml ? '<br>' : '\n';
  const headerLine = company ? `${company}${lineBreak}${nameWithSama}` : nameWithSama;

  let body = templateBody
    .replaceAll('{{会社名}}', company)
    .replaceAll('{{名前}}', name);
  
  if (isHtml) {
    // Simple replace - preserves ALL formatting exactly
    body = body.replace(/\r?\n/g, '<br>');
  }
  
  return `${headerLine}${lineBreak}${lineBreak}${body}`;
}

// --- Get Gmail signature ---
async function getDefaultSignature() {
  try {
    const token = await ensureToken();
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Failed fetch sendAs: ${res.status}`);
    const data = await res.json();
    const primary = data.sendAs?.find(sa => sa.isPrimary);
    const sig = primary?.signature || '';
    return cleanSignatureHtml(sig);
  } catch(e) {
    console.error("❌ getDefaultSignature error:", e);
    return '';
  }
}

// --- Send batch emails (background mode) ---
async function sendBatchBackground(payload, startIndex = 0) {
  const { rows, subject, templateBody, attachments = [], ccEmails = [], fromOverride, perEmailDelayMs = 1200 } = payload;
  
  const totalBytes = attachments.reduce((sum, f) => sum + (f.size || 0), 0);
  const MAX_BYTES = 35 * 1024 * 1024;
  if (totalBytes > MAX_BYTES) throw new Error(`Tổng dung lượng đính kèm vượt 35MB`);

  backgroundSendState.isRunning = true;
  backgroundSendState.currentIndex = startIndex;
  backgroundSendState.totalCount = rows.length;
  backgroundSendState.payload = payload;
  
  if (startIndex === 0) {
    backgroundSendState.results = [];
  }

  const signature = await getDefaultSignature();

  for (let i = startIndex; i < rows.length; i++) {
    if (!backgroundSendState.isRunning) {
      console.log('⏸️ Background sending stopped by user');
      break;
    }

    backgroundSendState.currentIndex = i;
    
    const r = rows[i];
    const company = (r.company || '').toString().trim();
    const nameRaw = (r.name || '').toString().trim();
    const to = (r.email || '').toString().trim();

    if (!to) {
      console.warn(`❌ Row ${i+1}: Missing email`);
      backgroundSendState.results.push({ index: i, to, status: 'skipped', reason: 'Missing email' });
      continue;
    }

    const nameWithSama = ensureSama(nameRaw.replace(/様+$/,'').trim());
    
    const body = fillTemplate({ 
      company, 
      name: nameWithSama.replace(/\s*様$/,''), 
      templateBody,
      isHtml: true 
    });
    
    const bodyWithSignature = `${body}<br><br>${signature}`;

    try {
      const raw = await buildRawEmail({ 
        to, 
        cc: ccEmails,
        subject, 
        body: bodyWithSignature, 
        attachments, 
        from: fromOverride 
      });
      await gmailSendRaw(raw);
      console.log(`✅ [${i+1}/${rows.length}] Sent email to: ${to}${ccEmails.length > 0 ? ` (CC: ${ccEmails.join(', ')})` : ''}`);
      backgroundSendState.results.push({ index: i, to, status: 'sent' });
    } catch (e) {
      console.error(`💥 Error sending email to ${to}:`, e);
      backgroundSendState.results.push({ index: i, to, status: 'error', error: String(e) });
    }

    if (i < rows.length - 1 && perEmailDelayMs > 0) {
      await new Promise(r => setTimeout(r, perEmailDelayMs));
    }
  }

  const isCompleted = backgroundSendState.currentIndex >= rows.length - 1;
  
  if (isCompleted) {
    backgroundSendState.isRunning = false;
    
    // Show completion notification
    const sent = backgroundSendState.results.filter(r => r.status === 'sent').length;
    const failed = backgroundSendState.results.filter(r => r.status === 'error').length;
    const skipped = backgroundSendState.results.filter(r => r.status === 'skipped').length;
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/capy.png',
      title: 'GITS Gmail Sender - Hoàn thành',
      message: `✅ Đã gửi: ${sent}\n❌ Lỗi: ${failed}\n⏭️ Bỏ qua: ${skipped}`,
      priority: 2
    });
  }

  return backgroundSendState.results;
}

// --- Send batch emails (legacy sync mode) ---
async function sendBatch({ rows, subject, templateBody, attachments = [], ccEmails = [], fromOverride, perEmailDelayMs = 1200 }) {
  const totalBytes = attachments.reduce((sum, f) => sum + (f.size || 0), 0);
  const MAX_BYTES = 35 * 1024 * 1024;
  if (totalBytes > MAX_BYTES) throw new Error(`Tổng dung lượng đính kèm vượt 35MB`);

  const results = [];
  const signature = await getDefaultSignature();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const company = (r.company || '').toString().trim();
    const nameRaw = (r.name || '').toString().trim();
    const to = (r.email || '').toString().trim();

    if (!to) {
      console.warn(`❌ Row ${i+1}: Missing email`);
      results.push({ index: i, to, status: 'skipped', reason: 'Missing email' });
      continue;
    }

    const nameWithSama = ensureSama(nameRaw.replace(/様+$/,'').trim());
    
    // Use the improved fillTemplate function
    const body = fillTemplate({ 
      company, 
      name: nameWithSama.replace(/\s*様$/,''), 
      templateBody,
      isHtml: true 
    });
    
    // Combine body with signature using proper HTML breaks
    const bodyWithSignature = `${body}<br><br>${signature}`;

    try {
      const raw = await buildRawEmail({ 
        to, 
        cc: ccEmails,
        subject, 
        body: bodyWithSignature, 
        attachments, 
        from: fromOverride 
      });
      await gmailSendRaw(raw);
      console.log(`✅ Sent email to: ${to}${ccEmails.length > 0 ? ` (CC: ${ccEmails.join(', ')})` : ''}`);
      results.push({ index: i, to, status: 'sent' });
    } catch (e) {
      console.error(`💥 Error sending email to ${to}:`, e);
      results.push({ index: i, to, status: 'error', error: String(e) });
    }

    if (i < rows.length - 1 && perEmailDelayMs > 0) {
      await new Promise(r => setTimeout(r, perEmailDelayMs));
    }
  }

  return results;
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      console.log('🔔 Service Worker received message:', msg.type, msg);

      switch(msg.type) {
        case 'AUTH': {
          const token = await ensureToken();
          console.log('✅ AUTH successful, token length:', token?.length || 0);
          sendResponse({ ok: true, token });
          break;
        }
        case 'FETCH_SHEET': {
          const { spreadsheetId, rangeA1 } = msg;
          const data = await fetchSheetValues(spreadsheetId, rangeA1);
          console.log('✅ FETCH_SHEET successful, data:', data);
          sendResponse({ ok: true, data });
          break;
        }
        case 'DEBUG_DATA':
        case 'DEBUG_PARSED':
        case 'DEBUG_ERROR':
          console.log(`🔍 ${msg.type} received:`, msg.data);
          sendResponse({ ok: true });
          break;
        case 'SEND_BATCH': {
          console.log('📧 Processing SEND_BATCH request...');
          if (!Array.isArray(msg.payload?.rows)) {
            console.error('❌ msg.payload.rows missing or not array');
            sendResponse({ ok: false, error: 'msg.payload.rows missing or not array' });
            break;
          }

          console.log('📋 Payload received:', {
            rowsCount: msg.payload?.rows?.length || 0,
            subject: msg.payload?.subject,
            attachmentsCount: msg.payload?.attachments?.length || 0,
            delay: msg.payload?.perEmailDelayMs,
            backgroundMode: msg.backgroundMode
          });

          msg.payload.rows.forEach((row, index) => {
            console.log(`  Row ${index + 1}:`, { company: row.company, name: row.name, email: row.email });
          });

          if (msg.backgroundMode) {
            // Start background sending (non-blocking)
            sendBatchBackground(msg.payload, 0).catch(e => {
              console.error('💥 Background send error:', e);
            });
            sendResponse({ ok: true, backgroundStarted: true });
          } else {
            // Legacy sync mode
            const out = await sendBatch(msg.payload);
            console.log('✅ SEND_BATCH completed:', out);
            sendResponse({ ok: true, results: out });
          }
          break;
        }
        case 'GET_SEND_STATUS': {
          sendResponse({ 
            ok: true, 
            isRunning: backgroundSendState.isRunning,
            currentIndex: backgroundSendState.currentIndex,
            totalCount: backgroundSendState.totalCount,
            results: backgroundSendState.results
          });
          break;
        }
        case 'STOP_SENDING': {
          backgroundSendState.isRunning = false;
          sendResponse({ ok: true, stopped: true });
          break;
        }
        case 'LOGOUT_TOKEN':
          oauthToken = null;
          sendResponse({ ok: true });
          break;
        case 'DEBUG_SIGNATURE': {
          const signature = await getDefaultSignature();
          const testHtml = `<div>Test email body</div><br><br>${signature}`;
          sendResponse({ ok: true, signature, testHtml });
          break;
        }
        default:
          console.warn('❌ Unknown message type:', msg.type);
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) {
      console.error('💥 Service Worker error:', e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep channel open for async
});

// utils/mime.js - Improved cleanSignatureHtml function

export function cleanSignatureHtml(sig) {
  if (!sig) return '';
  
  let cleaned = sig;
  
  // Remove invisible spans
  cleaned = cleaned.replace(/<span[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>.*?<\/span>/gi, '');
  
  // Handle nested divs better - preserve content but avoid extra breaks
  cleaned = cleaned.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (match, inner) => {
    const content = inner.trim();
    if (!content) return '';
    
    // If inner content already ends with <br>, don't add another
    if (content.toLowerCase().endsWith('<br>') || content.toLowerCase().endsWith('<br/>')) {
      return content;
    }
    
    // If inner content has block elements, don't add <br>
    if (/<(div|p|br|img)\b/i.test(content)) {
      return content;
    }
    
    // Only add <br> for text content
    return content + '<br>';
  });
  
  // Clean up img tags - keep src and data attributes, remove onerror and duplicates
  cleaned = cleaned.replace(/<img([^>]*)>/gi, (match, attrs) => {
    // Extract src attribute (prioritize https src over data-*)
    const srcMatch = attrs.match(/src="(https?:\/\/[^"]*)"/i);
    const dataMatch = attrs.match(/data-[^=]*="([^"]*)"/i);
    
    const src = srcMatch ? srcMatch[1] : (dataMatch ? dataMatch[1] : '');
    
    if (!src) return ''; // Remove img without valid src
    
    // Clean attributes - keep only essential ones
    const altMatch = attrs.match(/alt="([^"]*)"/i);
    const alt = altMatch ? ` alt="${altMatch[1]}"` : ' alt="Signature"';
    
    // Add standard dimensions for signature images
    const style = ' style="max-width: 400px; height: auto;"';
    
    return `<img src="${src}"${alt}${style}>`;
  });
  
  // Clean up links - preserve href and target
  cleaned = cleaned.replace(/<a([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, content) => {
    const hrefMatch = attrs.match(/href="([^"]*)"/i);
    const targetMatch = attrs.match(/target="([^"]*)"/i);
    
    if (!hrefMatch) return content; // Remove a tag without href, keep content
    
    const href = hrefMatch[1];
    const target = targetMatch ? ` target="${targetMatch[1]}"` : '';
    
    return `<a href="${href}"${target}>${content}</a>`;
  });
  
  // Remove multiple consecutive <br> tags (more than 2)
  cleaned = cleaned.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
  
  // Remove leading/trailing <br> tags
  cleaned = cleaned.replace(/^(<br\s*\/?>)+/gi, '');
  cleaned = cleaned.replace(/(<br\s*\/?>)+$/gi, '');
  
  // Clean up extra whitespace but preserve intentional spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

// Test function to verify the cleaning
export function testSignatureCleaning() {
  const testSignature = `<br><br>---------------------------------------------------------------------------<br>ホ　グエン　トウアン　アイン　( Duy Nguyen Huu Dep Trai So 1 )<br><b>営業担当者</b><br>　E-Mail : <a href="mailto:anh.honguyentuan@gits.com.vn" target="_blank">anh.honguyentuan@gits.com.vn</a><br>　Mobile : +84 936 619 637<br>---------------------------------------------------------------------------<br>株式会社Global IT Solutions (GITS)<br><a href="https://gits.com.vn/ja/" rel="noopener nofollow noreferrer" target="_blank">https://gits.com.vn/ja/</a><br>Tel　 :  +84 24 7300 0468<br>住所  :<br>11th Floor, Handico Tower, Me Tri Ward, Nam Tu Liem Dist, Hanoi, Vietnam<br>12 Floor, FastFive Tower, 24, Namdaemun-ro 9-gil, Jung-gu, Seoul<br>〒160-0001　東京都新宿区片町4-3曙橋SHKビル5階<div><img src="https://ci3.googleusercontent.com/mail-sig/AIorK4wHNAMnM5mp6CYlVWAa0ZT3YodhDd-238uYfn8oM-PxXIXAnzC8f4lmwsoTimGCu9-qODAnB79wJOI5"  data-aii="CiExY244QXVWTWJIQ3hZcXc0Z2RSU3VCSm5QSTJuQkI3dlo" src="https://ci3.googleusercontent.com/mail-sig/AIorK4wHNAMnM5mp6CYlVWAa0ZT3YodhDd-238uYfn8oM-PxXIXAnzC8f4lmwsoTimGCu9-qODAnB79wJOI5" data-os="https://lh3.googleusercontent.com/d/1cn8AuVMbHCxYqw4gdRSuBJnPI2nBB7vZ"><br><div><br><br></div></div>`;
  
  const cleaned = cleanSignatureHtml(testSignature);
  console.log('Original signature length:', testSignature.length);
  console.log('Cleaned signature length:', cleaned.length);
  console.log('Cleaned signature:', cleaned);
  
  return cleaned;
}

// Additional helper function for better MIME building
export async function buildRawEmail({ to, cc = [], subject, body, attachments = [], from }) {
  const boundary = '====GITS_BOUNDARY_' + Math.random().toString(36).slice(2);
  
  const headers = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    cc.length > 0 ? `Cc: ${cc.join(', ')}` : null,
    `Subject: ${encodeMimeHeaderUtf8(subject)}`,
    'MIME-Version: 1.0',
    attachments.length
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : 'Content-Type: text/html; charset="UTF-8"',
  ].filter(Boolean).join('\r\n');

  let mime;

  if (attachments.length === 0) {
    // For HTML content with signature - ensure proper HTML structure
    const htmlBody = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
${body}
</body>
</html>`;
    mime = `${headers}\r\n\r\n${htmlBody}\r\n`;
  } else {
    let mixed = `${headers}\r\n\r\n`;
    
    // Part 1: HTML content
    mixed += `--${boundary}\r\n`;
    mixed += `Content-Type: text/html; charset="UTF-8"\r\n`;
    mixed += `Content-Transfer-Encoding: base64\r\n\r\n`;
    
    const htmlBody = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
${body}
</body>
</html>`;
    
    mixed += toBase64(htmlBody) + `\r\n`;

    // Parts: attachments
    for (const file of attachments) {
      mixed += `--${boundary}\r\n`;
      mixed += `Content-Type: ${file.mimeType || 'application/octet-stream'}; name="${escapeFilename(file.name)}"\r\n`;
      mixed += `Content-Disposition: attachment; filename="${escapeFilename(file.name)}"\r\n`;
      mixed += `Content-Transfer-Encoding: base64\r\n\r\n`;
      mixed += file.base64 + `\r\n`;
    }
    mixed += `--${boundary}--\r\n`;
    mime = mixed;
  }

  return base64url(mime);
}

// Helper functions (keep existing ones)
function base64url(str) {
  const b64 = toBase64Binary(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

function toBase64(text) {
  const enc = new TextEncoder().encode(text);
  let bin = '';
  enc.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function toBase64Binary(binaryString) {
  const bytes = new TextEncoder().encode(binaryString);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function encodeMimeHeaderUtf8(str) {
  // Check if string contains non-ASCII characters
  if (!/[^\x00-\x7F]/.test(str)) {
    return str; // Plain ASCII, no encoding needed
  }
  
  const b64 = toBase64(str);
  return `=?UTF-8?B?${b64}?=`;
}

function escapeFilename(name) {
  return name.replace(/[\r\n"]/g, '_');
}
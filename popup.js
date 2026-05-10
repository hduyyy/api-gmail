// popup.js
const $ = (sel) => document.querySelector(sel);

const fileExcel = $('#fileExcel');
const excelUrl = $('#excelUrl');
const btnFetchUrl = $('#btnFetchUrl');

const preview = $('#preview');

const fileAttach = $('#fileAttach');
const attachInfo = $('#attachInfo');

const subjectEl = $('#subject');
const bodyEl = $('#body');
const delayEl = $('#delay');
const btnAuth = $('#btnAuth');
const btnSend = $('#btnSend');
const btnClearData = $('#btnClearData');
const statusEl = $('#status');
const logEl = $('#log');

let rows = []; // {会社名, 名前, メール} hoặc {company,name,email}
let attachments = []; // {name, mimeType, base64, size}
let statusCheckInterval = null;

// ========== AUTO-SAVE & RESTORE STATE ==========
const STORAGE_KEY = 'gmail_sender_state';

// Load saved state on startup
async function loadSavedState() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const savedState = result[STORAGE_KEY];
    
    if (!savedState) {
      console.log('📭 No saved state found');
      return;
    }
    
    console.log('📥 Loading saved state:', savedState);
    
    // Restore form fields
    if (savedState.subject) subjectEl.value = savedState.subject;
    if (savedState.body) bodyEl.value = savedState.body;
    if (savedState.delay) delayEl.value = savedState.delay;
    if (savedState.ccEmails) document.getElementById('ccEmails').value = savedState.ccEmails;
    if (savedState.excelUrl) excelUrl.value = savedState.excelUrl;
    
    // Restore rows data
    if (savedState.rows && savedState.rows.length > 0) {
      rows = savedState.rows;
      renderPreview(rows);
      status(`✅ Đã khôi phục ${rows.length} khách hàng từ lần trước`, true);
    }
    
    // Restore attachments
    if (savedState.attachments && savedState.attachments.length > 0) {
      attachments = savedState.attachments;
      renderAttachedFiles();
      console.log('✅ Restored attachments:', attachments.length);
    }
    
  } catch (e) {
    console.error('❌ Error loading saved state:', e);
  }
}

// Save current state
async function saveCurrentState() {
  try {
    const state = {
      subject: subjectEl.value,
      body: bodyEl.value,
      delay: delayEl.value,
      ccEmails: document.getElementById('ccEmails').value,
      excelUrl: excelUrl.value,
      rows: rows,
      attachments: attachments,
      savedAt: new Date().toISOString()
    };
    
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    console.log('💾 State saved');
  } catch (e) {
    console.error('❌ Error saving state:', e);
  }
}

// Auto-save on input changes (debounced)
let saveTimeout = null;
function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveCurrentState();
  }, 1000); // Save after 1 second of inactivity
}

// Attach auto-save listeners
subjectEl.addEventListener('input', scheduleAutoSave);
bodyEl.addEventListener('input', scheduleAutoSave);
delayEl.addEventListener('input', scheduleAutoSave);
document.getElementById('ccEmails').addEventListener('input', scheduleAutoSave);
excelUrl.addEventListener('input', scheduleAutoSave);

// Load saved state on startup
loadSavedState();

// ========== BACKGROUND SEND STATUS ==========
async function checkSendStatus() {
  const { ok, isRunning, currentIndex, totalCount, results } = await sendMsg({ type: 'GET_SEND_STATUS' });
  
  if (!ok) return;
  
  if (isRunning) {
    status(`📤 Đang gửi ngầm: ${currentIndex + 1}/${totalCount}...`, true);
    btnSend.textContent = '⏸️ Dừng gửi';
    btnSend.disabled = false;
  } else if (results && results.length > 0) {
    // Show final results
    const sent = results.filter(r => r.status === 'sent').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'error').length;
    
    status(`✅ Hoàn thành. Đã gửi: ${sent}, Bỏ qua: ${skipped}, Lỗi: ${failed}.`, true);
    
    // Update log
    logEl.textContent = '';
    results.forEach(r => {
      const line = r.status === 'error'
        ? `✗ [${r.index}] ${r.to} — LỖI: ${r.error}\n`
        : r.status === 'skipped'
          ? `• [${r.index}] ${r.to || '(no email)'} — BỎ QUA\n`
          : `✓ [${r.index}] ${r.to} — ĐÃ GỬI\n`;
      logEl.textContent += line;
    });
    
    btnSend.textContent = '📧 Gửi Email';
    btnSend.disabled = false;
    
    // Stop checking
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
  }
}

// Check status on popup open
checkSendStatus();

// ========== CLEAR DATA BUTTON ==========
btnClearData.addEventListener('click', async () => {
  if (!confirm('Bạn có chắc muốn xóa tất cả dữ liệu đã lưu?\n\nĐiều này sẽ xóa:\n- Dữ liệu khách hàng\n- Tiêu đề & nội dung email\n- File đính kèm\n- CC emails\n- Link Excel/Google Sheets')) {
    return;
  }
  
  try {
    // Clear storage
    await chrome.storage.local.remove([STORAGE_KEY]);
    
    // Reset all fields
    subjectEl.value = '【ITアウトソーシングご提案のご連絡】貴社の課題解決に貢献できるGITSのご紹介';
    bodyEl.value = `どうも初めまして。
ベトナムに拠点を構えるITアウトソーシング企業、GITS株式会社の営業部のアインと申します。
この度、貴社のプロフィールを拝見し、ソフトウェア・システム開発において、業務改善に弊社のサービスを支援できるのではと感じ、ご連絡させていただきました。

ー GITS株式会社について簡単に紹介させていただきます。
弊社はベトナム本社・日本拠点を持つオフショア開発専門企業であり、製造、物流、医療、IoT、クラウドなどの分野において、日系企業様向けにソフトウェア開発サービスを提供しております。
＊提供サービスの詳細：
・ITコンサルティング
・ソフトウェア開発
・保守およびサポート
・ITエンジニア派遣（オンサイト・ラボ型対応可能）
    
GITSで製品、ソフトウェア開発における対応可能な開発実績（一部）：
・ルーター設定・監視システム
・介護居宅用システム
・モニタリングシステム
・PCB品質検査システム
・顔認識を用いたスマート出席システム 　など。

GITSの強み：
・　日本語・韓国語対応可能なPM・エンジニアが多数在籍
・　CMMI 2.0 Level 3準拠の品質・開発プロセス
・　情報セキュリティ対策（物理・非物理の両面）
・　マーケティング費・営業費を抑えたコスト最適化体制により、高品質かつ競争力のある価格を実現

以上です。

本メールには弊社の会社案内資料を添付しておりますので、ぜひご覧いただけますと幸いです。
また、ご都合がよろしければ、来週以降でZoom等によるご挨拶・ご説明の機会をいただけますと幸いです。

何卒よろしくお願い申し上げます。`;
    delayEl.value = '1200';
    document.getElementById('ccEmails').value = '';
    excelUrl.value = '';
    
    // Reset data
    rows = [];
    attachments = [];
    
    // Reset UI
    renderPreview(rows);
    renderAttachedFiles();
    
    // Reset file inputs
    fileExcel.value = '';
    fileAttach.value = '';
    
    // Reset labels
    document.querySelector('label[for="fileExcel"]').textContent = '📊 Chọn file Excel/CSV';
    document.querySelector('label[for="fileAttach"]').textContent = '📎 Choose attachments (max 3 files)';
    
    // Clear log
    logEl.textContent = '';
    
    status('✅ Đã xóa tất cả dữ liệu đã lưu', true);
    
    console.log('🗑️ All data cleared');
  } catch (e) {
    console.error('❌ Error clearing data:', e);
    status('Lỗi khi xóa dữ liệu: ' + e.message, false, true);
  }
});

// Thiết lập template email mặc định (chỉ khi chưa có saved state)
if (!bodyEl.value.trim()) {
  bodyEl.value = `どうも初めまして。
ベトナムに拠点を構えるITアウトソーシング企業、GITS株式会社の営業部のアインと申します。
この度、貴社のプロフィールを拝見し、ソフトウェア・システム開発において、業務改善に弊社のサービスを支援できるのではと感じ、ご連絡させていただきました。

ー GITS株式会社について簡単に紹介させていただきます。
弊社はベトナム本社・日本拠点を持つオフショア開発専門企業であり、製造、物流、医療、IoT、クラウドなどの分野において、日系企業様向けにソフトウェア開発サービスを提供しております。
＊提供サービスの詳細：
・ITコンサルティング
・ソフトウェア開発
・保守およびサポート
・ITエンジニア派遣（オンサイト・ラボ型対応可能）
    
GITSで製品、ソフトウェア開発における対応可能な開発実績（一部）：
・ルーター設定・監視システム
・介護居宅用システム
・モニタリングシステム
・PCB品質検査システム
・顔認識を用いたスマート出席システム 　など。

GITSの強み：
・　日本語・韓国語対応可能なPM・エンジニアが多数在籍
・　CMMI 2.0 Level 3準拠の品質・開発プロセス
・　情報セキュリティ対策（物理・非物理の両面）
・　マーケティング費・営業費を抑えたコスト最適化体制により、高品質かつ競争力のある価格を実現

以上です。

本メールには弊社の会社案内資料を添付しておりますので、ぜひご覧いただけますと幸いです。
また、ご都合がよろしければ、来週以降でZoom等によるご挨拶・ご説明の機会をいただけますと幸いです。

何卒よろしくお願い申し上げます。`;
}

btnAuth.addEventListener('click', async () => {
  status('Đang đăng nhập...');
  const { ok, error } = await sendMsg({ type: 'AUTH' });
  if (ok) status('Đã sẵn sàng (đã có token).', true);
  else status('Lỗi đăng nhập: ' + error, false, true);
});

btnFetchUrl.addEventListener('click', async () => {
  const url = excelUrl.value.trim();
  if (!url) return status('Vui lòng nhập link Google Sheet/Excel.', false, true);

  status('Đang tải dữ liệu từ link...');

  try {
    // Xử lý Google Sheets
    if (url.includes('docs.google.com/spreadsheets')) {
      const result = await handleGoogleSheets(url);
      if (result) {
        rows = result;
        renderPreview(rows);
        status(`Đã nạp ${rows.length} dòng từ Google Sheets.`, true);
        saveCurrentState(); // Auto-save after loading data
        return;
      }
    }

    // Xử lý CSV export từ Google Sheets
    if (url.includes('format=csv') || url.includes('export?format=csv')) {
      rows = await loadCSVFromLink(url) || [];
      renderPreview(rows);
      status(`Đã nạp ${rows.length} dòng từ link CSV.`, true);
      saveCurrentState(); // Auto-save after loading data
      return;
    }

    // Xử lý file Excel trực tiếp
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const buf = await (await res.blob()).arrayBuffer();

    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (!data.length) {
      rows = [];
      return renderPreview([]);
    }

    rows = parseExcelData(data);
    renderPreview(rows);
    status(`Đã nạp ${rows.length} dòng từ file Excel.`, true);
    saveCurrentState(); // Auto-save after loading data

  } catch (err) {
    console.error(err);
    status('Lỗi khi tải file từ link: ' + err.message, false, true);
  }
});



fileExcel.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  const fileLabel = document.querySelector('label[for="fileExcel"]');
  
  if (!file) {
    fileLabel.textContent = '📊 Chọn file Excel/CSV';
    return;
  }
  
  // Update label to show loading
  fileLabel.textContent = '⏳ Đang đọc file...';
  fileLabel.classList.add('loading');
  status(`Đọc tệp ${file.name}...`);
  
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    // Gửi raw data sang service worker để debug
    await sendMsg({ 
      type: 'DEBUG_DATA', 
      data: {
        fileName: file.name,
        rawData: data,
        dataLength: data.length,
        headers: data[0] || []
      }
    });
    
    if (!data.length) { 
      rows = []; 
      fileLabel.textContent = '❌ File Excel trống';
      fileLabel.classList.remove('loading');
      status('File Excel trống.', false, true);
      return renderPreview([]); 
    }

    status(`Tìm thấy ${data[0]?.length || 0} cột: ${(data[0] || []).join(', ')}`);

    // Thử parse đơn giản trước
    if (data.length > 1 && data[0] && data[0].length >= 3) {
      // Giả sử 3 cột đầu tiên là: Company, Name, Email
      rows = data.slice(1)
        .filter(row => row && row.length >= 3 && row[2] && row[2].toString().includes('@'))
        .map(row => ({
          '会社名': (row[0] || '').toString().trim(),
          '名前': (row[1] || '').toString().trim(),
          'メール': (row[2] || '').toString().trim()
        }));
      
      // Gửi parsed data sang service worker để debug
      await sendMsg({ 
        type: 'DEBUG_PARSED', 
        data: {
          fileName: file.name,
          parsedRows: rows,
          rowsCount: rows.length
        }
      });
      
      renderPreview(rows);
      fileLabel.textContent = `✅ ${rows.length} khách hàng từ ${file.name}`;
      fileLabel.classList.remove('loading');
      status(`Đã nạp ${rows.length} dòng từ ${file.name}.`, true);
      saveCurrentState(); // Auto-save after loading data
    } else {
      rows = [];
      fileLabel.textContent = '❌ Cấu trúc file không đúng';
      fileLabel.classList.remove('loading');
      status('Không đủ dữ liệu hoặc cấu trúc file không đúng.', false, true);
    }
    
  } catch (err) {
    // Gửi error sang service worker để debug
    await sendMsg({ 
      type: 'DEBUG_ERROR', 
      data: {
        fileName: file.name,
        error: err.message,
        stack: err.stack
      }
    });
    
    fileLabel.textContent = '❌ Lỗi đọc file';
    fileLabel.classList.remove('loading');
    status('Lỗi khi đọc file Excel: ' + err.message, false, true);
    rows = []; // Reset rows khi có lỗi
  }
});

// Function to get file icon based on file type
function getFileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const iconMap = {
    'pdf': '📄',
    'doc': '📝', 'docx': '📝',
    'xls': '📊', 'xlsx': '📊',
    'ppt': '📋', 'pptx': '📋',
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
    'zip': '🗜️', 'rar': '🗜️',
    'txt': '📄',
    'csv': '📊'
  };
  return iconMap[ext] || '📎';
}

// Function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Function to render attached files
function renderAttachedFiles() {
  const container = document.getElementById('attachedFiles');
  const fileLabel = document.querySelector('label[for="fileAttach"]');
  
  if (attachments.length === 0) {
    container.innerHTML = '';
    attachInfo.textContent = '0 file selected.';
    fileLabel.textContent = '📎 Choose attachments (max 3 files)';
    return;
  }

  const totalMB = (attachments.reduce((s,f)=>s+f.size,0) / 1024 / 1024).toFixed(1);
  attachInfo.innerHTML = `<strong>${attachments.length} file selected.</strong> (${totalMB} MB)`;
  fileLabel.textContent = `✅ ${attachments.length} selected file`;

  container.innerHTML = attachments.map((file, index) => `
    <div class="attached-file-item" data-index="${index}">
      <div class="file-info">
        <div class="file-icon">${getFileIcon(file.name)}</div>
        <div class="file-details">
          <div class="file-name">${file.name}</div>
          <div class="file-size">${formatFileSize(file.size)}</div>
        </div>
      </div>
      <button class="remove-file-btn" data-remove-index="${index}" title="Delete file">
        ×
      </button>
    </div>
  `).join('');

  // Gắn event listeners cho các nút remove
  container.querySelectorAll('.remove-file-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const index = parseInt(btn.getAttribute('data-remove-index'));
      removeAttachment(index);
    });
  });
}

// Function to remove attachment
function removeAttachment(index) {
  console.log('Removing attachment at index:', index);
  console.log('Current attachments:', attachments);
  
  const fileItem = document.querySelector(`[data-index="${index}"]`);
  
  if (!fileItem) {
    console.error('File item not found for index:', index);
    return;
  }
  
  // Add removing animation
  fileItem.classList.add('removing');
  
  // Remove after animation completes
  setTimeout(() => {
    // Remove the file at the specified index
    attachments.splice(index, 1);
    console.log('Attachments after removal:', attachments);
    renderAttachedFiles();
    saveCurrentState(); // Auto-save after removing attachment
  }, 300);
}

// Make removeAttachment available globally
window.removeAttachment = removeAttachment;

fileAttach.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  const fileLabel = document.querySelector('label[for="fileAttach"]');
  
  if (files.length === 0) {
    attachments = [];
    renderAttachedFiles();
    return;
  }
  
  if (files.length > 3) {
    status('You have selected more than 3 files — only the first 3 will be kept.', false);
  }
  const picked = files.slice(0, 3);

  // Update label to show loading
  fileLabel.textContent = '⏳ Processing files...';
  fileLabel.classList.add('loading');

  try {
    const newAttachments = await Promise.all(picked.map(async (f) => {
      const buf = await f.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      return {
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        base64,
        size: f.size
      };
    }));

    // Add new files to existing attachments (up to 3 total)
    attachments = [...attachments, ...newAttachments].slice(0, 3);
    
    fileLabel.classList.remove('loading');
    renderAttachedFiles();
    saveCurrentState(); // Auto-save after adding attachments
    
    // Reset file input
    e.target.value = '';
    
  } catch (err) {
    status('Error processing attachment: ' + err.message, false, true);
    fileLabel.textContent = '❌ Lỗi xử lý file';
    fileLabel.classList.remove('loading');
  }
});

// Xử lý Google Sheets trực tiếp qua API
async function handleGoogleSheets(url) {
  try {
    // Trích xuất spreadsheet ID từ URL
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      // Thử chuyển đổi sang CSV export
      const csvUrl = convertToCSVExport(url);
      if (csvUrl) {
        return await loadCSVFromLink(csvUrl);
      }
      throw new Error('Không thể trích xuất ID từ Google Sheets URL');
    }

    const spreadsheetId = match[1];
    
    // Gọi service worker để lấy dữ liệu qua Google Sheets API
    const { ok, data, error } = await sendMsg({ 
      type: 'FETCH_SHEET', 
      spreadsheetId, 
      rangeA1: 'Sheet1!A:C' // Lấy 3 cột đầu tiên
    });

    if (!ok) {
      // Fallback: thử export CSV
      const csvUrl = convertToCSVExport(url);
      if (csvUrl) {
        return await loadCSVFromLink(csvUrl);
      }
      throw new Error(error);
    }

    if (!data.values || data.values.length === 0) {
      return [];
    }

    return parseExcelData(data.values);
  } catch (e) {
    console.error('Google Sheets error:', e);
    // Fallback cuối cùng: thử CSV export
    try {
      const csvUrl = convertToCSVExport(url);
      if (csvUrl) {
        return await loadCSVFromLink(csvUrl);
      }
    } catch (csvError) {
      console.error('CSV fallback failed:', csvError);
    }
    throw e;
  }
}

// Chuyển đổi Google Sheets URL thành CSV export URL
function convertToCSVExport(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;
  
  const spreadsheetId = match[1];
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
}

// Xử lý CSV từ link
async function loadCSVFromLink(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const text = await res.text();
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length <= 1) return [];

    // Parse CSV đơn giản (có thể cải thiện với thư viện CSV parser)
    const data = lines.map(line => {
      // Xử lý CSV với dấu phẩy và quotes
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    });

    return parseExcelData(data);
  } catch (e) {
    console.error('CSV load error:', e);
    throw new Error(`Lỗi đọc CSV: ${e.message}`);
  }
}

// Parse dữ liệu Excel/CSV thành format chuẩn
function parseExcelData(data) {
  if (!data.length) {
    console.log('❌ No data found');
    return [];
  }

  // console.log('📊 Raw data structure:', {
  //   totalRows: data.length,
  //   firstRow: data[0],
  //   sampleRows: data.slice(0, 3)
  // });

  const headers = data[0].map(h => (h || '').toString().trim().toLowerCase());
  // console.log('🔍 Parsing headers:', headers);
  
  // Tìm các cột cần thiết (hỗ trợ nhiều tên cột)
  const companyIndex = headers.findIndex(h => 
    ['会社名', 'company', 'công ty', 'company name', '会社', 'cong ty', 'congty'].includes(h)
  );
  const nameIndex = headers.findIndex(h => 
    ['名前', 'name', 'tên', 'họ tên', 'full name', '氏名', 'ten', 'ho ten', 'hoten'].includes(h)
  );
  const emailIndex = headers.findIndex(h => 
    ['メール', 'email', 'mail', 'e-mail', 'メールアドレス', 'email address', 'e_mail'].includes(h)
  );

  // console.log('📍 Column indices found:', { companyIndex, nameIndex, emailIndex });

  // Nếu không tìm thấy theo tên, thử tìm theo vị trí (3 cột đầu tiên)
  if (companyIndex === -1 || nameIndex === -1 || emailIndex === -1) {
    console.log('⚠️ Column names not found, trying positional mapping...');
    
    if (headers.length >= 3) {
      console.log('✅ Using first 3 columns as Company, Name, Email');
      
      const fallbackRows = data.slice(1)
        .filter(row => {
          const isValid = row && row.length >= 3;
          if (!isValid) console.log('❌ Skipping invalid row:', row);
          return isValid;
        })
        .map((row, index) => {
          const result = {
            '会社名': (row[0] || '').toString().trim(),
            '名前': (row[1] || '').toString().trim(),
            'メール': (row[2] || '').toString().trim()
          };
          // console.log(`📝 Row ${index + 1} mapped:`, result);
          return result;
        })
        .filter((row, index) => {
          const hasEmail = row['メール'] && row['メール'].includes('@');
          if (!hasEmail) {
            console.log(`❌ Row ${index + 1} filtered out (invalid email):`, row['メール']);
          }
          return hasEmail;
        });
      
      // console.log('✅ Final fallback result:', fallbackRows);
      
      if (fallbackRows.length > 0) {
        return fallbackRows;
      }
    }
    
    throw new Error(`Không tìm thấy đủ cột cần thiết. Cần có: Công ty, Tên, Email.\nCác cột tìm thấy: ${headers.join(', ')}\n\nHoặc đảm bảo 3 cột đầu tiên là: Công ty | Tên | Email`);
  }

  // console.log('✅ Using named columns mapping');
  
  const result = data.slice(1)
    .filter((row, index) => {
      const isValid = row && row.length > Math.max(companyIndex, nameIndex, emailIndex);
      if (!isValid) console.log(`❌ Row ${index + 1} skipped (insufficient columns):`, row);
      return isValid;
    })
    .map((row, index) => {
      const result = {
        '会社名': (row[companyIndex] || '').toString().trim(),
        '名前': (row[nameIndex] || '').toString().trim(),
        'メール': (row[emailIndex] || '').toString().trim()
      };
      console.log(`📝 Row ${index + 1} mapped:`, result);
      return result;
    })
    .filter((row, index) => {
      const hasEmail = row['メール'] && row['メール'].includes('@');
      if (!hasEmail) {
        console.log(`❌ Row ${index + 1} filtered out (invalid email):`, row['メール']);
      }
      return hasEmail;
    });

  console.log('✅ Final parsed result:', result);
  return result;
}



btnSend.addEventListener('click', async () => {
  // Check if currently sending in background
  const { ok: statusOk, isRunning } = await sendMsg({ type: 'GET_SEND_STATUS' });
  
  if (statusOk && isRunning) {
    // Stop sending
    const { ok } = await sendMsg({ type: 'STOP_SENDING' });
    if (ok) {
      status('⏸️ Đã dừng gửi email', false);
      btnSend.textContent = '📧 Gửi Email';
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
      }
    }
    return;
  }
  
  // Debug: kiểm tra trạng thái trước khi gửi
  console.log('🚀 Send button clicked');
  console.log('📊 Current rows data:', rows);
  console.log('📝 Rows length:', rows.length);
  
  if (!rows.length) {
    console.log('❌ No customer data available');
    return status('Chưa có dữ liệu khách hàng.', false, true);
  }
  
  const subject = subjectEl.value.trim();
  console.log('📧 Subject:', subject);
  
  if (!subject) {
    console.log('❌ Subject is empty');
    return status('Tiêu đề đang trống.', false, true);
  }

  const templateBody = bodyEl.value || '';
  const delay = parseInt(delayEl.value || '1200', 10) || 1200;
  
  // Get CC emails
  const ccEmailsInput = document.getElementById('ccEmails').value.trim();
  const ccEmails = ccEmailsInput 
    ? ccEmailsInput.split(/[,;]/).map(e => e.trim()).filter(e => e)
    : [];

  console.log('⚙️ Settings:', { delay, attachmentsCount: attachments.length, ccEmails });

  status('🚀 Bắt đầu gửi ngầm... (có thể đóng popup)', true);
  logEl.textContent = 'Đang gửi email trong background...\n';

  const payload = {
    rows: rows.map(r => ({ company: r['会社名'], name: r['名前'], email: r['メール'] })),
    subject,
    templateBody,
    attachments,
    ccEmails,
    fromOverride: undefined,
    perEmailDelayMs: delay
  };

  console.log('📦 Payload prepared:', {
    rowsCount: payload.rows.length,
    subject: payload.subject,
    attachmentsCount: payload.attachments.length
  });
  
  console.log('👥 Payload rows detail:', payload.rows);

  try {
    console.log('📤 Starting background send...');
    const { ok, backgroundStarted, error } = await sendMsg({ 
      type: 'SEND_BATCH', 
      payload,
      backgroundMode: true 
    });
    
    if (!ok) {
      console.log('❌ Service worker returned error:', error);
      return status('Lỗi gửi: ' + error, false, true);
    }

    if (backgroundStarted) {
      console.log('✅ Background send started');
      btnSend.textContent = '⏸️ Dừng gửi';
      
      // Start polling for status
      if (statusCheckInterval) clearInterval(statusCheckInterval);
      statusCheckInterval = setInterval(checkSendStatus, 2000);
      
      status('📤 Đang gửi ngầm... Bạn có thể đóng popup.', true);
    }
  } catch (err) {
    console.error('💥 Error during send process:', err);
    status('Lỗi không mong đợi: ' + err.message, false, true);
  }
});

// -------- helpers ----------
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function status(text, ok = null, isErr = false) {
  statusEl.textContent = text;
  statusEl.className = 'small ' + (ok === null ? '' : ok ? 'ok' : 'err');
  if (isErr) console.error(text);
}

function renderPreview(rows) {
  if (!rows.length) { preview.textContent = 'Chưa có dữ liệu.'; preview.classList.add('muted'); return; }
  preview.classList.remove('muted');
  const first = rows.slice(0, 6).map(r => `会社名: ${r['会社名']} | 名前: ${r['名前']} | メール: ${r['メール']}`).join('\n');
  const more = rows.length > 6 ? `\n… (${rows.length - 6} dòng nữa)` : '';
  preview.textContent = first + more;
}

function sendMsg(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}
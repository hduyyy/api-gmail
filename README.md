# GITS Gmail Sender Extension

Extension Chrome để gửi email hàng loạt với dữ liệu từ Excel/Google Sheets.

## Tính năng chính

- ✅ Đọc dữ liệu từ file Excel (.xlsx, .xls, .csv)
- ✅ Đọc dữ liệu từ Google Sheets (qua link public)
- ✅ Gửi email cá nhân hóa qua Gmail API
- ✅ Đính kèm file (tối đa 3 file, 35MB)
- ✅ Template email với placeholder
- ✅ Điều chỉnh độ trễ giữa các email

## Cách sử dụng

### 1. Cài đặt Extension

1. Tải source code về máy
2. Mở Chrome → Extensions → Developer mode
3. Click "Load unpacked" → chọn thư mục chứa extension
4. Extension sẽ xuất hiện trong toolbar

### 2. Chuẩn bị dữ liệu

**Định dạng Excel/CSV cần có 3 cột:**

- Công ty (会社名, company, công ty)
- Tên (名前, name, tên, họ tên)
- Email (メール, email, mail)

**Ví dụ:**

```
会社名          | 名前      | メール
ABC Company     | 田中太郎   | tanaka@abc.com
XYZ Corp        | 佐藤花子   | sato@xyz.com
```

### 3. Sử dụng Extension

1. **Tải dữ liệu:**

   - Upload file Excel/CSV, hoặc
   - Dán link Google Sheets public

2. **Đính kèm file (tùy chọn):**

   - Chọn tối đa 3 file
   - Tổng dung lượng < 35MB

3. **Soạn email:**

   - Chỉnh sửa tiêu đề
   - Sử dụng placeholder: `{{会社名}}`, `{{名前}}`

4. **Đăng nhập & Gửi:**
   - Click "Đăng nhập Google"
   - Click "Gửi hàng loạt"

## Placeholder hỗ trợ

- `{{会社名}}` - Tên công ty
- `{{名前}}` - Tên người nhận (tự động thêm "様")

## Lưu ý

- Google Sheets cần được set public hoặc "Anyone with link can view"
- Gmail API có giới hạn gửi email (thường 100-500 email/ngày cho tài khoản thường)
- Nên set độ trễ >= 1000ms để tránh bị spam filter

## Troubleshooting

**Lỗi "Không tìm thấy đủ cột":**

- Kiểm tra tên cột trong Excel/Sheets
- Đảm bảo có đủ 3 cột: Công ty, Tên, Email

**Lỗi đăng nhập Google:**

- Kiểm tra OAuth client ID trong manifest.json
- Đảm bảo redirect URI được cấu hình đúng

**Lỗi gửi email:**

- Kiểm tra quyền Gmail API
- Kiểm tra kích thước file đính kèm
- Thử giảm tốc độ gửi (tăng delay)

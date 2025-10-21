# 📁 Thư mục Quizzes

Thư mục này lưu trữ các file quiz theo tên người tạo.

## 📝 Cách hoạt động

### Khi tạo quiz:
1. Host nhập tên (ví dụ: "Nguyễn Văn A")
2. Tạo và lưu quiz
3. File được lưu: `nguyen-van-a.json`

### Khi load quiz:
1. Host nhập cùng tên: "Nguyễn Văn A"
2. Hệ thống tìm file: `nguyen-van-a.json`
3. Load quiz cũ để chỉnh sửa

## 📊 Format file JSON

```json
{
  "hostName": "Nguyễn Văn A",
  "quiz": {
    "questions": [
      {
        "question": "Câu hỏi?",
        "options": ["A", "B", "C", "D"],
        "correctAnswer": 0,
        "timeLimit": 30
      }
    ],
    "createdAt": "2025-10-19T12:00:00.000Z"
  },
  "savedAt": "2025-10-19T12:00:00.000Z"
}
```

## 🔧 Tên file

Tên file được tạo từ tên host:
- Chuyển thành chữ thường
- Thay ký tự đặc biệt bằng dấu `-`
- Thêm `.json`

**Ví dụ:**
- "Nguyễn Văn A" → `nguyen-van-a.json`
- "John Doe" → `john-doe.json`
- "Admin@123" → `admin-123.json`

## 📌 Lưu ý

- File tự động tạo khi lưu quiz
- Mỗi host có 1 file riêng
- Lưu quiz mới sẽ ghi đè quiz cũ
- Không được commit các file quiz vào git (đã có trong .gitignore)

## 🗑️ Xóa quiz

Để xóa quiz của một host, xóa file JSON tương ứng:
```bash
# Windows
del quizzes\nguyen-van-a.json

# Linux/Mac
rm quizzes/nguyen-van-a.json
```

---

**Tip:** Backup thư mục này thường xuyên để không mất quiz! 💾


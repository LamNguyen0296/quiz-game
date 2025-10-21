# 🎯 Hướng dẫn sử dụng Quiz Game

## 📖 Tổng quan

Quiz Game là tính năng trò chơi đố vui được tích hợp vào ứng dụng, cho phép Host tạo các câu hỏi và người chơi tham gia trả lời theo thời gian thực.

## ✨ Tính năng

- ✅ Host tạo tối đa 10 câu hỏi
- ✅ Mỗi câu hỏi có 4 đáp án (A, B, C, D)
- ✅ Cài đặt thời gian cho mỗi câu (5-120 giây)
- ✅ Đếm ngược thời gian real-time
- ✅ Tính điểm dựa trên độ chính xác và tốc độ
- ✅ Bảng xếp hạng với top 3 được highlight
- ✅ Responsive trên mọi thiết bị

## 🚀 Cách sử dụng

### 📝 Dành cho Host (Người tạo quiz)

#### 1. Tạo phòng và Quiz
```
1. Mở quiz.html
2. Nhập tên của bạn
3. Click "Tạo phòng" → Nhận mã phòng 6 ký tự
4. Click "➕ Thêm câu hỏi" để tạo câu hỏi
```

#### 2. Thiết lập câu hỏi
Mỗi câu hỏi cần:
- **Câu hỏi**: Nội dung câu hỏi
- **4 Đáp án**: A, B, C, D
- **Đáp án đúng**: Chọn A, B, C hoặc D
- **Thời gian**: 5-120 giây (mặc định 30s)

Ví dụ:
```
Câu hỏi: Thủ đô của Việt Nam là gì?
A. Hà Nội
B. TP.HCM
C. Đà Nẵng
D. Huế
Đáp án đúng: A
Thời gian: 15 giây
```

#### 3. Lưu và bắt đầu
```
1. Click "💾 Lưu Quiz" khi đã tạo xong
2. Chia sẻ mã phòng cho người chơi
3. Đợi người chơi tham gia
4. Click "🚀 Bắt đầu Quiz"
```

#### 4. Điều khiển Quiz
- **Câu tiếp theo ▶**: Chuyển sang câu tiếp theo
- **Kết thúc Quiz**: Kết thúc và xem kết quả
- Quan sát timer đếm ngược
- Không cần trả lời (Host chỉ điều khiển)

### 🎮 Dành cho Người chơi

#### 1. Tham gia phòng
```
1. Mở quiz.html
2. Nhập tên của bạn
3. Nhập mã phòng (6 ký tự)
4. Click "Tham gia phòng"
```

#### 2. Chơi Quiz
```
1. Đợi Host bắt đầu quiz
2. Đọc câu hỏi
3. Click chọn đáp án (A, B, C, hoặc D)
4. Đợi câu tiếp theo
```

**Lưu ý:**
- Trả lời càng nhanh càng tốt (ảnh hưởng điểm số)
- Chỉ chọn được 1 lần cho mỗi câu
- Không thể thay đổi sau khi đã chọn

#### 3. Xem kết quả
Sau khi kết thúc:
- 🥇 **Top 1**: Vàng óng ánh
- 🥈 **Top 2**: Bạc lấp lánh  
- 🥉 **Top 3**: Đồng rực rỡ
- Hiển thị: Tên, số câu đúng, điểm số

## 🎯 Hệ thống tính điểm

```javascript
Điểm = (Số câu đúng × 1000) - (Tổng thời gian / 100)
```

**Ví dụ:**
- Người A: 10/10 câu đúng, thời gian 50 giây
  - Điểm = (10 × 1000) - (5000 / 100) = 10,000 - 50 = **9,950 điểm**

- Người B: 10/10 câu đúng, thời gian 100 giây
  - Điểm = (10 × 1000) - (10000 / 100) = 10,000 - 100 = **9,900 điểm**

- Người C: 8/10 câu đúng, thời gian 40 giây
  - Điểm = (8 × 1000) - (4000 / 100) = 8,000 - 40 = **7,960 điểm**

**Kết quả:**
1. 🥇 Người A - 9,950 điểm
2. 🥈 Người B - 9,900 điểm
3. 🥉 Người C - 7,960 điểm

## 🔧 Socket.IO Events

### Host → Server
```javascript
// Tạo quiz
socket.emit('create-quiz', {
  questions: [{
    question: "Câu hỏi?",
    options: ["A", "B", "C", "D"],
    correctAnswer: 0, // Index: 0=A, 1=B, 2=C, 3=D
    timeLimit: 30
  }]
});

// Bắt đầu quiz
socket.emit('start-quiz');

// Câu tiếp theo
socket.emit('next-question');

// Kết thúc quiz
socket.emit('end-quiz');
```

### Player → Server
```javascript
// Gửi câu trả lời
socket.emit('submit-answer', {
  questionIndex: 0,
  answer: 2 // Index: 0=A, 1=B, 2=C, 3=D
});
```

### Server → Client
```javascript
// Quiz đã được tạo
socket.on('quiz-created', (data) => { });

// Quiz bắt đầu
socket.on('quiz-started', (data) => {
  // data: {question, options, timeLimit, questionNumber, totalQuestions}
});

// Câu hỏi tiếp theo
socket.on('next-question', (data) => {
  // data: {question, options, timeLimit, questionNumber, totalQuestions}
});

// Quiz kết thúc
socket.on('quiz-ended', (data) => {
  // data.results: [{playerName, correctAnswers, totalQuestions, score}]
});

// Đã gửi đáp án
socket.on('answer-submitted', () => { });
```

## 📂 File structure

```
point/
├── quiz.html           # Giao diện Quiz Game (standalone)
├── server.js           # Server với quiz logic
├── index.html          # Giao diện chính (presentation)
└── QUIZ_GUIDE.md       # File này
```

## 🎨 Tùy chỉnh

### Thay đổi giới hạn câu hỏi
```javascript
// Trong quiz.html
function addQuestion() {
    if (questions.length >= 10) { // Thay đổi số 10
        alert('Tối đa 10 câu hỏi!');
        return;
    }
    // ...
}
```

### Thay đổi công thức tính điểm
```javascript
// Trong server.js - function endQuiz()
player.score = (correctAnswers * 1000) - Math.floor(totalTime / 100);
```

### Thay đổi thời gian mặc định
```javascript
// Trong quiz.html - function addQuestion()
timeLimit: 30 // Thay đổi số giây
```

## 💡 Tips & Tricks

### Cho Host:
- Tạo câu hỏi ngắn gọn, dễ hiểu
- Thời gian phù hợp: 15-30s cho câu dễ, 45-60s cho câu khó
- Test quiz trước với vài người bạn
- Đọc câu hỏi to để mọi người cùng nghe

### Cho Người chơi:
- Đọc kỹ câu hỏi trước khi chọn
- Đừng vội vàng, nhưng cũng đừng quá chậm
- Tập trung vào độ chính xác hơn tốc độ
- Có thể chơi trên điện thoại hoặc máy tính

## 🐛 Troubleshooting

**Quiz không bắt đầu?**
- Kiểm tra Host đã click "🚀 Bắt đầu Quiz"
- Kiểm tra đã lưu quiz chưa
- Refresh trang và thử lại

**Không chọn được đáp án?**
- Có thể bạn đã chọn rồi (mỗi câu chỉ chọn 1 lần)
- Hết thời gian (timer = 0)
- Kiểm tra kết nối internet

**Điểm số không đúng?**
- Điểm phụ thuộc cả vào tốc độ
- Trả lời nhanh = điểm cao hơn
- Công thức: (Câu đúng × 1000) - (Thời gian / 100)

**Host không thấy nút điều khiển?**
- Kiểm tra bạn có phải là người tạo phòng không
- Refresh và tạo phòng mới

## 🌟 Ý tưởng mở rộng

- [ ] Thêm loại câu hỏi: True/False, Multiple choice
- [ ] Upload ảnh cho câu hỏi
- [ ] Âm thanh khi hết giờ/đúng/sai
- [ ] Export kết quả ra Excel/PDF
- [ ] Lưu quiz template để dùng lại
- [ ] Power-ups: 50:50, Skip, Double points
- [ ] Team mode: Chơi theo đội
- [ ] Streak bonus: Liên tiếp đúng được bonus

## 📞 Support

Nếu gặp vấn đề, hãy kiểm tra:
1. Server đang chạy (`npm start`)
2. Kết nối Socket.IO (xem console log)
3. Mã phòng đúng (6 ký tự)
4. Trình duyệt hỗ trợ (Chrome/Firefox/Edge/Safari mới nhất)

---

**Chúc bạn có những phút giây vui vẻ với Quiz Game! 🎉**


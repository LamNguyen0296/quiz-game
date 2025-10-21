# 🎯 Quiz Game - Socket.IO

Ứng dụng trò chơi đố vui real-time sử dụng Socket.IO. Host tạo câu hỏi, người chơi tham gia trả lời, và hệ thống tự động tính điểm dựa trên độ chính xác và tốc độ!

## ✨ Tính năng

- 🚪 **Tạo phòng**: Tạo phòng với mã 6 ký tự ngẫu nhiên
- 🔗 **Tham gia phòng**: Người chơi tham gia bằng mã phòng
- 👥 **Nhiều người chơi**: Không giới hạn số người tham gia
- 👑 **Hệ thống Host**: Host tạo và điều khiển quiz
- 📝 **Tạo quiz**: Tối đa 10 câu hỏi với 4 đáp án
- ⏱️ **Đếm thời gian**: Mỗi câu có thể đặt thời gian từ 5-120 giây
- 🎯 **Trả lời real-time**: Chọn đáp án A, B, C, hoặc D
- 🏆 **Tính điểm tự động**: Dựa trên độ chính xác và tốc độ
- 🥇 **Bảng xếp hạng**: Top 3 được highlight đặc biệt
- 💾 **Lưu quiz tự động**: Quiz được lưu vào file JSON theo tên host
- 📂 **Load & Edit**: Nhập tên cũ để load và sửa quiz đã lưu
- 📱 **Responsive**: Hoạt động tốt trên mọi thiết bị
- ⚡ **Real-time sync**: Socket.IO đồng bộ mọi thứ

## 📋 Yêu cầu

- Node.js (phiên bản 14 trở lên)
- npm hoặc yarn

## 🚀 Cài đặt và Chạy

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Chạy server

```bash
npm start
```

Hoặc dùng nodemon (tự động restart):

```bash
npm run dev
```

### 3. Mở trình duyệt

```
http://localhost:3000
```

## 🎮 Hướng dẫn sử dụng

### 📝 Dành cho Host (Người tạo quiz)

1. **Tạo phòng**
   - Nhập tên của bạn (ví dụ: "Nguyễn Văn A")
   - Click "Tạo phòng"
   - **Nếu đã có quiz**: Chọn Load (sửa quiz cũ) hoặc Cancel (tạo mới)
   - **Nếu chưa có quiz**: Tự động tạo mới
   - Nhận mã phòng 6 ký tự (ví dụ: ABC123)

2. **Tạo câu hỏi**
   - Click "➕ Thêm câu hỏi" (tối đa 10 câu)
   - Điền thông tin cho mỗi câu:
     - Câu hỏi
     - 4 đáp án (A, B, C, D)
     - Chọn đáp án đúng
     - Đặt thời gian (5-120 giây)

3. **Lưu quiz**
   - Click "💾 Lưu Quiz"
   - Chia sẻ mã phòng cho người chơi

4. **Bắt đầu và điều khiển**
   - Đợi người chơi tham gia
   - Click "🚀 Bắt đầu Quiz"
   - Click "Câu tiếp theo ▶" để chuyển câu
   - Click "Kết thúc Quiz" khi xong
   - Xem bảng xếp hạng

### 🎮 Dành cho Người chơi

1. **Tham gia phòng**
   - Nhập tên của bạn
   - Nhập mã phòng (6 ký tự)
   - Click "Tham gia phòng"

2. **Chơi quiz**
   - Đợi Host bắt đầu
   - Đọc câu hỏi
   - Click chọn đáp án (A, B, C, D)
   - Trả lời càng nhanh càng tốt!

3. **Xem kết quả**
   - Xem bảng xếp hạng cuối cùng
   - 🥇 Top 1: Vàng
   - 🥈 Top 2: Bạc
   - 🥉 Top 3: Đồng

## 🎯 Hệ thống tính điểm

```javascript
Điểm = (Số câu đúng × 1000) - (Tổng thời gian / 100)
```

**Ví dụ:**
- Người A: 10/10 đúng, 50 giây → **9,950 điểm** 🥇
- Người B: 10/10 đúng, 100 giây → **9,900 điểm** 🥈
- Người C: 8/10 đúng, 40 giây → **7,960 điểm** 🥉

➡️ **Càng đúng nhiều, càng nhanh thì điểm càng cao!**

## 💾 Lưu trữ & Load Quiz

### Cách hoạt động:

**Khi tạo quiz lần đầu:**
1. Nhập tên: "Nguyễn Văn A"
2. Tạo quiz → Lưu tự động
3. File: `quizzes/nguyen-van-a.json`

**Khi muốn sửa quiz:**
1. Nhập cùng tên: "Nguyễn Văn A"
2. Hệ thống hỏi: Load quiz cũ hay tạo mới?
3. Chọn **OK** → Load quiz với X câu hỏi
4. Sửa và lưu lại

### Lợi ích:

✅ **Không mất quiz** khi restart server  
✅ **Sửa dễ dàng** - Load lại và chỉnh sửa  
✅ **Mỗi host 1 file** - Không bị nhầm lẫn  
✅ **Tự động lưu** - Không cần thao tác thêm

### Tên file:

Tên được chuyển đổi tự động:
- "Nguyễn Văn A" → `nguyen-van-a.json`
- "John Doe" → `john-doe.json`
- "Teacher@123" → `teacher-123.json`

### Xóa quiz:

```bash
# Xóa file JSON trong thư mục quizzes/
del quizzes\nguyen-van-a.json  # Windows
rm quizzes/nguyen-van-a.json   # Linux/Mac
```

## 📂 Cấu trúc dự án

```
quiz-game/
├── index.html          # Giao diện Quiz Game
├── server.js           # Server Socket.IO + File handling
├── package.json        # Dependencies
├── README.md           # File này
├── QUIZ_GUIDE.md       # Hướng dẫn chi tiết
├── START.md            # Khởi động nhanh
├── .gitignore          # Git ignore
└── quizzes/            # Thư mục lưu quiz (JSON files)
    ├── .gitkeep
    └── README.md       # Hướng dẫn thư mục quizzes
```

## 🔧 Socket.IO Events

### Client → Server

```javascript
// Tạo phòng
socket.emit('create-room', { playerName: 'Tên' });

// Tham gia phòng
socket.emit('join-room', { roomCode: 'ABC123', playerName: 'Tên' });

// Tạo quiz (Host)
socket.emit('create-quiz', { 
  questions: [{
    question: "Câu hỏi?",
    options: ["A", "B", "C", "D"],
    correctAnswer: 0,
    timeLimit: 30
  }]
});

// Bắt đầu quiz (Host)
socket.emit('start-quiz');

// Gửi câu trả lời
socket.emit('submit-answer', { questionIndex: 0, answer: 2 });

// Câu tiếp theo (Host)
socket.emit('next-question');

// Kết thúc quiz (Host)
socket.emit('end-quiz');

// Rời phòng
socket.emit('leave-room');
```

### Server → Client

```javascript
// Phòng đã được tạo
socket.on('room-created', (data) => { });

// Đã tham gia phòng
socket.on('room-joined', (data) => { });

// Lỗi khi tham gia
socket.on('join-error', (data) => { });

// Người chơi mới tham gia
socket.on('player-joined', (data) => { });

// Người chơi rời phòng
socket.on('player-left', (data) => { });

// Quiz đã được tạo
socket.on('quiz-created', (data) => { });

// Quiz bắt đầu (câu hỏi đầu tiên)
socket.on('quiz-started', (data) => {
  // data: {question, options, timeLimit, questionNumber, totalQuestions}
});

// Câu hỏi tiếp theo
socket.on('next-question', (data) => {
  // data: {question, options, timeLimit, questionNumber, totalQuestions}
});

// Đã nhận câu trả lời
socket.on('answer-submitted', () => { });

// Quiz kết thúc (kết quả)
socket.on('quiz-ended', (data) => {
  // data.results: [{playerName, correctAnswers, totalQuestions, score}]
});
```

## 💡 Tips & Tricks

### Cho Host:
- ✅ Tạo câu hỏi ngắn gọn, dễ hiểu
- ✅ Thời gian phù hợp: 15-30s câu dễ, 45-60s câu khó
- ✅ Test quiz với bạn bè trước khi dùng thật
- ✅ Đọc to câu hỏi nếu chơi cùng phòng

### Cho Người chơi:
- ✅ Đọc kỹ câu hỏi trước khi chọn
- ✅ Cân bằng giữa tốc độ và độ chính xác
- ✅ Có thể chơi trên điện thoại hoặc máy tính
- ✅ Tập trung là quan trọng nhất!

## 🧪 Test nhanh

Mở **3 tab trình duyệt**:

1. **Tab 1 (Host)**: 
   - Tạo phòng → Tạo quiz → Bắt đầu
   
2. **Tab 2, 3 (Players)**: 
   - Nhập mã phòng → Tham gia → Chơi

3. **Xem ai thắng!** 🏆

## 🐛 Troubleshooting

**Quiz không bắt đầu?**
- Kiểm tra đã lưu quiz chưa
- Refresh trang và thử lại

**Không chọn được đáp án?**
- Có thể đã chọn rồi (chỉ chọn 1 lần)
- Hết thời gian (timer = 0)

**Điểm số không đúng?**
- Điểm phụ thuộc cả tốc độ
- Trả lời nhanh = điểm cao hơn

**Port 3000 đã được sử dụng?**
```bash
# Windows
set PORT=4000
npm start

# Linux/Mac
export PORT=4000
npm start
```

## 🌟 Tính năng có thể mở rộng

- [ ] Loại câu hỏi: True/False, Multiple correct
- [ ] Upload ảnh cho câu hỏi
- [ ] Âm thanh/hiệu ứng
- [ ] Export kết quả ra Excel/PDF
- [ ] Lưu quiz template để dùng lại
- [ ] Power-ups: 50:50, Skip, Double points
- [ ] Team mode: Chơi theo đội
- [ ] Streak bonus: Liên tiếp đúng được bonus
- [ ] Chat trong phòng
- [ ] Ranking toàn server

## 📖 Documentation

- **README.md** (file này): Hướng dẫn cơ bản
- **QUIZ_GUIDE.md**: Hướng dẫn chi tiết đầy đủ

## 📄 License

MIT License - Tự do sử dụng và chỉnh sửa

## 🎨 Technologies

- **Node.js** - Runtime
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **Vanilla JavaScript** - Client-side
- **HTML5/CSS3** - UI/UX

## 👨‍💻 Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run in production
npm start
```

## 🤝 Contributing

Mọi đóng góp đều được chào đón! 

1. Fork dự án
2. Tạo branch mới (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

**Chúc bạn có những phút giây vui vẻ với Quiz Game! 🎉**

💡 **Tips**: Mở nhiều tab để test tính năng multiplayer!

🌟 **Star** repo này nếu bạn thấy hữu ích!

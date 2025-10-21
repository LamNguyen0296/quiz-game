const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// Tạo thư mục quizzes nếu chưa có
const quizzesDir = path.join(__dirname, 'quizzes');
if (!fs.existsSync(quizzesDir)) {
    fs.mkdirSync(quizzesDir);
}

// Tạo thư mục uploads nếu chưa có
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Cấu hình multer để upload file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        // Tạo tên file unique: timestamp-originalname
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

// Kiểm tra loại file
const fileFilter = (req, file, cb) => {
    // Chấp nhận image và video
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
        cb(null, true);
    } else {
        cb(new Error('Chỉ chấp nhận file ảnh hoặc video!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // Giới hạn 50MB
    }
});

// Lưu trữ thông tin các phòng
const rooms = new Map();

// Helper functions cho file operations
function sanitizeFileName(name) {
    // Chuyển tên thành file name hợp lệ
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function getQuizFilePath(hostName) {
    const fileName = sanitizeFileName(hostName) + '.json';
    return path.join(quizzesDir, fileName);
}

function saveQuizToFile(hostName, quiz) {
    try {
        const filePath = getQuizFilePath(hostName);
        const data = {
            hostName: hostName,
            quiz: quiz,
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Quiz saved for ${hostName}`);
        return true;
    } catch (error) {
        console.error('Error saving quiz:', error);
        return false;
    }
}

function loadQuizFromFile(hostName) {
    try {
        const filePath = getQuizFilePath(hostName);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Quiz loaded for ${hostName}`);
            return data.quiz;
        }
        return null;
    } catch (error) {
        console.error('Error loading quiz:', error);
        return null;
    }
}

function checkQuizExists(hostName) {
    const filePath = getQuizFilePath(hostName);
    return fs.existsSync(filePath);
}

// Tạo mã phòng ngẫu nhiên
function generateRoomCode() {
    let code = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}

// Hàm kết thúc quiz và tính điểm
function endQuiz(room, roomCode) {
    if (!room.quiz || !room.quizActive) return;

    room.quizActive = false;

    // Khởi tạo điểm cho mỗi người chơi
    const playerScores = new Map();
    const playerDetails = new Map();
    
    room.players.filter(p => !p.isHost).forEach(player => {
        playerScores.set(player.id, 0);
        playerDetails.set(player.id, []);
    });

    // Tính điểm cho từng câu hỏi
    room.quiz.questions.forEach((question, qIndex) => {
        // Lấy tất cả câu trả lời đúng cho câu hỏi này
        const correctAnswers = [];
        
        room.players.filter(p => !p.isHost).forEach(player => {
            const key = `${player.id}-${qIndex}`;
            const playerAnswer = room.answers.get(key);
            
            if (playerAnswer && playerAnswer.answer === question.correctAnswer) {
                correctAnswers.push({
                    playerId: player.id,
                    timestamp: playerAnswer.timestamp
                });
            }
        });

        // Sắp xếp theo thời gian (nhanh nhất -> chậm nhất)
        correctAnswers.sort((a, b) => a.timestamp - b.timestamp);

        // Điểm theo thứ tự: 5, 4, 3, 2
        const pointsMap = [5, 4, 3, 2];
        correctAnswers.forEach((answer, index) => {
            const points = pointsMap[index] || 0;
            const currentScore = playerScores.get(answer.playerId) || 0;
            playerScores.set(answer.playerId, currentScore + points);
        });

        // Lưu chi tiết từng câu cho mỗi người chơi
        room.players.filter(p => !p.isHost).forEach(player => {
            const key = `${player.id}-${qIndex}`;
            const playerAnswer = room.answers.get(key);
            
            let isCorrect = false;
            let answerIndex = null;
            let pointsEarned = 0;

            if (playerAnswer) {
                answerIndex = playerAnswer.answer;
                isCorrect = playerAnswer.answer === question.correctAnswer;
                
                if (isCorrect) {
                    const rank = correctAnswers.findIndex(a => a.playerId === player.id);
                    pointsEarned = pointsMap[rank] || 0;
                }
            }

            const details = playerDetails.get(player.id);
            details.push({
                questionIndex: qIndex,
                question: question.question,
                options: question.options,
                correctAnswer: question.correctAnswer,
                playerAnswer: answerIndex,
                isCorrect: isCorrect,
                answered: playerAnswer !== undefined,
                pointsEarned: pointsEarned
            });
        });
    });

    // Tạo kết quả
    const results = [];
    room.players.filter(p => !p.isHost).forEach(player => {
        const score = playerScores.get(player.id) || 0;
        const details = playerDetails.get(player.id) || [];
        const correctAnswers = details.filter(d => d.isCorrect).length;

        player.score = score;

        results.push({
            playerId: player.id,
            playerName: player.name,
            correctAnswers: correctAnswers,
            totalQuestions: room.quiz.questions.length,
            score: score,
            details: details
        });
    });

    // Sắp xếp theo điểm
    results.sort((a, b) => b.score - a.score);

    // Gửi kết quả
    io.to(roomCode).emit('quiz-ended', {
        results: results
    });

    console.log(`Quiz ended in room ${roomCode}`);
}

// HTTP API endpoints
app.post('/api/check-quiz', (req, res) => {
    const { hostName } = req.body;
    if (!hostName) {
        return res.status(400).json({ error: 'Host name required' });
    }
    
    const exists = checkQuizExists(hostName);
    const quiz = exists ? loadQuizFromFile(hostName) : null;
    
    res.json({ 
        exists: exists,
        quiz: quiz
    });
});

// API upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Không có file được upload!' });
        }

        // Trả về đường dẫn file
        const filePath = '/uploads/' + req.file.filename;
        const fileType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';

        res.json({
            success: true,
            filePath: filePath,
            fileType: fileType,
            fileName: req.file.originalname
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Lỗi khi upload file!' });
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Tạo phòng mới
    socket.on('create-room', (data) => {
        const roomCode = generateRoomCode();
        const playerName = data.playerName || 'Player';
        const loadExisting = data.loadExisting || false;
        
        // Tạo phòng mới
        rooms.set(roomCode, {
            host: socket.id,
            players: [{
                id: socket.id,
                name: playerName,
                isHost: true,
                score: 0
            }],
            createdAt: new Date(),
            quiz: null,
            quizActive: false,
            currentQuestion: 0,
            answers: new Map()
        });

        // Join socket room
        socket.join(roomCode);
        socket.roomCode = roomCode;

        console.log(`Room created: ${roomCode} by ${playerName}${loadExisting ? ' (loading existing quiz)' : ''}`);

        // Gửi mã phòng về cho người tạo
        socket.emit('room-created', {
            roomCode: roomCode,
            playerName: playerName,
            isHost: true,
            loadExisting: loadExisting
        });
    });

    // Tham gia phòng
    socket.on('join-room', (data) => {
        const { roomCode, playerName } = data;
        
        // Kiểm tra phòng có tồn tại không
        if (!rooms.has(roomCode)) {
            socket.emit('join-error', { message: 'Phòng không tồn tại!' });
            return;
        }

        const room = rooms.get(roomCode);
        
        // Kiểm tra xem người chơi đã ở trong phòng chưa
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (existingPlayer) {
            socket.emit('join-error', { message: 'Bạn đã ở trong phòng này!' });
            return;
        }

        // Kiểm tra số lượng người chơi (không tính host, tối đa 4 người)
        const playerCount = room.players.filter(p => !p.isHost).length;
        if (playerCount >= 4) {
            socket.emit('join-error', { message: 'Phòng đã đầy! (Tối đa 4 người chơi)' });
            return;
        }

        // Thêm người chơi vào phòng
        room.players.push({
            id: socket.id,
            name: playerName || 'Player',
            isHost: false,
            score: 0
        });

        // Join socket room
        socket.join(roomCode);
        socket.roomCode = roomCode;

        console.log(`${playerName} joined room: ${roomCode}`);

        // Thông báo cho người chơi đã join thành công
        socket.emit('room-joined', {
            roomCode: roomCode,
            playerName: playerName,
            isHost: false,
            players: room.players
        });

        // Thông báo cho tất cả người chơi trong phòng
        io.to(roomCode).emit('player-joined', {
            player: {
                id: socket.id,
                name: playerName,
                isHost: false
            },
            players: room.players
        });
    });

    // Lấy danh sách người chơi trong phòng
    socket.on('get-players', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            socket.emit('players-list', { players: room.players });
        }
    });

    // ============ QUIZ EVENTS ============

    // Tạo quiz (chỉ host)
    socket.on('create-quiz', (data) => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể tạo quiz!' });
                return;
            }

            // Validate quiz data
            if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0 || data.questions.length > 10) {
                socket.emit('error', { message: 'Quiz phải có từ 1 đến 10 câu hỏi!' });
                return;
            }

            room.quiz = {
                questions: data.questions,
                createdAt: new Date()
            };
            room.quizActive = false;
            room.currentQuestion = 0;
            room.answers = new Map();

            // Reset scores
            room.players.forEach(p => p.score = 0);

            // Lưu quiz vào file theo tên host
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                const saved = saveQuizToFile(hostPlayer.name, room.quiz);
                socket.emit('quiz-created', { 
                    success: true,
                    saved: saved,
                    message: saved ? 'Quiz đã được lưu!' : 'Quiz đã tạo nhưng không lưu được vào file'
                });
            } else {
                socket.emit('quiz-created', { success: true });
            }

            console.log(`Quiz created in room ${socket.roomCode} with ${data.questions.length} questions`);
        }
    });

    // Bắt đầu quiz (chỉ host)
    socket.on('start-quiz', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể bắt đầu quiz!' });
                return;
            }

            if (!room.quiz || room.quiz.questions.length === 0) {
                socket.emit('error', { message: 'Chưa có quiz nào được tạo!' });
                return;
            }

            room.quizActive = true;
            room.currentQuestion = 0;
            room.answers = new Map();

            // Reset scores
            room.players.forEach(p => p.score = 0);

            // Gửi câu hỏi đầu tiên
            const firstQuestion = room.quiz.questions[0];
            io.to(socket.roomCode).emit('quiz-started', {
                totalQuestions: room.quiz.questions.length,
                currentQuestion: 0,
                question: firstQuestion.question,
                options: firstQuestion.options,
                timeLimit: firstQuestion.timeLimit || 30,
                questionNumber: 1,
                mediaPath: firstQuestion.mediaPath || null,
                mediaType: firstQuestion.mediaType || null
            });

            console.log(`Quiz started in room ${socket.roomCode}`);
        }
    });

    // Gửi câu trả lời
    socket.on('submit-answer', (data) => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            if (!room.quizActive) {
                socket.emit('error', { message: 'Quiz không hoạt động!' });
                return;
            }

            const questionIndex = data.questionIndex;
            const answer = data.answer;
            const timestamp = Date.now();

            // Lưu câu trả lời
            const key = `${socket.id}-${questionIndex}`;
            if (!room.answers.has(key)) {
                room.answers.set(key, {
                    playerId: socket.id,
                    questionIndex: questionIndex,
                    answer: answer,
                    timestamp: timestamp
                });

                console.log(`Answer received from ${socket.id} for question ${questionIndex}: ${answer}`);
                socket.emit('answer-submitted', { success: true });
            }
        }
    });

    // Chuyển câu hỏi tiếp theo (chỉ host)
    socket.on('next-question', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể chuyển câu hỏi!' });
                return;
            }

            if (!room.quizActive || !room.quiz) {
                socket.emit('error', { message: 'Quiz không hoạt động!' });
                return;
            }

            room.currentQuestion++;

            if (room.currentQuestion < room.quiz.questions.length) {
                // Gửi câu hỏi tiếp theo
                const nextQuestion = room.quiz.questions[room.currentQuestion];
                io.to(socket.roomCode).emit('next-question', {
                    currentQuestion: room.currentQuestion,
                    question: nextQuestion.question,
                    options: nextQuestion.options,
                    timeLimit: nextQuestion.timeLimit || 30,
                    questionNumber: room.currentQuestion + 1,
                    totalQuestions: room.quiz.questions.length,
                    mediaPath: nextQuestion.mediaPath || null,
                    mediaType: nextQuestion.mediaType || null
                });

                console.log(`Next question ${room.currentQuestion + 1} in room ${socket.roomCode}`);
            } else {
                // Kết thúc quiz
                endQuiz(room, socket.roomCode);
            }
        }
    });

    // Kết thúc quiz (chỉ host)
    socket.on('end-quiz', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể kết thúc quiz!' });
                return;
            }

            endQuiz(room, socket.roomCode);
        }
    });

    // Lấy thông tin quiz
    socket.on('get-quiz-info', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            socket.emit('quiz-info', {
                hasQuiz: !!room.quiz,
                quizActive: room.quizActive,
                currentQuestion: room.currentQuestion,
                totalQuestions: room.quiz ? room.quiz.questions.length : 0
            });
        }
    });

    // Ngắt kết nối
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Tìm và xóa người chơi khỏi phòng
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const playerName = room.players[playerIndex].name;
                room.players.splice(playerIndex, 1);

                // Nếu không còn người chơi nào, xóa phòng
                if (room.players.length === 0) {
                    rooms.delete(socket.roomCode);
                    console.log(`Room ${socket.roomCode} deleted (empty)`);
                } else {
                    // Nếu host rời đi, chọn host mới
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                        room.players[0].isHost = true;
                    }

                    // Thông báo cho những người còn lại
                    io.to(socket.roomCode).emit('player-left', {
                        playerId: socket.id,
                        playerName: playerName,
                        players: room.players
                    });
                }
            }
        }
    });

    // Rời phòng
    socket.on('leave-room', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const playerName = room.players[playerIndex].name;
                room.players.splice(playerIndex, 1);

                socket.leave(socket.roomCode);

                // Nếu không còn người chơi nào, xóa phòng
                if (room.players.length === 0) {
                    rooms.delete(socket.roomCode);
                    console.log(`Room ${socket.roomCode} deleted (empty)`);
                } else {
                    // Nếu host rời đi, chọn host mới
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                        room.players[0].isHost = true;
                    }

                    // Thông báo cho những người còn lại
                    io.to(socket.roomCode).emit('player-left', {
                        playerId: socket.id,
                        playerName: playerName,
                        players: room.players
                    });
                }

                socket.roomCode = null;
                socket.emit('left-room');
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🎯 Quiz Game Server đang chạy tại http://localhost:${PORT}`);
    console.log(`📝 Truy cập: http://localhost:${PORT}`);
});

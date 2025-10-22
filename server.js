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

// Helper functions cho scores file operations
function getScoresFilePath(hostName) {
    const fileName = sanitizeFileName(hostName) + '-scores.json';
    return path.join(quizzesDir, fileName);
}

function saveScoresToFile(hostName, roomCode, players) {
    try {
        const filePath = getScoresFilePath(hostName);
        
        // Lọc chỉ lấy người chơi (không phải host) và lấy top 4
        const playerScores = players
            .filter(p => !p.isHost)
            .slice(0, 4)
            .map(p => ({
                name: p.name,
                score: p.score || 0,
                id: p.id
            }));

        const data = {
            hostName: hostName,
            roomCode: roomCode,
            scores: playerScores,
            savedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Scores saved for ${hostName} - ${playerScores.length} players`);
        return true;
    } catch (error) {
        console.error('Error saving scores:', error);
        return false;
    }
}

function loadScoresFromFile(hostName) {
    try {
        const filePath = getScoresFilePath(hostName);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Scores loaded for ${hostName}`);
            return data;
        }
        return null;
    } catch (error) {
        console.error('Error loading scores:', error);
        return null;
    }
}

function checkScoresExists(hostName) {
    const filePath = getScoresFilePath(hostName);
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

    // Lưu điểm vào file
    const hostPlayer = room.players.find(p => p.isHost);
    if (hostPlayer) {
        saveScoresToFile(hostPlayer.name, roomCode, room.players);
    }

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

// API kiểm tra và load điểm số
app.post('/api/check-scores', (req, res) => {
    const { hostName } = req.body;
    if (!hostName) {
        return res.status(400).json({ error: 'Host name required' });
    }
    
    const exists = checkScoresExists(hostName);
    const scoresData = exists ? loadScoresFromFile(hostName) : null;
    
    res.json({ 
        exists: exists,
        scoresData: scoresData
    });
});

// API lưu điểm thủ công
app.post('/api/save-scores', (req, res) => {
    const { hostName, roomCode, players } = req.body;
    if (!hostName) {
        return res.status(400).json({ error: 'Host name required' });
    }
    
    const saved = saveScoresToFile(hostName, roomCode, players);
    res.json({ 
        success: saved,
        message: saved ? 'Điểm đã được lưu!' : 'Lỗi khi lưu điểm'
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

        // Load điểm số đã lưu nếu có
        let scoresData = null;
        if (loadExisting) {
            scoresData = loadScoresFromFile(playerName);
        }

        // Gửi mã phòng về cho người tạo
        socket.emit('room-created', {
            roomCode: roomCode,
            playerName: playerName,
            isHost: true,
            loadExisting: loadExisting,
            scoresData: scoresData
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

        // Load điểm đã lưu của player (nếu có)
        let savedScore = 0;
        const hostPlayer = room.players.find(p => p.isHost);
        if (hostPlayer) {
            const scoresData = loadScoresFromFile(hostPlayer.name);
            if (scoresData && scoresData.scores) {
                const savedPlayerScore = scoresData.scores.find(s => s.name === playerName);
                if (savedPlayerScore) {
                    savedScore = savedPlayerScore.score;
                    console.log(`Loaded saved score for ${playerName}: ${savedScore} points`);
                }
            }
        }

        // Thêm người chơi vào phòng với điểm đã lưu
        room.players.push({
            id: socket.id,
            name: playerName || 'Player',
            isHost: false,
            score: savedScore
        });

        // Join socket room
        socket.join(roomCode);
        socket.roomCode = roomCode;

        console.log(`${playerName} joined room: ${roomCode} (Score: ${savedScore})`);

        // Thông báo cho người chơi đã join thành công
        socket.emit('room-joined', {
            roomCode: roomCode,
            playerName: playerName,
            isHost: false,
            players: room.players,
            savedScore: savedScore // Gửi điểm đã lưu
        });

        // Thông báo cho tất cả người chơi trong phòng
        io.to(roomCode).emit('player-joined', {
            player: {
                id: socket.id,
                name: playerName,
                isHost: false,
                score: savedScore
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

    // Load điểm số từ file
    socket.on('load-scores', (data) => {
        const { hostName } = data;
        
        if (!hostName) {
            socket.emit('error', { message: 'Host name required!' });
            return;
        }

        const scoresData = loadScoresFromFile(hostName);
        
        if (scoresData) {
            socket.emit('scores-loaded', {
                success: true,
                scoresData: scoresData
            });
        } else {
            socket.emit('scores-loaded', {
                success: false,
                message: 'Không tìm thấy điểm đã lưu!'
            });
        }
    });

    // Lưu điểm thủ công (chỉ host)
    socket.on('save-scores', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể lưu điểm!' });
                return;
            }

            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                const saved = saveScoresToFile(hostPlayer.name, socket.roomCode, room.players);
                socket.emit('scores-saved', {
                    success: saved,
                    message: saved ? 'Điểm đã được lưu!' : 'Lỗi khi lưu điểm'
                });
            }
        }
    });

    // Lấy điểm hiện tại trong phòng
    socket.on('get-current-scores', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            const scores = room.players
                .filter(p => !p.isHost)
                .map(p => ({
                    name: p.name,
                    score: p.score || 0,
                    id: p.id
                }));

            socket.emit('current-scores', {
                roomCode: socket.roomCode,
                scores: scores
            });
        }
    });

    // Cập nhật điểm của member (chỉ host)
    socket.on('update-player-score', (data) => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            
            // Chỉ host mới có quyền cập nhật điểm
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể cập nhật điểm!' });
                return;
            }

            const { playerId, newScore } = data;
            
            // Validate điểm
            if (typeof newScore !== 'number' || newScore < 0) {
                socket.emit('error', { message: 'Điểm không hợp lệ!' });
                return;
            }

            // Tìm và cập nhật điểm của player
            const player = room.players.find(p => p.id === playerId);
            if (player && !player.isHost) {
                const oldScore = player.score;
                player.score = newScore;

                console.log(`Score updated for ${player.name}: ${oldScore} → ${newScore}`);

                // Tự động lưu vào file
                const hostPlayer = room.players.find(p => p.isHost);
                if (hostPlayer) {
                    saveScoresToFile(hostPlayer.name, socket.roomCode, room.players);
                }

                // Broadcast cập nhật cho tất cả người chơi trong phòng
                io.to(socket.roomCode).emit('player-score-updated', {
                    playerId: playerId,
                    playerName: player.name,
                    newScore: newScore,
                    players: room.players
                });

                socket.emit('score-update-success', {
                    message: `Đã cập nhật điểm cho ${player.name}: ${newScore} điểm`
                });
            } else {
                socket.emit('error', { message: 'Không tìm thấy người chơi!' });
            }
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

    // ============ EVALUATION SYSTEM ============

    // Lưu cài đặt đánh giá
    socket.on('save-evaluation-setup', (data) => {
        const { roomCode, setup } = data;
        const room = rooms.get(roomCode);
        
        if (room && room.host === socket.id) {
            room.evaluationSetup = setup;
            
            // Lưu vào file
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                saveEvaluationSetup(hostPlayer.name, setup);
            }
            
            socket.emit('setup-saved', { success: true });
            console.log(`Evaluation setup saved for room ${roomCode}`);
        }
    });

    // Bắt đầu đánh giá
    socket.on('start-evaluation', (data) => {
        const { roomCode, setup } = data;
        const room = rooms.get(roomCode);
        
        if (room && room.host === socket.id) {
            room.evaluationSetup = setup;
            room.evaluationActive = true;
            room.evaluations = {
                host: null,
                members: {}
            };
            
            // Broadcast đến tất cả members
            io.to(roomCode).emit('evaluation-started', {
                setup: setup,
                players: room.players
            });
            
            console.log(`Evaluation started for room ${roomCode}`);
        }
    });

    // Nhận đánh giá từ host - TÍCH HỢP VỚI ĐIỂM HIỆN TẠI
    socket.on('submit-host-evaluation', (data) => {
        const { roomCode, evaluations, evaluationScores } = data;
        const room = rooms.get(roomCode);
        
        if (room && room.host === socket.id) {
            room.evaluations.host = evaluations;
            
            console.log('📊 Host evaluation received:', evaluationScores);
            
            // CỘNG TỔNG ĐIỂM ĐÁNH GIÁ VÀO ĐIỂM TÍCH LŨY HIỆN TẠI
            Object.keys(evaluationScores).forEach(memberId => {
                const member = room.players.find(p => p.id === memberId);
                if (member && !member.isHost) {
                    const currentScore = member.score || 0; // Điểm tích lũy hiện tại
                    const totalEvaluationScore = evaluationScores[memberId]; // Tổng điểm đánh giá
                    const newScore = currentScore + totalEvaluationScore; // Cộng vào điểm tích lũy
                    
                    member.score = newScore;
                    
                    console.log(`✅ Score updated for ${member.name}: ${currentScore} (tích lũy) + ${totalEvaluationScore} (đánh giá) = ${newScore}`);
                }
            });
            
            // Lưu điểm mới vào file scores
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                saveScoresToFile(hostPlayer.name, roomCode, room.players);
                console.log(`💾 Scores saved to file for ${hostPlayer.name}`);
            }
            
            // Broadcast điểm mới đến tất cả clients
            io.to(roomCode).emit('players-list', { players: room.players });
            
            // Broadcast thông báo cập nhật điểm
            io.to(roomCode).emit('evaluation-scores-added', {
                message: 'Điểm đánh giá đã được cộng vào điểm quiz!',
                updatedPlayers: room.players.filter(p => !p.isHost)
            });
            
            console.log(`🎯 Evaluation scores added to quiz scores for room ${roomCode}`);
        }
    });

    // Nhận đánh giá từ member
    socket.on('submit-member-evaluation', (data) => {
        const { roomCode, evaluatorId, evaluations } = data;
        const room = rooms.get(roomCode);
        
        if (room) {
            room.evaluations.members[evaluatorId] = evaluations;
            
            // Kiểm tra xem tất cả đã đánh giá chưa
            checkEvaluationComplete(room, roomCode);
        }
    });
});

// ============ EVALUATION HELPER FUNCTIONS ============

// Kiểm tra và tính kết quả khi tất cả đã đánh giá
function checkEvaluationComplete(room, roomCode) {
    const totalMembers = room.players.filter(p => !p.isHost).length;
    const submittedCount = Object.keys(room.evaluations.members).length;
    
    if (room.evaluations.host && submittedCount === totalMembers) {
        console.log('📊 All evaluations submitted. Calculating peer evaluation scores...');
        
        // CỘNG ĐIỂM TỪ PEER EVALUATIONS VÀO ĐIỂM TÍCH LŨY
        const members = room.players.filter(p => !p.isHost);
        const peerEvaluationScores = {}; // Điểm trung bình từ peer evaluations
        
        members.forEach(member => {
            // Tính điểm trung bình từ peers
            let peerScores = [];
            Object.values(room.evaluations.members).forEach(peerEval => {
                const peerRating = peerEval[member.id];
                if (peerRating) {
                    let peerScore = 0;
                    Object.keys(peerRating).forEach(criteriaId => {
                        const levelId = peerRating[criteriaId];
                        const criteria = room.evaluationSetup.memberCriteria.find(c => c.id == criteriaId);
                        if (criteria) {
                            peerScore += (criteria.maxScore / 4) * levelId;
                        }
                    });
                    peerScores.push(peerScore);
                }
            });
            
            // Tính điểm trung bình từ peers
            const avgPeerScore = peerScores.length > 0 
                ? peerScores.reduce((a, b) => a + b, 0) / peerScores.length 
                : 0;
            
            peerEvaluationScores[member.id] = Math.round(avgPeerScore * 10) / 10; // Làm tròn 1 chữ số
            
            // Cộng điểm peer evaluation vào điểm tích lũy
            const currentScore = member.score || 0;
            const newScore = currentScore + peerEvaluationScores[member.id];
            member.score = newScore;
            
            console.log(`✅ Peer evaluation for ${member.name}: ${currentScore} + ${peerEvaluationScores[member.id]} = ${newScore}`);
        });
        
        // Lưu điểm mới vào file
        const hostPlayer = room.players.find(p => p.isHost);
        if (hostPlayer) {
            saveScoresToFile(hostPlayer.name, roomCode, room.players);
            console.log(`💾 Scores with peer evaluations saved to file for ${hostPlayer.name}`);
        }
        
        // Broadcast điểm mới đến tất cả clients
        io.to(roomCode).emit('players-list', { players: room.players });
        
        // Broadcast thông báo cập nhật điểm từ peer evaluations
        io.to(roomCode).emit('peer-evaluation-scores-added', {
            message: 'Điểm đánh giá từ đồng đội đã được cộng vào điểm tích lũy!',
            updatedPlayers: members,
            peerEvaluationScores: peerEvaluationScores
        });
        
        // Tính kết quả chi tiết
        const results = calculateEvaluationResults(room);
        
        // Lưu kết quả vào file
        if (hostPlayer) {
            saveEvaluationResults(hostPlayer.name, roomCode, results);
        }
        
        // Broadcast kết quả
        io.to(roomCode).emit('evaluation-results', {
            results: results
        });
        
        console.log(`🎯 Peer evaluation scores added for room ${roomCode}`);
    }
}

// Tính toán kết quả
function calculateEvaluationResults(room) {
    const results = {};
    const { evaluationSetup, evaluations, players } = room;
    
    // Lấy danh sách members (không bao gồm host)
    const members = players.filter(p => !p.isHost);
    
    members.forEach(member => {
        // Điểm từ host (đã được cộng vào score)
        const hostEval = evaluations.host[member.id] || {};
        let hostScore = 0;
        Object.keys(hostEval).forEach(criteriaId => {
            const levelId = hostEval[criteriaId];
            const criteria = evaluationSetup.hostCriteria.find(c => c.id == criteriaId);
            if (criteria) {
                hostScore += (criteria.maxScore / 4) * levelId; // Công thức: (maxScore/4) × id
            }
        });
        
        // Điểm từ peers
        let peerScores = [];
        Object.values(evaluations.members).forEach(peerEval => {
            const peerRating = peerEval[member.id];
            if (peerRating) {
                let peerScore = 0;
                Object.keys(peerRating).forEach(criteriaId => {
                    const levelId = peerRating[criteriaId];
                    const criteria = evaluationSetup.memberCriteria.find(c => c.id == criteriaId);
                    if (criteria) {
                        peerScore += (criteria.maxScore / 4) * levelId; // Công thức: (maxScore/4) × id
                    }
                });
                peerScores.push(peerScore);
            }
        });
        
        const avgPeerScore = peerScores.length > 0 
            ? peerScores.reduce((a, b) => a + b, 0) / peerScores.length 
            : 0;
        
        results[member.id] = {
            name: member.name,
            currentScore: member.score, // Điểm hiện tại (đã bao gồm đánh giá)
            hostScore: hostScore,
            peerScore: avgPeerScore,
            totalScore: member.score, // Tổng điểm cuối cùng
            details: {
                hostEvaluation: hostEval,
                peerEvaluations: peerScores
            }
        };
    });
    
    return results;
}

// ============ EVALUATION FILE STORAGE ============

const evaluationsDir = path.join(__dirname, 'evaluations');
if (!fs.existsSync(evaluationsDir)) {
    fs.mkdirSync(evaluationsDir);
    console.log('📁 Created evaluations directory:', evaluationsDir);
}

function getEvaluationFilePath(hostName) {
    const fileName = sanitizeFileName(hostName) + '-evaluation.json';
    return path.join(evaluationsDir, fileName);
}

function saveEvaluationSetup(hostName, setup) {
    try {
        const filePath = getEvaluationFilePath(hostName);
        let data = {};
        
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        
        data.setup = setup;
        data.updatedAt = new Date().toISOString();
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Evaluation setup saved for ${hostName}`);
        return true;
    } catch (error) {
        console.error('Error saving evaluation setup:', error);
        return false;
    }
}

function saveEvaluationResults(hostName, roomCode, results) {
    try {
        const filePath = getEvaluationFilePath(hostName);
        let data = {};
        
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        
        data.results = results;
        data.roomCode = roomCode;
        data.completedAt = new Date().toISOString();
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Evaluation results saved for ${hostName}`);
        return true;
    } catch (error) {
        console.error('Error saving evaluation results:', error);
        return false;
    }
}

function loadEvaluationSetup(hostName) {
    try {
        const filePath = getEvaluationFilePath(hostName);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return data.setup || null;
        }
        return null;
    } catch (error) {
        console.error('Error loading evaluation setup:', error);
        return null;
    }
}

const PORT = process.env.PORT || 3009;

server.listen(PORT, () => {
    console.log(`🎯 Quiz Game Server đang chạy tại http://localhost:${PORT}`);
    console.log(`📝 Truy cập: http://localhost:${PORT}`);
});

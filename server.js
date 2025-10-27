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
        
        // Lọc chỉ lấy người chơi thực tế (không phải host và member mặc định) và lấy top 4
        const playerScores = players
            .filter(p => !p.isHost && !p.id.startsWith('default-member-'))
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

// Mã phòng cố định
function generateRoomCode() {
    return 'QUIZ12'; // Mã phòng cố định (6 ký tự)
}

// Lọc danh sách players để chỉ hiển thị những người thực tế
function getVisiblePlayers(players) {
    return players.filter(player => {
        if (player.isHost) return true; // Luôn hiển thị host
        if (player.id.startsWith('default-member-')) return false; // Không hiển thị member mặc định chưa được thay thế
        return true; // Hiển thị member đã được thay thế hoặc member mới
    });
}

// Lọc danh sách players để chỉ lấy những người có thể tham gia đánh giá (Thầy/Cô có thể đánh giá nhưng không được đánh giá)
function getEvaluablePlayers(players) {
    return players.filter(player => {
        if (player.isHost) return false; // Host không tham gia đánh giá
        if (player.id.startsWith('default-member-')) return false; // Không đánh giá member mặc định chưa được thay thế
        return true; // Tất cả members (bao gồm Thầy/Cô) đều có thể tham gia đánh giá
    });
}

// Lọc danh sách players để chỉ lấy những người có thể được đánh giá (loại bỏ Thầy/Cô)
function getEvaluatedPlayers(players) {
    return players.filter(player => {
        if (player.isHost) return false; // Host không được đánh giá
        if (player.id.startsWith('default-member-')) return false; // Không đánh giá member mặc định chưa được thay thế
        if (player.name.startsWith('Thầy/Cô: ')) return false; // Không đánh giá Thầy/Cô
        return true; // Chỉ đánh giá những người không phải Thầy/Cô
    });
}

// Lọc danh sách players để chỉ lấy những người có thể tham gia quiz (loại bỏ Thầy/Cô)
function getQuizPlayers(players) {
    return players.filter(player => {
        if (player.isHost) return false; // Host không tham gia quiz
        if (player.id.startsWith('default-member-')) return false; // Không tham gia quiz nếu là member mặc định chưa được thay thế
        if (player.name.startsWith('Thầy/Cô: ')) return false; // Thầy/Cô không tham gia quiz
        return true; // Chỉ những người không phải Thầy/Cô mới tham gia quiz
    });
}

// Hàm kết thúc quiz và tính điểm
function endQuiz(room, roomCode) {
    if (!room.quiz || !room.quizActive) return;

    room.quizActive = false;

    // Khởi tạo điểm cho mỗi người chơi
    const playerScores = new Map();
    const playerDetails = new Map();
    
    getQuizPlayers(room.players).forEach(player => {
        playerScores.set(player.id, 0);
        playerDetails.set(player.id, []);
    });

    // Tính điểm cho từng câu hỏi
    room.quiz.questions.forEach((question, qIndex) => {
        // Lấy tất cả câu trả lời đúng cho câu hỏi này
        const correctAnswers = [];
        
        getQuizPlayers(room.players).forEach(player => {
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
        getQuizPlayers(room.players).forEach(player => {
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
    getQuizPlayers(room.players).forEach(player => {
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
        
        // Lưu chi tiết quiz
        saveQuizDetails(hostPlayer.name, roomCode, room.quiz, results);
    }

    // Gửi kết quả
    io.to(roomCode).emit('quiz-ended', {
        results: results
    });

    console.log(`Quiz ended in room ${roomCode}`);
}

// HTTP API endpoints
app.get('/api/quiz-details/:hostName/:roomCode', (req, res) => {
    const { hostName, roomCode } = req.params;
    try {
        const safeHostName = sanitizeFileName(hostName);
        const safeRoomCode = sanitizeFileName(roomCode);
        const filePath = path.join(__dirname, 'quiz-details', `${safeHostName}-${safeRoomCode}-quiz-details.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            res.json(data);
        } else {
            res.status(404).json({ error: 'Quiz details not found' });
        }
    } catch (error) {
        console.error('Error loading quiz details:', error);
        res.status(500).json({ error: 'Error loading quiz details' });
    }
});

app.get('/api/evaluation-details/:hostName/:roomCode', (req, res) => {
    const { hostName, roomCode } = req.params;
    try {
        const safeHostName = sanitizeFileName(hostName);
        const safeRoomCode = sanitizeFileName(roomCode);
        const filePath = path.join(__dirname, 'evaluation-details', `${safeHostName}-${safeRoomCode}-evaluation-details.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            res.json(data);
        } else {
            res.status(404).json({ error: 'Evaluation details not found' });
        }
    } catch (error) {
        console.error('Error loading evaluation details:', error);
        res.status(500).json({ error: 'Error loading evaluation details' });
    }
});

app.get('/api/quiz-details', (req, res) => {
    try {
        const detailsDir = path.join(__dirname, 'quiz-details');
        if (!fs.existsSync(detailsDir)) {
            return res.json([]);
        }
        
        const files = fs.readdirSync(detailsDir).filter(f => f.endsWith('.json'));
        const details = files.map(file => {
            const filePath = path.join(detailsDir, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                fileName: file,
                hostName: data.hostName,
                roomCode: data.roomCode,
                timestamp: data.timestamp,
                totalQuestions: data.quiz.questions.length,
                totalMembers: data.results.length
            };
        });
        
        res.json(details);
    } catch (error) {
        console.error('Error listing quiz details:', error);
        res.status(500).json({ error: 'Error listing quiz details' });
    }
});

app.get('/api/evaluation-details', (req, res) => {
    try {
        const detailsDir = path.join(__dirname, 'evaluation-details');
        if (!fs.existsSync(detailsDir)) {
            return res.json([]);
        }
        
        const files = fs.readdirSync(detailsDir).filter(f => f.endsWith('.json'));
        const details = files.map(file => {
            const filePath = path.join(detailsDir, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                fileName: file,
                hostName: data.hostName,
                roomCode: data.roomCode,
                timestamp: data.timestamp,
                totalMembers: data.summary.totalMembers,
                totalEvaluators: data.summary.totalEvaluators
            };
        });
        
        res.json(details);
    } catch (error) {
        console.error('Error listing evaluation details:', error);
        res.status(500).json({ error: 'Error listing evaluation details' });
    }
});

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
        
        // Tạo phòng mới với 4 member mặc định
        rooms.set(roomCode, {
            host: socket.id,
            players: [
                {
                    id: socket.id,
                    name: playerName,
                    isHost: true,
                    score: 0
                },
                {
                    id: 'default-member-1',
                    name: 'Nhom1',
                    isHost: false,
                    score: 0
                },
                {
                    id: 'default-member-2',
                    name: 'Nhom2',
                    isHost: false,
                    score: 0
                },
                {
                    id: 'default-member-3',
                    name: 'Nhom3',
                    isHost: false,
                    score: 0
                },
                {
                    id: 'default-member-4',
                    name: 'Nhom4',
                    isHost: false,
                    score: 0
                }
            ],
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
        
        // Kiểm tra xem có phải là tên nhóm mặc định không
        const defaultGroupNames = ['Nhom1', 'Nhom2', 'Nhom3', 'Nhom4'];
        let formattedPlayerName = playerName;
        let isDefaultGroup = false;
        
        if (defaultGroupNames.includes(playerName)) {
            // Nếu là tên nhóm mặc định, giữ nguyên tên
            formattedPlayerName = playerName;
            isDefaultGroup = true;
        } else {
            // Nếu không phải, thêm prefix "Thầy/Cô: "
            if (!formattedPlayerName.startsWith('Thầy/Cô: ')) {
                formattedPlayerName = `Thầy/Cô: ${formattedPlayerName}`;
            }
        }
        
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

        // Load điểm đã lưu của player (nếu có)
        let savedScore = 0;
        const hostPlayer = room.players.find(p => p.isHost);
        if (hostPlayer) {
            const scoresData = loadScoresFromFile(hostPlayer.name);
            if (scoresData && scoresData.scores) {
                const savedPlayerScore = scoresData.scores.find(s => s.name === formattedPlayerName);
                if (savedPlayerScore) {
                    savedScore = savedPlayerScore.score;
                    console.log(`Loaded saved score for ${formattedPlayerName}: ${savedScore} points`);
                }
            }
        }

        if (isDefaultGroup) {
            // Nếu là tên nhóm mặc định, thay thế member mặc định tương ứng
            const defaultMemberIndex = room.players.findIndex(p => p.name === playerName && p.id.startsWith('default-member-'));
            if (defaultMemberIndex !== -1) {
                // Thay thế member mặc định
                room.players[defaultMemberIndex] = {
                    id: socket.id,
                    name: formattedPlayerName,
                    isHost: false,
                    score: savedScore
                };
                console.log(`Replaced default member ${playerName} with real player`);
            } else {
                socket.emit('join-error', { message: `Nhóm ${playerName} đã được thay thế!` });
                return;
            }
        } else {
            // Kiểm tra số lượng người chơi thực tế (không tính host và member mặc định, tối đa 4 người thực)
            const realPlayerCount = room.players.filter(p => !p.isHost && !p.id.startsWith('default-member-')).length;
            if (realPlayerCount >= 4) {
                socket.emit('join-error', { message: 'Phòng đã đầy! (Tối đa 4 người chơi thực)' });
                return;
            }

            // Thêm người chơi mới vào phòng
            room.players.push({
                id: socket.id,
                name: formattedPlayerName,
                isHost: false,
                score: savedScore
            });
        }

        // Join socket room
        socket.join(roomCode);
        socket.roomCode = roomCode;

        if (isDefaultGroup) {
            console.log(`${formattedPlayerName} replaced default member in room: ${roomCode} (Score: ${savedScore})`);
        } else {
            console.log(`${formattedPlayerName} joined room: ${roomCode} (Score: ${savedScore})`);
        }

        // Thông báo cho người chơi đã join thành công
        socket.emit('room-joined', {
            roomCode: roomCode,
            playerName: formattedPlayerName,
            isHost: false,
            players: getVisiblePlayers(room.players),
            savedScore: savedScore, // Gửi điểm đã lưu
            isDefaultGroup: isDefaultGroup // Thông báo có phải thay thế member mặc định không
        });

        // Thông báo cho tất cả người chơi trong phòng
        io.to(roomCode).emit('player-joined', {
            player: {
                id: socket.id,
                name: formattedPlayerName,
                isHost: false,
                score: savedScore
            },
            players: getVisiblePlayers(room.players),
            isDefaultGroup: isDefaultGroup // Thông báo có phải thay thế member mặc định không
        });
    });

    // Lấy danh sách người chơi trong phòng
    socket.on('get-players', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            const visiblePlayers = getVisiblePlayers(room.players);
            socket.emit('players-list', { players: visiblePlayers });
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

            // Kiểm tra xem người chơi có phải Thầy/Cô không
            const player = room.players.find(p => p.id === socket.id);
            if (player && player.name.startsWith('Thầy/Cô: ')) {
                socket.emit('error', { message: 'Thầy/Cô không thể tham gia quiz!' });
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
                .filter(p => !p.isHost && !p.id.startsWith('default-member-'))
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
                    players: getVisiblePlayers(room.players)
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
                        players: getVisiblePlayers(room.players)
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
                        players: getVisiblePlayers(room.players)
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
            const evaluatedPlayers = getEvaluatedPlayers(room.players);
            console.log('📋 Evaluation started - evaluatedPlayers:', evaluatedPlayers.map(p => p.name));
            
            io.to(roomCode).emit('evaluation-started', {
                setup: setup,
                players: getVisiblePlayers(room.players),
                evaluablePlayers: getEvaluablePlayers(room.players), // Những người có thể đánh giá (bao gồm Thầy/Cô)
                evaluatedPlayers: evaluatedPlayers // Những người có thể được đánh giá (không bao gồm Thầy/Cô)
            });
            
            console.log(`Evaluation started for room ${roomCode}`);
        }
    });

    // Nhận đánh giá từ host - TÍCH HỢP VỚI ĐIỂM HIỆN TẠI
    socket.on('submit-host-evaluation', (data) => {
        const { roomCode, evaluations, evaluationScores } = data;
        const room = rooms.get(roomCode);
        
        if (room && room.host === socket.id) {
            // Kiểm tra Host không đánh giá Thầy/Cô
            console.log('🔍 Host evaluation check:', Object.keys(evaluations));
            const hasEvaluatedTeacher = Object.keys(evaluations).some(memberId => {
                const member = room.players.find(p => p.id === memberId);
                const isTeacher = member && member.name.startsWith('Thầy/Cô: ');
                if (isTeacher) {
                    console.log('❌ Host trying to evaluate teacher:', member.name);
                }
                return isTeacher;
            });
            
            if (hasEvaluatedTeacher) {
                console.log('🚫 Blocked: Host cannot evaluate teachers');
                socket.emit('error', { message: 'Host không được đánh giá Thầy/Cô!' });
                return;
            }
            
            room.evaluations.host = evaluations;
            
            console.log('📊 Host evaluation received:', evaluationScores);
            
            // CỘNG TỔNG ĐIỂM ĐÁNH GIÁ VÀO ĐIỂM TÍCH LŨY HIỆN TẠI (chỉ cho những người có thể được đánh giá)
            Object.keys(evaluationScores).forEach(memberId => {
                const member = room.players.find(p => p.id === memberId);
                if (member && !member.isHost && !member.name.startsWith('Thầy/Cô: ')) {
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
            io.to(roomCode).emit('players-list', { players: getVisiblePlayers(room.players) });
            
            // Broadcast thông báo cập nhật điểm
            io.to(roomCode).emit('evaluation-scores-added', {
                message: 'Điểm đánh giá đã được cộng vào điểm quiz!',
                updatedPlayers: room.players.filter(p => !p.isHost && !p.id.startsWith('default-member-'))
            });
            
            console.log(`🎯 Evaluation scores added to quiz scores for room ${roomCode}`);
        }
    });

    // Nhận đánh giá từ member
    socket.on('submit-member-evaluation', (data) => {
        const { roomCode, evaluatorId, evaluations, evaluationScores } = data;
        const room = rooms.get(roomCode);
        
        if (room) {
            // Kiểm tra member không đánh giá Thầy/Cô
            const hasEvaluatedTeacher = Object.keys(evaluations).some(memberId => {
                const member = room.players.find(p => p.id === memberId);
                return member && member.name.startsWith('Thầy/Cô: ');
            });
            
            if (hasEvaluatedTeacher) {
                socket.emit('error', { message: 'Các nhóm không được đánh giá Thầy/Cô!' });
                return;
            }
            
            room.evaluations.members[evaluatorId] = evaluations;
            
            console.log('📊 Member evaluation received:', evaluationScores);
            
            // CỘNG ĐIỂM ĐÁNH GIÁ TỪNG MEMBER VÀO ĐIỂM TÍCH LŨY NGAY LẬP TỨC (chỉ cho những người có thể được đánh giá)
            Object.keys(evaluationScores).forEach(peerId => {
                const peer = room.players.find(p => p.id === peerId);
                if (peer && !peer.isHost && !peer.name.startsWith('Thầy/Cô: ')) {
                    const currentScore = peer.score || 0;
                    const memberEvaluationScore = evaluationScores[peerId];
                    const newScore = currentScore + memberEvaluationScore;
                    
                    peer.score = newScore;
                    
                    console.log(`✅ Member evaluation score added for ${peer.name}: ${currentScore} + ${memberEvaluationScore} = ${newScore}`);
                }
            });
            
            // Lưu điểm mới vào file
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                saveScoresToFile(hostPlayer.name, roomCode, room.players);
                console.log(`💾 Scores with member evaluation saved to file for ${hostPlayer.name}`);
            }
            
            // Broadcast điểm mới đến tất cả clients
            io.to(roomCode).emit('players-list', { players: getVisiblePlayers(room.players) });
            
            // Broadcast thông báo cập nhật điểm
            const evaluatorPlayer = room.players.find(p => p.id === evaluatorId);
            io.to(roomCode).emit('member-evaluation-scores-added', {
                message: `${evaluatorPlayer?.name || 'Member'} đã hoàn thành đánh giá! Điểm đã được cộng vào.`,
                updatedPlayers: room.players.filter(p => !p.isHost && evaluationScores[p.id]),
                evaluationScores: evaluationScores,
                evaluatorName: evaluatorPlayer?.name || 'Member'
            });
            
            console.log(`🎯 Member evaluation scores added immediately for room ${roomCode}`);
            
            // Kiểm tra xem tất cả đã đánh giá chưa
            checkEvaluationComplete(room, roomCode);
        }
    });
});

// ============ DETAILED RECORDING FUNCTIONS ============

// Helper function để làm sạch tên file
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();
}

// Lưu chi tiết quiz theo member
function saveQuizDetails(hostName, roomCode, quizData, results) {
    try {
        const detailsDir = path.join(__dirname, 'quiz-details');
        if (!fs.existsSync(detailsDir)) {
            fs.mkdirSync(detailsDir, { recursive: true });
        }
        
        const safeHostName = sanitizeFileName(hostName);
        const safeRoomCode = sanitizeFileName(roomCode);
        const fileName = `${safeHostName}-${safeRoomCode}-quiz-details.json`;
        const filePath = path.join(detailsDir, fileName);
        
        const quizDetails = {
            hostName: hostName,
            roomCode: roomCode,
            timestamp: new Date().toISOString(),
            quiz: {
                title: quizData.title,
                questions: quizData.questions.map((q, index) => ({
                    questionNumber: index + 1,
                    question: q.question,
                    options: q.options,
                    correctAnswer: q.correctAnswer,
                    timeLimit: q.timeLimit,
                    mediaPath: q.mediaPath,
                    mediaType: q.mediaType
                }))
            },
            results: results.map(result => ({
                playerName: result.playerName,
                playerId: result.playerId,
                totalQuestions: result.totalQuestions,
                correctAnswers: result.correctAnswers,
                score: result.score,
                details: result.details.map(detail => ({
                    questionNumber: detail.questionIndex + 1,
                    question: detail.question,
                    options: detail.options,
                    correctAnswer: detail.correctAnswer,
                    playerAnswer: detail.playerAnswer,
                    isCorrect: detail.isCorrect,
                    answered: detail.answered,
                    pointsEarned: detail.pointsEarned
                }))
            }))
        };
        
        fs.writeFileSync(filePath, JSON.stringify(quizDetails, null, 2));
        console.log(`📊 Quiz details saved: ${filePath}`);
        console.log(`   - Host: ${hostName} → ${safeHostName}`);
        console.log(`   - Room: ${roomCode} → ${safeRoomCode}`);
        console.log(`   - File: ${fileName}`);
        return true;
    } catch (error) {
        console.error('Error saving quiz details:', error);
        return false;
    }
}

// Lưu chi tiết đánh giá theo member
function saveEvaluationDetails(hostName, roomCode, evaluationSetup, evaluations, players) {
    console.log('🚀 saveEvaluationDetails called!');
    console.log('   - hostName:', hostName);
    console.log('   - roomCode:', roomCode);
    console.log('   - evaluationSetup exists:', !!evaluationSetup);
    console.log('   - evaluations exists:', !!evaluations);
    console.log('   - players count:', players?.length);
    
    try {
        console.log('💾 Saving evaluation details...');
        console.log(`   - Host: ${hostName}`);
        console.log(`   - Room: ${roomCode}`);
        
        const detailsDir = path.join(__dirname, 'evaluation-details');
        if (!fs.existsSync(detailsDir)) {
            fs.mkdirSync(detailsDir, { recursive: true });
            console.log(`   - Created directory: ${detailsDir}`);
        }
        
        const safeHostName = sanitizeFileName(hostName);
        const safeRoomCode = sanitizeFileName(roomCode);
        const fileName = `${safeHostName}-${safeRoomCode}-evaluation-details.json`;
        const filePath = path.join(detailsDir, fileName);
        
        // Validate input data
        if (!evaluations || !evaluations.host || !evaluations.members) {
            console.error('   ❌ Invalid evaluations data');
            return false;
        }
        
        if (!evaluationSetup || !evaluationSetup.hostCriteria || !evaluationSetup.memberCriteria) {
            console.error('   ❌ Invalid evaluation setup');
            return false;
        }
        
        // Tính chi tiết đánh giá cho từng member
        const members = getEvaluatedPlayers(players);
        console.log(`   - Processing ${members.length} members`);
        const memberDetails = members.map(member => {
            // Đánh giá từ host
            const hostEval = evaluations.host[member.id] || {};
            const hostEvaluationDetails = evaluationSetup.hostCriteria.map(criteria => {
                const levelId = hostEval[criteria.id];
                const level = evaluationSetup.ratingLevels.find(l => l.id === levelId);
                const score = levelId ? (criteria.maxScore / 4) * levelId : 0;
                
                return {
                    criteriaId: criteria.id,
                    criteriaName: criteria.name,
                    criteriaDescription: criteria.description,
                    maxScore: criteria.maxScore,
                    levelId: levelId,
                    levelName: level?.name || 'Chưa đánh giá',
                    levelEmoji: level?.emoji || '',
                    score: score
                };
            });
            
            // Đánh giá từ peers (loại bỏ tự đánh giá, member mặc định và không tính điểm từ việc đánh giá Thầy/Cô)
            const peerEvaluations = [];
            Object.keys(evaluations.members).forEach(evaluatorId => {
                // Bỏ qua nếu người đánh giá chính là người được đánh giá hoặc là member mặc định
                if (evaluatorId === member.id || evaluatorId.startsWith('default-member-')) {
                    return;
                }
                
                // Bỏ qua nếu người đánh giá là Thầy/Cô
                const evaluator = players.find(p => p.id === evaluatorId);
                if (evaluator && evaluator.name.startsWith('Thầy/Cô: ')) {
                    return;
                }
                const peerEval = evaluations.members[evaluatorId][member.id] || {};
                
                const peerDetails = evaluationSetup.memberCriteria.map(criteria => {
                    const levelId = peerEval[criteria.id];
                    const level = evaluationSetup.ratingLevels.find(l => l.id === levelId);
                    const score = levelId ? (criteria.maxScore / 4) * levelId : 0;
                    
                    return {
                        criteriaId: criteria.id,
                        criteriaName: criteria.name,
                        criteriaDescription: criteria.description,
                        maxScore: criteria.maxScore,
                        levelId: levelId,
                        levelName: level?.name || 'Chưa đánh giá',
                        levelEmoji: level?.emoji || '',
                        score: score
                    };
                });
                
                peerEvaluations.push({
                    evaluatorId: evaluatorId,
                    evaluatorName: evaluator?.name || 'Unknown',
                    evaluations: peerDetails
                });
            });
            
            // Tính tổng điểm
            const hostTotalScore = hostEvaluationDetails.reduce((sum, detail) => sum + detail.score, 0);
            const peerTotalScores = peerEvaluations.map(peer => 
                peer.evaluations.reduce((sum, detail) => sum + detail.score, 0)
            );
            const peerAverageScore = peerTotalScores.length > 0 
                ? peerTotalScores.reduce((a, b) => a + b, 0) / peerTotalScores.length 
                : 0;
            
            return {
                memberId: member.id,
                memberName: member.name,
                finalScore: member.score,
                hostEvaluation: {
                    totalScore: hostTotalScore,
                    details: hostEvaluationDetails
                },
                peerEvaluations: peerEvaluations,
                peerAverageScore: peerAverageScore,
                summary: {
                    hostScore: hostTotalScore,
                    peerAverageScore: peerAverageScore,
                    totalEvaluationScore: hostTotalScore + peerAverageScore
                }
            };
        });
        
        const totalMembers = members.length;
        // Tính số người đánh giá thực sự (chỉ tính những người có thể đánh giá, không tính Thầy/Cô)
        const evaluablePlayers = getEvaluablePlayers(players).filter(p => !p.name.startsWith('Thầy/Cô: '));
        const totalEvaluators = evaluablePlayers.length;
        const avgHostScore = totalMembers > 0 
            ? memberDetails.reduce((sum, m) => sum + m.hostEvaluation.totalScore, 0) / totalMembers 
            : 0;
        const avgPeerScore = totalMembers > 0 
            ? memberDetails.reduce((sum, m) => sum + m.peerAverageScore, 0) / totalMembers 
            : 0;
        
        const evaluationDetails = {
            hostName: hostName,
            roomCode: roomCode,
            timestamp: new Date().toISOString(),
            evaluationSetup: {
                hostCriteria: evaluationSetup.hostCriteria,
                memberCriteria: evaluationSetup.memberCriteria,
                ratingLevels: evaluationSetup.ratingLevels
            },
            memberDetails: memberDetails,
            summary: {
                totalMembers: totalMembers,
                totalEvaluators: totalEvaluators,
                averageHostScore: avgHostScore,
                averagePeerScore: avgPeerScore
            }
        };
        
        fs.writeFileSync(filePath, JSON.stringify(evaluationDetails, null, 2));
        console.log(`📊 Evaluation details saved: ${filePath}`);
        console.log(`   - Host: ${hostName} → ${safeHostName}`);
        console.log(`   - Room: ${roomCode} → ${safeRoomCode}`);
        console.log(`   - File: ${fileName}`);
        console.log(`   - Members: ${totalMembers}`);
        console.log(`   - Evaluators: ${totalEvaluators}`);
        return true;
    } catch (error) {
        console.error('❌ Error saving evaluation details:', error);
        console.error('   Stack:', error.stack);
        return false;
    }
}

// ============ EVALUATION HELPER FUNCTIONS ============

// Kiểm tra và tính kết quả khi tất cả đã đánh giá
function checkEvaluationComplete(room, roomCode) {
    // Kiểm tra hoàn thành đánh giá: Host đã đánh giá và tất cả người có thể đánh giá (không tính Thầy/Cô) đã đánh giá đủ
    const evaluablePlayers = getEvaluablePlayers(room.players).filter(p => !p.name.startsWith('Thầy/Cô: '));
    const evaluatedPlayers = getEvaluatedPlayers(room.players);
    
    // Kiểm tra Host đã đánh giá chưa
    if (!room.evaluations.host) {
        return;
    }
    
    // Kiểm tra tất cả người có thể đánh giá (không tính Thầy/Cô) đã đánh giá đủ chưa
    let allEvaluationsComplete = true;
    
    console.log('🔍 Checking evaluation completion:');
    console.log('   - evaluablePlayers:', evaluablePlayers.map(p => p.name));
    console.log('   - evaluatedPlayers:', evaluatedPlayers.map(p => p.name));
    
    evaluablePlayers.forEach(evaluator => {
        const evaluatorId = evaluator.id;
        const evaluatorEvaluations = room.evaluations.members[evaluatorId] || {};
        
        console.log(`   - Checking ${evaluator.name} (${evaluatorId}):`);
        console.log(`     - Evaluations:`, Object.keys(evaluatorEvaluations));
        
        // Kiểm tra người này đã đánh giá đủ tất cả các nhóm online chưa
        const hasEvaluatedAll = evaluatedPlayers.every(target => {
            const hasEvaluated = evaluatorEvaluations[target.id] !== undefined;
            console.log(`     - ${target.name}: ${hasEvaluated ? '✅' : '❌'}`);
            return hasEvaluated;
        });
        
        console.log(`     - Has evaluated all: ${hasEvaluatedAll}`);
        
        if (!hasEvaluatedAll) {
            allEvaluationsComplete = false;
        }
    });
    
    console.log('   - Final allEvaluationsComplete:', allEvaluationsComplete);
    
    if (allEvaluationsComplete) {
        console.log('📊 All evaluations submitted. Finalizing results...');
        console.log('🔍 Debug info:');
        console.log('   - evaluablePlayers count:', evaluablePlayers.length);
        console.log('   - evaluatedPlayers count:', evaluatedPlayers.length);
        console.log('   - allEvaluationsComplete:', allEvaluationsComplete);
        
        // Điểm đã được cộng ngay khi mỗi member submit rồi
        // Chỉ cần tính kết quả chi tiết và broadcast
        
        const hostPlayer = room.players.find(p => p.isHost);
        
        // Tính kết quả chi tiết
        const results = calculateEvaluationResults(room);
        
        // Lưu kết quả vào file
        if (hostPlayer) {
            saveEvaluationResults(hostPlayer.name, roomCode, results);
            
            // Lưu chi tiết đánh giá
            console.log('🔍 Attempting to save evaluation details...');
            console.log('   - Host player:', hostPlayer.name);
            console.log('   - Room code:', roomCode);
            console.log('   - Evaluation setup exists:', !!room.evaluationSetup);
            console.log('   - Evaluations exists:', !!room.evaluations);
            console.log('   - Players count:', room.players.length);
            
            try {
                const saveResult = saveEvaluationDetails(hostPlayer.name, roomCode, room.evaluationSetup, room.evaluations, room.players);
                console.log('   - Save result:', saveResult);
            } catch (error) {
                console.error('   - Error saving evaluation details:', error);
            }
        } else {
            console.log('   - No host player found!');
        }
        
        // Broadcast kết quả
        io.to(roomCode).emit('evaluation-results', {
            results: results
        });
        
        // Broadcast thông báo hoàn thành
        io.to(roomCode).emit('all-evaluations-complete', {
            message: 'Tất cả đánh giá đã hoàn thành! Điểm đã được cộng vào.',
            players: getVisiblePlayers(room.players)
        });
        
        console.log(`🎯 All evaluations complete for room ${roomCode}`);
    }
}

// Tính toán kết quả
function calculateEvaluationResults(room) {
    const results = {};
    const { evaluationSetup, evaluations, players } = room;
    
    // Lấy danh sách members (không bao gồm host)
    const members = getEvaluatedPlayers(players);
    
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
        
        // Điểm từ peers (loại bỏ tự đánh giá, member mặc định và không tính điểm từ việc đánh giá Thầy/Cô)
        let peerScores = [];
        Object.keys(evaluations.members).forEach(evaluatorId => {
            // Bỏ qua nếu người đánh giá chính là người được đánh giá hoặc là member mặc định
            if (evaluatorId === member.id || evaluatorId.startsWith('default-member-')) {
                return;
            }
            
            // Bỏ qua nếu người đánh giá là Thầy/Cô
            const evaluator = players.find(p => p.id === evaluatorId);
            if (evaluator && evaluator.name.startsWith('Thầy/Cô: ')) {
                return;
            }
            
            const peerEval = evaluations.members[evaluatorId];
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

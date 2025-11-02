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

// Lưu logs đánh giá
function saveEvaluationLogs(hostName, roomCode, evaluations, evaluationSetup, players) {
    try {
        const filePath = getEvaluationLogsFilePath(hostName);

        // Khởi tạo cấu trúc mặc định
        const baseData = {
            hostName: hostName,
            roomCode: roomCode,
            evaluations: { host: {}, members: {}, teachers: {} },
            savedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            summaryTable: []
        };

        let existing = null;
        if (fs.existsSync(filePath)) {
            try {
                existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch {}
        }

        // Bắt đầu từ existing hoặc base
        const merged = existing && typeof existing === 'object' ? existing : baseData;
        if (!merged.evaluations) merged.evaluations = { host: {}, members: {}, teachers: {} };
        if (!merged.evaluations.host) merged.evaluations.host = {};
        if (!merged.evaluations.members) merged.evaluations.members = {};
        if (!merged.evaluations.teachers) merged.evaluations.teachers = {};

        // Merge HOST evaluations
        if (evaluations && evaluations.host) {
            Object.keys(evaluations.host).forEach(memberId => {
                merged.evaluations.host[memberId] = {
                    ...(merged.evaluations.host[memberId] || {}),
                    ...evaluations.host[memberId]
                };
            });
        }

        // Merge MEMBERS evaluations (peer-to-peer)
        if (evaluations && evaluations.members) {
            Object.keys(evaluations.members).forEach(evaluatorId => {
                const evalsForPeers = evaluations.members[evaluatorId] || {};
                if (!merged.evaluations.members[evaluatorId]) merged.evaluations.members[evaluatorId] = {};
                Object.keys(evalsForPeers).forEach(peerId => {
                    merged.evaluations.members[evaluatorId][peerId] = {
                        ...(merged.evaluations.members[evaluatorId][peerId] || {}),
                        ...evalsForPeers[peerId]
                    };
                });
            });
        }

        // Merge TEACHERS evaluations
        console.log(`📝 saveEvaluationLogs - evaluations.teachers:`, evaluations?.teachers ? JSON.stringify(evaluations.teachers, null, 2) : 'undefined');
        if (evaluations && evaluations.teachers) {
            const teacherCount = Object.keys(evaluations.teachers).length;
            console.log(`📝 Merging ${teacherCount} teacher evaluations into logs`);
            Object.keys(evaluations.teachers).forEach(teacherId => {
                const evalsForPeers = evaluations.teachers[teacherId] || {};
                if (!merged.evaluations.teachers[teacherId]) merged.evaluations.teachers[teacherId] = {};
                const peerCount = Object.keys(evalsForPeers).length;
                console.log(`   👨‍🏫 Teacher ${teacherId}: ${peerCount} peer evaluations`);
                Object.keys(evalsForPeers).forEach(peerId => {
                    merged.evaluations.teachers[teacherId][peerId] = {
                        ...(merged.evaluations.teachers[teacherId][peerId] || {}),
                        ...evalsForPeers[peerId]
                    };
                });
            });
            console.log(`✅ Merged teacher evaluations into logs:`, JSON.stringify(merged.evaluations.teachers, null, 2));
        } else {
            console.log(`⚠️ No teacher evaluations to merge`);
        }

        // Xây bảng tóm tắt giống hình (Host, TB Thầy/Cô, TB Nhóm còn lại, Tổng)
        try {
            if (evaluationSetup && players && merged.evaluations) {
                const members = players.filter(p => !p.isHost && !(p.name && p.name.startsWith('Thầy/Cô: ')));
                const table = members.map(member => {
                    const memberId = member.id || member.playerId || member.memberId;
                    // Host score
                    let hostScore = 0;
                    const hostEval = merged.evaluations.host?.[memberId] || {};
                    Object.keys(hostEval).forEach(cid => {
                        const c = evaluationSetup.hostCriteria?.find(x => x.id == cid);
                        if (c) hostScore += (c.maxScore / 4) * hostEval[cid];
                    });
                    // Peer average
                    let peerScores = [];
                    Object.keys(merged.evaluations.members || {}).forEach(evaluatorId => {
                        if (evaluatorId === memberId || evaluatorId?.startsWith('default-member-')) return;
                        const evaluator = players.find(p => p.id === evaluatorId);
                        if (evaluator && evaluator.name && evaluator.name.startsWith('Thầy/Cô: ')) return;
                        const rating = merged.evaluations.members?.[evaluatorId]?.[memberId];
                        if (rating) {
                            let s = 0;
                            Object.keys(rating).forEach(cid => {
                                const c = evaluationSetup.memberCriteria?.find(x => x.id == cid);
                                if (c) s += (c.maxScore / 4) * rating[cid];
                            });
                            peerScores.push(s);
                        }
                    });
                    const peerAvg = peerScores.length ? peerScores.reduce((a,b)=>a+b,0)/peerScores.length : 0;
                    // Teacher average
                    let teacherScores = [];
                    Object.keys(merged.evaluations.teachers || {}).forEach(teacherId => {
                        const rating = merged.evaluations.teachers?.[teacherId]?.[memberId];
                        if (rating) {
                            let s = 0;
                            Object.keys(rating).forEach(cid => {
                                const c = evaluationSetup.memberCriteria?.find(x => x.id == cid);
                                if (c) s += (c.maxScore / 4) * rating[cid];
                            });
                            teacherScores.push(s);
                        }
                    });
                    const teacherAvg = teacherScores.length ? teacherScores.reduce((a,b)=>a+b,0)/teacherScores.length : 0;
                    const total = hostScore + peerAvg + teacherAvg;
                    return {
                        name: member.name,
                        hostScore: Number(hostScore.toFixed(2)),
                        teacherAverage: Number(teacherAvg.toFixed(2)),
                        peerAverage: Number(peerAvg.toFixed(2)),
                        total: Number(total.toFixed(2))
                    };
                });
                merged.summaryTable = table;
            }
        } catch (e) {
            console.error('⚠️ Build summaryTable failed:', e.message);
        }

        merged.roomCode = roomCode; // cập nhật mã phòng hiện tại
        merged.lastUpdated = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
        console.log(`📊 Evaluation logs saved for ${hostName}`);
        return true;
    } catch (error) {
        console.error('❌ Error saving evaluation logs:', error);
        return false;
    }
}

// Lấy đường dẫn file logs đánh giá
function getEvaluationLogsFilePath(hostName) {
    const fileName = `${hostName.toLowerCase().replace(/[^a-z0-9]/g, '')}-evaluation-logs.json`;
    return path.join(__dirname, 'quizzes', fileName);
}

// Xóa logs đánh giá
function clearEvaluationLogs(hostName, roomCode) {
    try {
        let deletedCount = 0;
        
        // 1. Xóa evaluation logs
        const logsPath = getEvaluationLogsFilePath(hostName);
        if (fs.existsSync(logsPath)) {
            fs.unlinkSync(logsPath);
            deletedCount++;
            console.log(`🗑️ Đã xóa evaluation logs: ${logsPath}`);
        }
        
        // 2. Xóa evaluation details
        if (roomCode) {
            const safeHostName = sanitizeFileName(hostName);
            const safeRoomCode = sanitizeFileName(roomCode);
            const evalDetailsPath = path.join(__dirname, 'evaluation-details', `${safeHostName}-${safeRoomCode}-evaluation-details.json`);
            if (fs.existsSync(evalDetailsPath)) {
                fs.unlinkSync(evalDetailsPath);
                deletedCount++;
                console.log(`🗑️ Đã xóa evaluation details: ${evalDetailsPath}`);
            }
        }
        
        // 3. Xóa quiz details (nếu cần)
        if (roomCode) {
            const safeHostName = sanitizeFileName(hostName);
            const safeRoomCode = sanitizeFileName(roomCode);
            const quizDetailsPath = path.join(__dirname, 'quiz-details', `${safeHostName}-${safeRoomCode}-quiz-details.json`);
            if (fs.existsSync(quizDetailsPath)) {
                fs.unlinkSync(quizDetailsPath);
                deletedCount++;
                console.log(`🗑️ Đã xóa quiz details: ${quizDetailsPath}`);
            }
        }
        
        if (deletedCount > 0) {
            console.log(`✅ Đã xóa ${deletedCount} file(s) logs của ${hostName}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error clearing evaluation logs:', error);
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
        
        // Lưu điểm quiz gốc trước khi cộng đánh giá
        player.originalQuizScore = score;

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

    // Lưu kết quả cuối cùng vào state để hiển thị màn hình chung cuộc
    room.lastQuizResults = results;

    // Gửi kết quả tới tất cả client trong phòng
    io.to(roomCode).emit('quiz-ended', { results });
    // Phát tán an toàn toàn cục để đảm bảo client ngoài phòng (nhưng đang mở) cũng nhận được
    io.emit('quiz-ended', { results });

    // Sau khi kết thúc, broadcast lại danh sách players để màn hình chờ cập nhật
    io.to(roomCode).emit('players-list', { players: getVisiblePlayers(room.players) });

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

        const detailsFilePath = path.join(__dirname, 'evaluation-details', `${safeHostName}-${safeRoomCode}-evaluation-details.json`);
        
        // Quan trọng: phải dùng đúng quy tắc đặt tên đã dùng khi lưu logs
        // getEvaluationLogsFilePath(): hostName.toLowerCase().replace(/[^a-z0-9]/g, '') + '-evaluation-logs.json'
        const logsKey = hostName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const quizzesLogPath = path.join(__dirname, 'quizzes', `${logsKey}-evaluation-logs.json`);
        
        // Luôn tạo lại file từ logs mới nhất để đảm bảo có teacher evaluations
        if (fs.existsSync(quizzesLogPath)) {
            const logData = JSON.parse(fs.readFileSync(quizzesLogPath, 'utf8'));

            // Tải evaluation setup đã lưu (hoặc fallback sang evaluation-criteria.json)
            let setup = loadEvaluationSetup(hostName);
            if (!setup) {
                try {
                    const criteriaPath = path.join(__dirname, 'evaluation-criteria.json');
                    setup = JSON.parse(fs.readFileSync(criteriaPath, 'utf8'));
                } catch (e) {
                    console.error('Failed to load evaluation-criteria.json:', e.message);
                }
            }

            // Tải danh sách players từ scores file (top 4 nhóm)
            const scoresPath = getScoresFilePath(hostName);
            let players = [];
            if (fs.existsSync(scoresPath)) {
                const scoreData = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
                players = (scoreData.scores || []).map(s => ({ id: s.id, name: s.name, isHost: false, score: s.score || 0 }));
            }

            // Luôn tạo lại file chi tiết từ logs mới nhất để đảm bảo có teacher evaluations
            if (setup && logData && logData.evaluations && players.length > 0) {
                console.log(`🔄 Rebuilding evaluation-details.json from latest logs (includes teacher evaluations)`);
                const ok = saveEvaluationDetails(hostName, roomCode, setup, logData.evaluations, players);
                if (ok && fs.existsSync(detailsFilePath)) {
                    const built = JSON.parse(fs.readFileSync(detailsFilePath, 'utf8'));
                    console.log(`✅ Evaluation details rebuilt with ${built.memberDetails?.[0]?.teacherEvaluations?.length || 0} teacher evaluations`);
                    return res.json(built);
                }
            }

            // Nếu không dựng được, trả về dữ liệu logs như phương án cuối
            return res.json(logData);
        }
        
        // Nếu không có logs file, thử đọc file chi tiết cũ (nếu có)
        if (fs.existsSync(detailsFilePath)) {
            const data = JSON.parse(fs.readFileSync(detailsFilePath, 'utf8'));
            return res.json(data);
        }

        return res.status(404).json({ error: 'Evaluation details not found' });
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

// API để lấy evaluation history với summaryTable
app.get('/api/evaluation-history/:hostName', (req, res) => {
    const { hostName } = req.params;
    try {
        const logsKey = hostName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const logsPath = path.join(__dirname, 'quizzes', `${logsKey}-evaluation-logs.json`);
        
        if (fs.existsSync(logsPath)) {
            const logData = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
            
            // Trả về summaryTable và thông tin chi tiết về peer và teacher evaluations
            const historyData = {
                hostName: logData.hostName,
                roomCode: logData.roomCode,
                savedAt: logData.savedAt,
                lastUpdated: logData.lastUpdated,
                summaryTable: logData.summaryTable || [],
                // Thêm chi tiết peer evaluations
                peerDetails: {},
                // Thêm chi tiết teacher evaluations
                teacherDetails: {}
            };
            
            // Lấy chi tiết peer evaluations
            if (logData.evaluations && logData.evaluations.members) {
                Object.keys(logData.evaluations.members).forEach(evaluatorId => {
                    const evaluatorEvals = logData.evaluations.members[evaluatorId];
                    Object.keys(evaluatorEvals).forEach(peerId => {
                        if (!historyData.peerDetails[peerId]) {
                            historyData.peerDetails[peerId] = [];
                        }
                        // Tìm tên evaluator từ scores hoặc evaluations
                        historyData.peerDetails[peerId].push({
                            evaluatorId: evaluatorId,
                            score: 0 // Sẽ tính sau
                        });
                    });
                });
            }
            
            // Lấy chi tiết teacher evaluations
            if (logData.evaluations && logData.evaluations.teachers) {
                Object.keys(logData.evaluations.teachers).forEach(teacherId => {
                    const teacherEvals = logData.evaluations.teachers[teacherId];
                    Object.keys(teacherEvals).forEach(peerId => {
                        if (!historyData.teacherDetails[peerId]) {
                            historyData.teacherDetails[peerId] = [];
                        }
                        historyData.teacherDetails[peerId].push({
                            teacherId: teacherId,
                            score: 0 // Sẽ tính sau
                        });
                    });
                });
            }
            
            return res.json(historyData);
        }
        
        return res.status(404).json({ error: 'Evaluation history not found' });
    } catch (error) {
        console.error('Error loading evaluation history:', error);
        res.status(500).json({ error: 'Error loading evaluation history' });
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

// -------- SPA ROUTE FALLBACK (serve index.html for client-side routes) --------
const knownPrefixes = ['/api', '/socket.io', '/uploads', '/quizzes', '/evaluation-details', '/quiz-details'];
app.get(['/root', '/nhom1', '/nhom2', '/nhom3', '/nhom4'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('*', (req, res, next) => {
    try {
        const pathName = req.path || '';
        // Skip API and known prefixes
        if (knownPrefixes.some(p => pathName.startsWith(p))) return next();
        // If client requests HTML, serve SPA entry
        const accepts = req.headers['accept'] || '';
        if (accepts.includes('text/html')) {
            return res.sendFile(path.join(__dirname, 'index.html'));
        }
        next();
    } catch (e) {
        next();
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Tạo phòng mới
    socket.on('create-room', (data) => {
        const roomCode = generateRoomCode();
        const playerName = data.playerName || 'Player';
        const loadExisting = data.loadExisting || false;
        
        // Nếu phòng đã tồn tại và cùng chủ phòng, xử lý như rejoin thay vì tạo mới
        if (rooms.has(roomCode)) {
            const room = rooms.get(roomCode);
            const existingHost = room.players.find(p => p.isHost);
            if (existingHost && existingHost.name === playerName) {
                // Cập nhật host id
                room.host = socket.id;
                existingHost.id = socket.id;
                socket.join(roomCode);
                socket.roomCode = roomCode;
                console.log(`🔄 Host rejoined room ${roomCode} as ${playerName}`);
                socket.emit('room-joined', {
                    roomCode: roomCode,
                    players: getVisiblePlayers(room.players),
                    isHost: true,
                    savedScore: 0
                });
                return;
            }
        }

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
        const { roomCode, playerType, playerName, groupNumber } = data;
        
        console.log(`🔍 Join room attempt: type="${playerType}", name="${playerName}", groupNumber="${groupNumber}"`);
        
        let formattedPlayerName = '';
        let isDefaultGroup = false;
        
        if (playerType === 'group') {
            // Nếu chọn nhóm
            if (!groupNumber || groupNumber < 1 || groupNumber > 4) {
                socket.emit('join-error', { message: 'Vui lòng chọn nhóm từ 1 đến 4!' });
                return;
            }
            
            if (!playerName || playerName.trim() === '') {
                socket.emit('join-error', { message: 'Vui lòng nhập tên nhóm!' });
                return;
            }
            
            // Loại bỏ tất cả prefix "Nhóm X: " để tránh duplicate
            let cleanPlayerName = playerName.trim().replace(/^Nhóm \d+: /g, '').trim();
            formattedPlayerName = `Nhóm ${groupNumber}: ${cleanPlayerName}`;
            isDefaultGroup = true;
            console.log(`✅ Joining as group: ${formattedPlayerName} (cleaned from "${playerName.trim()}")`);
        } else if (playerType === 'teacher') {
            // Nếu chọn thầy/cô
            if (!playerName || playerName.trim() === '') {
                socket.emit('join-error', { message: 'Vui lòng nhập tên thầy/cô!' });
                return;
            }
            
            // Loại bỏ tất cả prefix "Thầy/Cô: " để tránh duplicate
            let cleanPlayerName = playerName.trim().replace(/^Thầy\/Cô: /g, '').trim();
            formattedPlayerName = `Thầy/Cô: ${cleanPlayerName}`;
            isDefaultGroup = false;
            console.log(`👨‍🏫 Joining as teacher: ${formattedPlayerName} (cleaned from "${playerName.trim()}")`);
        } else {
            socket.emit('join-error', { message: 'Vui lòng chọn loại tham gia!' });
            return;
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
            console.log(`🎯 Processing group: ${formattedPlayerName}`);
            // Nếu là nhóm, kiểm tra xem có thể thay thế member mặc định không
            const groupNumber = formattedPlayerName.match(/Nhóm (\d+):/)?.[1];
            const defaultMemberName = `Nhom${groupNumber}`;
            const defaultMemberIndex = room.players.findIndex(p => p.name === defaultMemberName && p.id.startsWith('default-member-'));
            console.log(`🔍 Looking for default member with name "${defaultMemberName}":`, defaultMemberIndex);
            
            if (defaultMemberIndex !== -1) {
                // Thay thế member mặc định
                room.players[defaultMemberIndex] = {
                    id: socket.id,
                    name: formattedPlayerName,
                    isHost: false,
                    score: savedScore
                };
                console.log(`✅ Replaced default member ${defaultMemberName} with real player ${formattedPlayerName}`);
            } else {
                // Kiểm tra xem có phải nhóm này đã từng tham gia và rời đi không
                const existingRealPlayer = room.players.find(p => p.name === formattedPlayerName && !p.id.startsWith('default-member-'));
                console.log(`🔍 Looking for existing real player with name "${formattedPlayerName}":`, existingRealPlayer ? 'Found' : 'Not found');
                
                if (existingRealPlayer) {
                    // Nhóm này đã từng tham gia và rời đi, cho phép vào lại với socket ID mới
                    const playerIndex = room.players.findIndex(p => p.id === existingRealPlayer.id);
                    if (playerIndex !== -1) {
                        room.players[playerIndex] = {
                            id: socket.id,
                            name: formattedPlayerName,
                            isHost: false,
                            score: savedScore
                        };
                        console.log(`✅ Rejoined existing player ${formattedPlayerName} with new socket ID`);
                    }
                } else {
                    // Không tìm thấy slot nào cho nhóm này
                    console.log(`❌ No slot found for group ${formattedPlayerName}`);
                    socket.emit('join-error', { message: `Nhóm ${groupNumber} không có slot trống!` });
                    return;
                }
            }
        } else {
            // Nếu là Thầy/Cô thì bỏ qua kiểm tra giới hạn nhóm
            const isTeacher = formattedPlayerName.startsWith('Thầy/Cô: ');
            if (!isTeacher) {
                // Kiểm tra số lượng NHÓM thực tế (không tính host, không tính member mặc định, KHÔNG tính Thầy/Cô) tối đa 4 nhóm
                const realGroupCount = room.players.filter(p => !p.isHost && !p.id.startsWith('default-member-') && !(p.name && p.name.startsWith('Thầy/Cô: '))).length;
                if (realGroupCount >= 4) {
                    socket.emit('join-error', { message: 'Phòng đã đầy! (Tối đa 4 người chơi thực)' });
                    return;
                }
            }

            // Thêm người chơi mới vào phòng (bao gồm Thầy/Cô)
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

            // Cập nhật quiz mà không ảnh hưởng đến trạng thái người chơi/điểm số
            room.quiz = {
                questions: data.questions,
                createdAt: new Date()
            };
            // Không reset quizActive/currentQuestion/answers/điểm để tránh làm các nhóm bị thoát hoặc mất trạng thái

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

            // Reset scores và xóa logs đánh giá
            room.players.forEach(p => p.score = 0);
            
            // Reset evaluations và xóa logs khi bắt đầu quiz mới
            room.evaluations = {
                host: {},
                members: {},
                teachers: {}
            };
            room.evaluationScoresAdded = {
                host: {},
                members: {},
                teachers: {}
            };
            
            // Xóa file logs đánh giá
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                clearEvaluationLogs(hostPlayer.name, socket.roomCode);
                console.log(`🗑️ Đã xóa evaluation logs khi bắt đầu quiz mới`);
            }

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
                
                // Thông báo cho host khi có người nộp bài
                if (room.host) {
                    const player = room.players.find(p => p.id === socket.id);
                    if (player) {
                        io.to(room.host).emit('player-submitted', {
                            playerName: player.name,
                            questionIndex: questionIndex
                        });
                    }
                }
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

    // Host yêu cầu hiển thị màn hình xếp hạng cuối
    socket.on('show-final-results', () => {
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'Chỉ host mới có thể hiển thị chung cuộc!' });
                return;
            }
            
            let results = [];
            
            // Nếu có đánh giá hoàn chỉnh, sử dụng kết quả từ calculateEvaluationResults
            if (room.evaluations && room.evaluationSetup) {
                const evaluationResults = calculateEvaluationResults(room);
                results = Object.values(evaluationResults).map(result => ({
                    playerId: result.name, // Sử dụng name làm ID cho compatibility
                    playerName: result.name,
                    score: result.totalScore,
                    quizScore: result.quizScore,
                    hostScore: result.hostScore,
                    peerScore: result.peerScore,
                    teacherScore: result.teacherScore,
                    totalScore: result.totalScore,
                    details: result.details
                }));
                results.sort((a, b) => b.totalScore - a.totalScore);
            } else {
                // Fallback: sử dụng kết quả quiz cũ
                results = room.lastQuizResults || [];
                if (!results || !Array.isArray(results) || results.length === 0) {
                    results = getQuizPlayers(room.players).map(p => ({
                        playerId: p.id,
                        playerName: p.name,
                        score: p.score || 0,
                        totalQuestions: room.quiz?.questions?.length || 0,
                        correctAnswers: 0,
                        details: []
                    }));
                    results.sort((a, b) => b.score - a.score);
                }
            }
            
            const top = results.slice(0, 4);
            io.to(socket.roomCode).emit('final-results', { results: top });
        }
    });

    // Xóa điểm và logs của một nhóm
    socket.on('reset-group-data', (data) => {
        const { roomCode, groupId, groupName } = data;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('group-reset-error', { message: 'Không tìm thấy phòng!' });
            return;
        }
        
        // Chỉ host mới có quyền xóa
        if (room.host !== socket.id) {
            socket.emit('group-reset-error', { message: 'Chỉ host mới có thể xóa điểm nhóm!' });
            return;
        }
        
        // Tìm nhóm trong room
        const group = room.players.find(p => p.id === groupId && !p.isHost && !p.name.startsWith('Thầy/Cô: '));
        if (!group) {
            socket.emit('group-reset-error', { message: 'Không tìm thấy nhóm!' });
            return;
        }
        
        const hostPlayer = room.players.find(p => p.isHost);
        if (!hostPlayer) {
            socket.emit('group-reset-error', { message: 'Không tìm thấy host!' });
            return;
        }
        
        try {
            // 1. Reset điểm trong room
            group.score = 0;
            
            // 2. Xóa điểm trong file scores
            const scoresPath = getScoresFilePath(hostPlayer.name);
            if (fs.existsSync(scoresPath)) {
                const scoresData = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
                if (scoresData.scores) {
                    // Xóa điểm của nhóm này
                    scoresData.scores = scoresData.scores.filter(s => s.name !== group.name);
                    fs.writeFileSync(scoresPath, JSON.stringify(scoresData, null, 2));
                    console.log(`🗑️ Đã xóa điểm của ${group.name} trong file scores`);
                }
            }
            
            // 3. Xóa logs trong file evaluation logs
            const logsKey = hostPlayer.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const logsPath = path.join(__dirname, 'quizzes', `${logsKey}-evaluation-logs.json`);
            if (fs.existsSync(logsPath)) {
                const logsData = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
                if (logsData.evaluations) {
                    // Xóa đánh giá của nhóm này trong host evaluations
                    if (logsData.evaluations.host && logsData.evaluations.host[groupId]) {
                        delete logsData.evaluations.host[groupId];
                    }
                    
                    // Xóa đánh giá của nhóm này trong member evaluations
                    if (logsData.evaluations.members) {
                        Object.keys(logsData.evaluations.members).forEach(evaluatorId => {
                            const memberEval = logsData.evaluations.members[evaluatorId];
                            if (memberEval && memberEval[groupId]) {
                                delete memberEval[groupId];
                            }
                        });
                    }
                    
                    // Xóa đánh giá của nhóm này trong teacher evaluations
                    if (logsData.evaluations.teachers) {
                        Object.keys(logsData.evaluations.teachers).forEach(teacherId => {
                            const teacherEval = logsData.evaluations.teachers[teacherId];
                            if (teacherEval && teacherEval[groupId]) {
                                delete teacherEval[groupId];
                            }
                        });
                    }
                    
                    fs.writeFileSync(logsPath, JSON.stringify(logsData, null, 2));
                    console.log(`🗑️ Đã xóa logs đánh giá của ${group.name} trong file evaluation logs`);
                }
            }
            
            // 4. Xóa quiz details của nhóm này
            const safeHostName = sanitizeFileName(hostPlayer.name);
            const safeRoomCode = sanitizeFileName(roomCode);
            const quizDetailsPath = path.join(__dirname, 'quiz-details', `${safeHostName}-${safeRoomCode}-quiz-details.json`);
            if (fs.existsSync(quizDetailsPath)) {
                const quizDetailsData = JSON.parse(fs.readFileSync(quizDetailsPath, 'utf8'));
                if (quizDetailsData.results && Array.isArray(quizDetailsData.results)) {
                    // Xóa kết quả của nhóm này
                    const beforeCount = quizDetailsData.results.length;
                    quizDetailsData.results = quizDetailsData.results.filter(r => r.playerId !== groupId && r.playerName !== group.name);
                    const afterCount = quizDetailsData.results.length;
                    
                    if (beforeCount !== afterCount) {
                        fs.writeFileSync(quizDetailsPath, JSON.stringify(quizDetailsData, null, 2));
                        console.log(`🗑️ Đã xóa quiz details của ${group.name} trong file quiz-details`);
                    }
                }
            }
            
            // 5. Xóa evaluation details của nhóm này
            const evalDetailsPath = path.join(__dirname, 'evaluation-details', `${safeHostName}-${safeRoomCode}-evaluation-details.json`);
            if (fs.existsSync(evalDetailsPath)) {
                const evalDetailsData = JSON.parse(fs.readFileSync(evalDetailsPath, 'utf8'));
                if (evalDetailsData.memberDetails && Array.isArray(evalDetailsData.memberDetails)) {
                    // Xóa chi tiết đánh giá của nhóm này
                    const beforeCount = evalDetailsData.memberDetails.length;
                    evalDetailsData.memberDetails = evalDetailsData.memberDetails.filter(m => m.memberId !== groupId && m.memberName !== group.name);
                    const afterCount = evalDetailsData.memberDetails.length;
                    
                    if (beforeCount !== afterCount) {
                        // Cập nhật summary
                        if (evalDetailsData.summary) {
                            evalDetailsData.summary.totalMembers = afterCount;
                            // Tính lại average scores nếu cần
                            if (afterCount > 0) {
                                const totalHostScore = evalDetailsData.memberDetails.reduce((sum, m) => sum + (m.hostEvaluation?.totalScore || 0), 0);
                                const totalPeerScore = evalDetailsData.memberDetails.reduce((sum, m) => sum + (m.peerAverageScore || 0), 0);
                                evalDetailsData.summary.averageHostScore = totalHostScore / afterCount;
                                evalDetailsData.summary.averagePeerScore = totalPeerScore / afterCount;
                            } else {
                                evalDetailsData.summary.averageHostScore = 0;
                                evalDetailsData.summary.averagePeerScore = 0;
                            }
                        }
                        
                        fs.writeFileSync(evalDetailsPath, JSON.stringify(evalDetailsData, null, 2));
                        console.log(`🗑️ Đã xóa evaluation details của ${group.name} trong file evaluation-details`);
                    }
                }
            }
            
            // 6. Reset evaluation scores trong room
            if (room.evaluationScoresAdded) {
                if (room.evaluationScoresAdded.host && room.evaluationScoresAdded.host[groupId]) {
                    delete room.evaluationScoresAdded.host[groupId];
                }
                if (room.evaluationScoresAdded.members && room.evaluationScoresAdded.members[groupId]) {
                    delete room.evaluationScoresAdded.members[groupId];
                }
                if (room.evaluationScoresAdded.teachers && room.evaluationScoresAdded.teachers[groupId]) {
                    delete room.evaluationScoresAdded.teachers[groupId];
                }
            }
            
            // 7. Reset evaluations trong room
            if (room.evaluations) {
                if (room.evaluations.host && room.evaluations.host[groupId]) {
                    delete room.evaluations.host[groupId];
                }
                if (room.evaluations.members) {
                    Object.keys(room.evaluations.members).forEach(evaluatorId => {
                        const memberEval = room.evaluations.members[evaluatorId];
                        if (memberEval && memberEval[groupId]) {
                            delete memberEval[groupId];
                        }
                    });
                }
                if (room.evaluations.teachers) {
                    Object.keys(room.evaluations.teachers).forEach(teacherId => {
                        const teacherEval = room.evaluations.teachers[teacherId];
                        if (teacherEval && teacherEval[groupId]) {
                            delete teacherEval[groupId];
                        }
                    });
                }
            }
            
            // 8. Broadcast lại danh sách players
            io.to(roomCode).emit('players-list', { players: getVisiblePlayers(room.players) });
            
            console.log(`✅ Đã xóa thành công điểm và logs của nhóm ${group.name} (${groupId})`);
            socket.emit('group-reset-success', { groupName: group.name, groupId: groupId });
            
        } catch (error) {
            console.error('❌ Lỗi khi xóa điểm và logs của nhóm:', error);
            socket.emit('group-reset-error', { message: `Lỗi khi xóa: ${error.message}` });
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

        // Tìm và xử lý người chơi rời khỏi phòng
        if (socket.roomCode && rooms.has(socket.roomCode)) {
            const room = rooms.get(socket.roomCode);
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                const playerName = player.name;
                
                // Kiểm tra xem có phải nhóm không
                const isDefaultGroup = playerName.startsWith('Nhóm ');
                
                if (isDefaultGroup) {
                    // Nếu là nhóm rời đi, tạo lại member mặc định
                    const groupNumber = playerName.match(/Nhóm (\d+):/)?.[1];
                    const defaultMemberName = `Nhom${groupNumber}`;
                    room.players[playerIndex] = {
                        id: `default-member-${groupNumber}`,
                        name: defaultMemberName,
                        isHost: false,
                        score: 0
                    };
                    console.log(`Group ${playerName} left, restored default member ${defaultMemberName}`);
                } else {
                    // Nếu không phải nhóm mặc định, xóa hoàn toàn
                    room.players.splice(playerIndex, 1);
                }

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
                        players: getVisiblePlayers(room.players),
                        isDefaultGroup: isDefaultGroup
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
                const player = room.players[playerIndex];
                const playerName = player.name;
                
                // Kiểm tra xem có phải nhóm không
                const isDefaultGroup = playerName.startsWith('Nhóm ');
                
                if (isDefaultGroup) {
                    // Nếu là nhóm rời đi, tạo lại member mặc định
                    const groupNumber = playerName.match(/Nhóm (\d+):/)?.[1];
                    const defaultMemberName = `Nhom${groupNumber}`;
                    room.players[playerIndex] = {
                        id: `default-member-${groupNumber}`,
                        name: defaultMemberName,
                        isHost: false,
                        score: 0
                    };
                    console.log(`Group ${playerName} left, restored default member ${defaultMemberName}`);
                } else {
                    // Nếu không phải nhóm mặc định, xóa hoàn toàn
                    room.players.splice(playerIndex, 1);
                }

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
                        players: getVisiblePlayers(room.players),
                        isDefaultGroup: isDefaultGroup
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
            // Xóa logs đánh giá cũ khi bắt đầu đánh giá mới
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                clearEvaluationLogs(hostPlayer.name, roomCode);
                console.log(`🗑️ Đã xóa evaluation logs khi bắt đầu đánh giá mới`);
            }
            
            // Đảm bảo memberCriteria được load từ file JSON
            let finalSetup = setup;
            try {
                const criteriaPath = path.join(__dirname, 'evaluation-criteria.json');
                if (fs.existsSync(criteriaPath)) {
                    const jsonData = JSON.parse(fs.readFileSync(criteriaPath, 'utf8'));
                    // Merge memberCriteria từ JSON vào setup
                    if (jsonData && jsonData.memberCriteria) {
                        if (!finalSetup) finalSetup = {};
                        if (!finalSetup.memberCriteria) finalSetup.memberCriteria = [];
                        // Đảm bảo memberCriteria được load từ JSON
                        finalSetup.memberCriteria = jsonData.memberCriteria.map(jsonC => {
                            const existing = finalSetup.memberCriteria.find(c => c.id === jsonC.id);
                            return existing ? { ...jsonC, ...existing } : jsonC;
                        });
                        console.log(`✅ Loaded memberCriteria from evaluation-criteria.json: ${finalSetup.memberCriteria.length} criteria`);
                    }
                    // Cũng merge hostCriteria và ratingLevels nếu thiếu
                    if (jsonData && jsonData.hostCriteria && (!finalSetup.hostCriteria || finalSetup.hostCriteria.length === 0)) {
                        finalSetup.hostCriteria = jsonData.hostCriteria;
                    }
                    if (jsonData && jsonData.ratingLevels && (!finalSetup.ratingLevels || finalSetup.ratingLevels.length === 0)) {
                        finalSetup.ratingLevels = jsonData.ratingLevels;
                    }
                }
            } catch (error) {
                console.error('⚠️ Failed to load evaluation-criteria.json:', error.message);
            }
            
            room.evaluationSetup = finalSetup;
            room.evaluationActive = true;
            room.evaluationPhase = 'host'; // phases: host -> members -> teachers
            room.evaluations = {
                host: {},
                members: {},
                teachers: {}
            };
            room.evaluationScoresAdded = {
                host: {},
                members: {},
                teachers: {}
            };
            
            // Broadcast đến tất cả members
            const evaluatedPlayers = getEvaluatedPlayers(room.players);
            console.log('📋 Evaluation started - evaluatedPlayers:', evaluatedPlayers.map(p => p.name));
            
            io.to(roomCode).emit('evaluation-started', {
                setup: finalSetup, // Gửi setup đã được merge với memberCriteria từ JSON
                players: getVisiblePlayers(room.players),
                evaluablePlayers: getEvaluablePlayers(room.players), // Những người có thể đánh giá (bao gồm Thầy/Cô)
                evaluatedPlayers: evaluatedPlayers, // Những người có thể được đánh giá (không bao gồm Thầy/Cô)
                phase: 'host'
            });

            // Thông báo phase ban đầu
            io.to(roomCode).emit('evaluation-phase', { phase: 'host' });
            
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
            
            // Gộp dồn đánh giá host thay vì ghi đè
            if (!room.evaluations) room.evaluations = { host: {}, members: {}, teachers: {} };
            if (!room.evaluations.host) room.evaluations.host = {};
            Object.keys(evaluations || {}).forEach(memberId => {
                room.evaluations.host[memberId] = {
                    ...(room.evaluations.host[memberId] || {}),
                    ...evaluations[memberId]
                };
            });
            
            console.log('📊 Host evaluation received:', evaluationScores);
            
            // Log chi tiết đánh giá của host
            console.log('🔍 Host evaluation details:');
            Object.keys(evaluations).forEach(memberId => {
                const member = room.players.find(p => p.id === memberId);
                if (member) {
                    console.log(`   👤 ${member.name}:`);
                    Object.keys(evaluations[memberId]).forEach(criteriaId => {
                        const criteria = room.evaluationSetup?.hostCriteria?.find(c => c.id == criteriaId);
                        const levelId = evaluations[memberId][criteriaId];
                        const level = room.evaluationSetup?.ratingLevels?.find(l => l.id === levelId);
                        const score = criteria ? (criteria.maxScore / 4) * levelId : 0;
                        
                        console.log(`      📋 ${criteria?.name || 'Unknown'}: ${level?.name || 'Unknown'} (${levelId}) = ${score}/${criteria?.maxScore || 0} điểm`);
                    });
                }
            });
            
            // CỘNG ĐIỂM ĐÁNH GIÁ HOST VÀO ĐIỂM TÍCH LŨY (giới hạn 40 điểm/nhóm)
            Object.keys(evaluationScores).forEach(memberId => {
                const member = room.players.find(p => p.id === memberId);
                if (member && !member.isHost && !member.name.startsWith('Thầy/Cô: ')) {
                    // Kiểm tra xem đã cộng điểm host evaluation chưa
                    if (!room.evaluationScoresAdded) {
                        room.evaluationScoresAdded = { host: {}, members: {}, teachers: {} };
                    }
                    
                    if (!room.evaluationScoresAdded.host[memberId]) {
                    const currentScore = member.score || 0; // Điểm tích lũy hiện tại
                        const hostEvaluationScore = Math.min(evaluationScores[memberId], 40); // Giới hạn 40 điểm từ host
                        const newScore = currentScore + hostEvaluationScore; // Cộng vào điểm tích lũy
                    
                    member.score = newScore;
                        room.evaluationScoresAdded.host[memberId] = hostEvaluationScore; // Đánh dấu đã cộng
                        
                        console.log(`✅ Host evaluation added for ${member.name}: ${currentScore} (tích lũy) + ${hostEvaluationScore} (host đánh giá) = ${newScore}`);
                        
                        // Thông báo cho member khi được host đánh giá
                        io.to(memberId).emit('host-evaluation-received', {
                            evaluatorName: 'Giáo viên',
                            evaluatedScore: hostEvaluationScore,
                            newTotalScore: newScore
                        });
                    } else {
                        console.log(`⚠️ Host evaluation already added for ${member.name}, skipping...`);
                    }
                }
            });
            
            // Lưu điểm mới vào file scores
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                saveScoresToFile(hostPlayer.name, roomCode, room.players);
                // Lưu logs đánh giá
                saveEvaluationLogs(hostPlayer.name, roomCode, room.evaluations, room.evaluationSetup, room.players);
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

            // Kiểm tra xem có nhóm nào cần đánh giá nhau không
            const evaluableMembers = getEvaluablePlayers(room.players).filter(p => !p.name.startsWith('Thầy/Cô: '));
            const evaluatedMembers = getEvaluatedPlayers(room.players);
            
            // Nếu có ít hơn 2 nhóm để đánh giá nhau, tự động chuyển sang phase teachers
            if (evaluableMembers.length < 2 || evaluatedMembers.length < 2) {
                if (hasTeachers(room)) {
                    const teachers = room.players.filter(p => p.name && p.name.startsWith('Thầy/Cô: '));
                    console.log(`📋 Not enough members to evaluate each other (${evaluableMembers.length} evaluable, ${evaluatedMembers.length} evaluated), moving to teachers phase`);
                    console.log(`   👨‍🏫 Teachers in room: ${teachers.map(t => t.name).join(', ')}`);
                    room.evaluationPhase = 'teachers';
                    io.to(roomCode).emit('evaluation-phase', { phase: 'teachers' });
                    console.log(`   ✅ Emitted evaluation-phase event with phase: teachers to room ${roomCode}`);
                } else {
                    console.log(`📋 Not enough members to evaluate each other, and no teachers, finalizing`);
                    finalizeEvaluations(room, roomCode);
                }
            } else {
                // Chuyển phase sang members sau khi Host hoàn thành
                console.log(`📋 Moving to members phase (${evaluableMembers.length} evaluable, ${evaluatedMembers.length} evaluated)`);
                room.evaluationPhase = 'members';
                io.to(roomCode).emit('evaluation-phase', { phase: 'members' });
                // Kiểm tra xem có nhóm nào đã đánh giá chưa
                checkEvaluationProgress(room, roomCode);
            }
        }
    });

    // Nhận đánh giá từ member
    socket.on('submit-member-evaluation', (data) => {
        const { roomCode, evaluatorId, evaluations, evaluationScores } = data;
        const room = rooms.get(roomCode);
        
        console.log(`📥 submit-member-evaluation received: roomCode=${roomCode}, evaluatorId=${evaluatorId}`);
        console.log(`   - Evaluations count: ${Object.keys(evaluations || {}).length}`);
        console.log(`   - Evaluation scores:`, evaluationScores);
        
        if (room) {
            // Kiểm tra phase
            const evaluatorPlayerPhase = room.players.find(p => p.id === evaluatorId);
            const isTeacherPhase = evaluatorPlayerPhase && evaluatorPlayerPhase.name.startsWith('Thầy/Cô: ');
            console.log(`   - Evaluator: ${evaluatorPlayerPhase?.name || 'Unknown'}, isTeacher: ${isTeacherPhase}`);
            console.log(`   - Current phase: ${room.evaluationPhase}`);
            
            if (!room.evaluationPhase) {
                room.evaluationPhase = 'host';
            }
            if (!isTeacherPhase && room.evaluationPhase !== 'members') {
                console.log(`   ❌ Rejected: Only allowed after Host completed. Current phase: ${room.evaluationPhase}`);
                socket.emit('error', { message: 'Chỉ được đánh giá sau khi Host hoàn thành.' });
                return;
            }
            if (isTeacherPhase && room.evaluationPhase !== 'teachers') {
                console.log(`   ❌ Rejected: Teachers can only evaluate after members completed. Current phase: ${room.evaluationPhase}`);
                socket.emit('error', { message: 'Thầy/Cô sẽ đánh giá sau khi các nhóm hoàn thành.' });
                return;
            }
            
            console.log(`   ✅ Phase check passed. Processing evaluation...`);
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
            
            // Lấy thông tin người đánh giá
            const evaluatorPlayer = room.players.find(p => p.id === evaluatorId);
            
            // Log chi tiết đánh giá của member
            console.log(`🔍 Member evaluation details from ${evaluatorPlayer?.name || 'Unknown'}:`);
            console.log(`   📊 Using memberCriteria with maxScores:`, room.evaluationSetup?.memberCriteria?.map(c => `${c.name}: ${c.maxScore}`).join(', ') || 'N/A');
            Object.keys(evaluations).forEach(peerId => {
                const peer = room.players.find(p => p.id === peerId);
                if (peer) {
                    console.log(`   👤 ${peer.name}:`);
                    let totalScore = 0;
                    Object.keys(evaluations[peerId]).forEach(criteriaId => {
                        const criteria = room.evaluationSetup?.memberCriteria?.find(c => c.id == criteriaId);
                        const levelId = evaluations[peerId][criteriaId];
                        const level = room.evaluationSetup?.ratingLevels?.find(l => l.id === levelId);
                        const score = criteria ? (criteria.maxScore / 4) * levelId : 0;
                        totalScore += score;
                        
                        console.log(`      📋 ${criteria?.name || 'Unknown'}: ${level?.name || 'Unknown'} (${levelId}) = ${score.toFixed(2)}/${criteria?.maxScore || 0} điểm (maxScore: ${criteria?.maxScore || 0})`);
                    });
                    console.log(`      ✅ Tổng điểm: ${totalScore.toFixed(2)} / ${room.evaluationSetup?.memberCriteria?.reduce((sum, c) => sum + c.maxScore, 0) || 0} điểm`);
                }
            });
            
            // Thông báo cho host khi có member đánh giá xong
            if (room.host) {
                if (evaluatorPlayer) {
                    io.to(room.host).emit('member-evaluation-submitted', {
                        evaluatorName: evaluatorPlayer.name,
                        evaluatedCount: Object.keys(evaluationScores).length
                    });
                }
            }
            
            // XỬ LÝ ĐÁNH GIÁ CỦA THẦY/CÔ VÀ NHÓM
            const isTeacher = evaluatorPlayer && evaluatorPlayer.name.startsWith('Thầy/Cô: ');
            
            if (isTeacher) {
                // XỬ LÝ ĐÁNH GIÁ CỦA THẦY/CÔ - TÍNH TRUNG BÌNH CỘNG
                console.log(`👨‍🏫 Teacher evaluation from ${evaluatorPlayer.name}`);
                console.log(`   📊 Using memberCriteria with maxScores:`, room.evaluationSetup?.memberCriteria?.map(c => `${c.name}: ${c.maxScore}`).join(', ') || 'N/A');
                
                // Log chi tiết đánh giá của teacher
                Object.keys(evaluations).forEach(peerId => {
                    const peer = room.players.find(p => p.id === peerId);
                    if (peer) {
                        console.log(`   👤 ${peer.name}:`);
                        let totalScore = 0;
                        Object.keys(evaluations[peerId]).forEach(criteriaId => {
                            const criteria = room.evaluationSetup?.memberCriteria?.find(c => c.id == criteriaId);
                            const levelId = evaluations[peerId][criteriaId];
                            const level = room.evaluationSetup?.ratingLevels?.find(l => l.id === levelId);
                            const score = criteria ? (criteria.maxScore / 4) * levelId : 0;
                            totalScore += score;
                            
                            console.log(`      📋 ${criteria?.name || 'Unknown'}: ${level?.name || 'Unknown'} (${levelId}) = ${score.toFixed(2)}/${criteria?.maxScore || 0} điểm (maxScore: ${criteria?.maxScore || 0})`);
                        });
                        console.log(`      ✅ Tổng điểm: ${totalScore.toFixed(2)} / ${room.evaluationSetup?.memberCriteria?.reduce((sum, c) => sum + c.maxScore, 0) || 0} điểm`);
                    }
                });
                
                // Lưu đánh giá của thầy/cô (gộp dồn thay vì ghi đè)
                if (!room.evaluations.teachers) {
                    room.evaluations.teachers = {};
                }
                if (!room.evaluations.teachers[evaluatorId]) {
                    room.evaluations.teachers[evaluatorId] = {};
                }
                // Merge đánh giá mới vào đánh giá cũ
                console.log(`📝 Merging teacher evaluations from ${evaluatorPlayer.name} (${evaluatorId}):`, evaluations);
                Object.keys(evaluations || {}).forEach(peerId => {
                    room.evaluations.teachers[evaluatorId][peerId] = {
                        ...(room.evaluations.teachers[evaluatorId][peerId] || {}),
                        ...evaluations[peerId]
                    };
                    console.log(`   ✅ Saved evaluation for peer ${peerId}:`, room.evaluations.teachers[evaluatorId][peerId]);
                });
                console.log(`📊 Current room.evaluations.teachers:`, JSON.stringify(room.evaluations.teachers, null, 2));
                
                // Tính trung bình cộng cho mỗi nhóm được đánh giá
            Object.keys(evaluationScores).forEach(peerId => {
                const peer = room.players.find(p => p.id === peerId);
                if (peer && !peer.isHost && !peer.name.startsWith('Thầy/Cô: ')) {
                        // Lấy tất cả đánh giá của thầy/cô cho nhóm này
                        const teacherScores = [];
                        Object.keys(room.evaluations.teachers).forEach(teacherId => {
                            const teacherEval = room.evaluations.teachers[teacherId];
                            if (teacherEval[peerId]) {
                                const teacherScore = calculateEvaluationScore(teacherEval[peerId], room.evaluationSetup?.memberCriteria || []);
                                teacherScores.push(teacherScore);
                            }
                        });
                        
                        if (teacherScores.length > 0) {
                            // Tính trung bình cộng
                            const averageScore = teacherScores.reduce((sum, score) => sum + score, 0) / teacherScores.length;
                            
                            // Kiểm tra xem đã cộng điểm teacher evaluation chưa
                            if (!room.evaluationScoresAdded) {
                                room.evaluationScoresAdded = { host: {}, members: {}, teachers: {} };
                            }
                            
                            if (!room.evaluationScoresAdded.teachers[peerId]) {
                    const currentScore = peer.score || 0;
                                const teacherEvaluationScore = Math.round(averageScore * 100) / 100; // Làm tròn 2 chữ số thập phân
                                const newScore = currentScore + teacherEvaluationScore;
                                
                                peer.score = newScore;
                                room.evaluationScoresAdded.teachers[peerId] = teacherEvaluationScore;
                                
                                console.log(`✅ Teacher evaluation added for ${peer.name}: ${currentScore} (tích lũy) + ${teacherEvaluationScore} (trung bình thầy/cô) = ${newScore}`);
                                console.log(`   📊 Teacher scores: [${teacherScores.join(', ')}] → Average: ${teacherEvaluationScore}`);
                            } else {
                                console.log(`⚠️ Teacher evaluation already added for ${peer.name}, skipping...`);
                            }
                        }
                    }
                });
                
                // Thông báo cho host khi có thầy/cô đánh giá xong
                if (room.host) {
                    if (evaluatorPlayer) {
                        io.to(room.host).emit('member-evaluation-submitted', {
                            evaluatorName: evaluatorPlayer.name,
                            evaluatedCount: Object.keys(evaluationScores).length,
                            isTeacher: true
                        });
                        console.log(`📢 Thông báo cho host: ${evaluatorPlayer.name} đã đánh giá ${Object.keys(evaluationScores).length} nhóm`);
                    }
                }
                
                // Broadcast lại danh sách players để cập nhật điểm
                io.to(roomCode).emit('players-list', { players: getVisiblePlayers(room.players) });
                
                // Lưu logs đánh giá thầy/cô
                const hostPlayer = room.players.find(p => p.isHost);
                if (hostPlayer) {
                    // Debug: Kiểm tra room.evaluations.teachers trước khi lưu
                    console.log(`📋 Before saving logs - room.evaluations.teachers:`, JSON.stringify(room.evaluations.teachers, null, 2));
                    console.log(`📋 Teacher evaluations count:`, Object.keys(room.evaluations.teachers || {}).length);
                    
                    saveScoresToFile(hostPlayer.name, roomCode, room.players);
                    saveEvaluationLogs(hostPlayer.name, roomCode, room.evaluations, room.evaluationSetup, room.players);
                    
                    // Cập nhật file evaluation-details.json để hiển thị teacher evaluations
                    if (room.evaluationSetup && room.evaluations && room.players) {
                        const evaluatedPlayers = getEvaluatedPlayers(room.players);
                        saveEvaluationDetails(hostPlayer.name, roomCode, room.evaluationSetup, room.evaluations, evaluatedPlayers);
                        console.log(`💾 Updated evaluation-details.json with teacher evaluations`);
                    }
                    console.log(`💾 Scores with teacher evaluation saved to file for ${hostPlayer.name}`);
                }
                
                // Kiểm tra xem tất cả thầy/cô đã đánh giá chưa
                checkEvaluationProgress(room, roomCode);
            } else {
                // XỬ LÝ ĐÁNH GIÁ CỦA NHÓM - GIỚI HẠN 20 ĐIỂM/NHÓM
                Object.keys(evaluationScores).forEach(peerId => {
                    const peer = room.players.find(p => p.id === peerId);
                    if (peer && !peer.isHost && !peer.name.startsWith('Thầy/Cô: ')) {
                        // Kiểm tra xem đã cộng điểm member evaluation chưa
                        if (!room.evaluationScoresAdded) {
                            room.evaluationScoresAdded = { host: {}, members: {}, teachers: {} };
                        }
                        
                        if (!room.evaluationScoresAdded.members[peerId]) {
                            const currentScore = peer.score || 0;
                            const memberEvaluationScore = Math.min(evaluationScores[peerId], 20); // Giới hạn 20 điểm từ member evaluation
                            const newScore = currentScore + memberEvaluationScore;
                            
                            peer.score = newScore;
                            room.evaluationScoresAdded.members[peerId] = memberEvaluationScore; // Đánh dấu đã cộng
                            
                            console.log(`✅ Member evaluation added for ${peer.name}: ${currentScore} (tích lũy) + ${memberEvaluationScore} (member đánh giá) = ${newScore}`);
                        } else {
                            console.log(`⚠️ Member evaluation already added for ${peer.name}, skipping...`);
                        }
                    }
                });
                
                // Lưu logs đánh giá nhóm
                const hostPlayer = room.players.find(p => p.isHost);
                if (hostPlayer) {
                    saveScoresToFile(hostPlayer.name, roomCode, room.players);
                    saveEvaluationLogs(hostPlayer.name, roomCode, room.evaluations, room.evaluationSetup, room.players);
                    console.log(`💾 Scores with member evaluation saved to file for ${hostPlayer.name}`);
                }
            }
            
            // Broadcast điểm mới đến tất cả clients
            io.to(roomCode).emit('players-list', { players: getVisiblePlayers(room.players) });
            
            // Broadcast thông báo cập nhật điểm
            io.to(roomCode).emit('member-evaluation-scores-added', {
                message: `${evaluatorPlayer?.name || 'Member'} đã hoàn thành đánh giá! Điểm đã được cộng vào.`,
                updatedPlayers: room.players.filter(p => !p.isHost && evaluationScores[p.id]),
                evaluationScores: evaluationScores,
                evaluatorName: evaluatorPlayer?.name || 'Member'
            });
            
            console.log(`🎯 Member evaluation scores added immediately for room ${roomCode}`);
            
            // Kiểm tra xem tất cả đã đánh giá chưa/ chuyển phase
            checkEvaluationProgress(room, roomCode);
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
        
        // Đảm bảo evaluations.teachers tồn tại (có thể là object rỗng)
        if (!evaluations.teachers) {
            evaluations.teachers = {};
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
                
                // Debug log
                console.log(`🔍 Server debug: ${criteria.name} - levelId: ${levelId}, maxScore: ${criteria.maxScore}, score: ${score}`);
                
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
            
            // Đánh giá từ thầy/cô
            const teacherEvaluations = [];
            if (evaluations.teachers) {
                Object.keys(evaluations.teachers).forEach(teacherId => {
                    const teacherEval = evaluations.teachers[teacherId][member.id] || {};
                    
                    const teacher = players.find(p => p.id === teacherId);
                    if (!teacher || !teacher.name.startsWith('Thầy/Cô: ')) {
                        return;
                    }
                    
                    const teacherDetails = evaluationSetup.memberCriteria.map(criteria => {
                        const levelId = teacherEval[criteria.id];
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
                    
                    teacherEvaluations.push({
                        evaluatorId: teacherId,
                        evaluatorName: teacher.name,
                        evaluations: teacherDetails
                    });
                });
            }
            
            // Tính tổng điểm
            const hostTotalScore = hostEvaluationDetails.reduce((sum, detail) => sum + detail.score, 0);
            const peerTotalScores = peerEvaluations.map(peer => 
                peer.evaluations.reduce((sum, detail) => sum + detail.score, 0)
            );
            const peerAverageScore = peerTotalScores.length > 0 
                ? peerTotalScores.reduce((a, b) => a + b, 0) / peerTotalScores.length 
                : 0;
            
            const teacherTotalScores = teacherEvaluations.map(teacher => 
                teacher.evaluations.reduce((sum, detail) => sum + detail.score, 0)
            );
            const teacherAverageScore = teacherTotalScores.length > 0 
                ? teacherTotalScores.reduce((a, b) => a + b, 0) / teacherTotalScores.length 
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
                teacherEvaluations: teacherEvaluations,
                teacherAverageScore: teacherAverageScore,
                summary: {
                    hostScore: hostTotalScore,
                    peerAverageScore: peerAverageScore,
                    teacherAverageScore: teacherAverageScore,
                    totalEvaluationScore: hostTotalScore + peerAverageScore + teacherAverageScore
                }
            };
        });
        
        const totalMembers = members.length;
        // Tính số người đánh giá thực sự (chỉ tính những người có thể đánh giá, không tính Thầy/Cô)
        const evaluablePlayers = getEvaluablePlayers(players).filter(p => !p.name.startsWith('Thầy/Cô: '));
        const totalEvaluators = evaluablePlayers.length;
        const teachers = players.filter(p => p.name && p.name.startsWith('Thầy/Cô: '));
        const totalTeachers = teachers.length;
        const avgHostScore = totalMembers > 0 
            ? memberDetails.reduce((sum, m) => sum + m.hostEvaluation.totalScore, 0) / totalMembers 
            : 0;
        const avgPeerScore = totalMembers > 0 
            ? memberDetails.reduce((sum, m) => sum + m.peerAverageScore, 0) / totalMembers 
            : 0;
        const avgTeacherScore = totalMembers > 0 
            ? memberDetails.reduce((sum, m) => sum + m.teacherAverageScore, 0) / totalMembers 
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
                totalTeachers: totalTeachers,
                averageHostScore: avgHostScore,
                averagePeerScore: avgPeerScore,
                averageTeacherScore: avgTeacherScore
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

// Tính điểm đánh giá từ evaluations và criteria
function calculateEvaluationScore(evaluations, criteria) {
    let totalScore = 0;
    Object.keys(evaluations).forEach(criteriaId => {
        const levelId = evaluations[criteriaId];
        const criteriaItem = criteria.find(c => c.id == criteriaId);
        if (criteriaItem) {
            const score = (criteriaItem.maxScore / 4) * levelId;
            totalScore += score;
        }
    });
    return totalScore;
}

// Kiểm tra và tính kết quả khi tất cả đã đánh giá
function hasTeachers(room) {
    return room.players.some(p => p.name && p.name.startsWith('Thầy/Cô: '));
}

function allMembersCompleted(room) {
    const evaluablePlayers = getEvaluablePlayers(room.players).filter(p => !p.name.startsWith('Thầy/Cô: '));
    const evaluatedPlayers = getEvaluatedPlayers(room.players).filter(p => !p.id.startsWith('default-member-'));
    
    console.log(`🔍 allMembersCompleted check:`);
    console.log(`   - evaluablePlayers: ${evaluablePlayers.map(p => `${p.name}(${p.id})`).join(', ')}`);
    console.log(`   - evaluatedPlayers: ${evaluatedPlayers.map(p => `${p.name}(${p.id})`).join(', ')}`);
    
    // Chỉ kiểm tra các nhóm còn online (không phải default member)
    if (evaluablePlayers.length === 0) {
        console.log(`   - No evaluable players, returning false`);
        return false; // Không có nhóm nào online thì chưa hoàn thành
    }
    
    // Nếu không có nhóm nào được đánh giá thì chưa hoàn thành
    if (evaluatedPlayers.length === 0) {
        console.log(`   - No evaluated players, returning false`);
        return false;
    }
    
    // Kiểm tra tất cả các nhóm online đã đánh giá chưa
    const result = evaluablePlayers.every(evaluator => {
        const evaluatorEvaluations = room.evaluations.members[evaluator.id] || {};
        console.log(`   - Checking ${evaluator.name} (${evaluator.id}):`);
        // Kiểm tra evaluator đã đánh giá tất cả các nhóm online chưa (trừ chính mình)
        const hasEvaluatedAll = evaluatedPlayers.every(target => {
            // Không tự đánh giá và đã đánh giá target này
            if (target.id === evaluator.id) {
                console.log(`     - ${target.name}: self (skip)`);
                return true; // Không tự đánh giá là OK
            }
            const hasEvaluated = evaluatorEvaluations[target.id] !== undefined;
            console.log(`     - ${target.name}: ${hasEvaluated ? '✅' : '❌'}`);
            return hasEvaluated;
        });
        console.log(`     - Has evaluated all: ${hasEvaluatedAll}`);
        return hasEvaluatedAll;
    });
    
    console.log(`   - Final result: ${result}`);
    return result;
}

function allTeachersCompleted(room) {
    const teachers = room.players.filter(p => p.name && p.name.startsWith('Thầy/Cô: '));
    if (teachers.length === 0) return true;
    if (!room.evaluations.teachers) return false;
    const evaluatedPlayers = getEvaluatedPlayers(room.players);
    return teachers.every(t => {
        const evals = room.evaluations.teachers[t.id];
        if (!evals) return false;
        return evaluatedPlayers.every(target => !!evals[target.id]);
    });
}

function checkEvaluationProgress(room, roomCode) {
    // Ensure host has completed first
    if (!room.evaluations.host) {
        return;
    }
    if (!room.evaluationPhase) room.evaluationPhase = 'host';

    if (room.evaluationPhase === 'members') {
        const isCompleted = allMembersCompleted(room);
        console.log(`🔍 Checking members completion: ${isCompleted}`);
        if (isCompleted) {
            // Move to teachers or finalize if no teachers
            if (hasTeachers(room)) {
                console.log('📋 All members completed, moving to teachers phase');
                room.evaluationPhase = 'teachers';
                io.to(roomCode).emit('evaluation-phase', { phase: 'teachers' });
            } else {
                console.log('📋 All members completed, no teachers, finalizing');
                finalizeEvaluations(room, roomCode);
            }
        } else {
            console.log('📋 Members still evaluating...');
        }
        return;
    }
    if (room.evaluationPhase === 'teachers') {
        if (allTeachersCompleted(room)) {
            finalizeEvaluations(room, roomCode);
        }
        return;
    }
}

function finalizeEvaluations(room, roomCode) {
    console.log('📊 All evaluations submitted. Finalizing results...');
    const hostPlayer = room.players.find(p => p.isHost);
    const results = calculateEvaluationResults(room);
    if (hostPlayer) {
        saveEvaluationResults(hostPlayer.name, roomCode, results);
        try {
            const saveResult = saveEvaluationDetails(hostPlayer.name, roomCode, room.evaluationSetup, room.evaluations, room.players);
            console.log('   - Save result:', saveResult);
        } catch (error) {
            console.error('   - Error saving evaluation details:', error);
        }
    }
    io.to(roomCode).emit('evaluation-results', { results });
    io.to(roomCode).emit('all-evaluations-complete', { roomCode });
}

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
        // 1. Điểm quiz ban đầu (chưa có đánh giá)
        const quizScore = member.originalQuizScore || 0; // Điểm quiz gốc
        
        // 2. Điểm từ host evaluation
        const hostEval = evaluations.host[member.id] || {};
        let hostScore = 0;
        Object.keys(hostEval).forEach(criteriaId => {
            const levelId = hostEval[criteriaId];
            const criteria = evaluationSetup.hostCriteria.find(c => c.id == criteriaId);
            if (criteria) {
                hostScore += (criteria.maxScore / 4) * levelId; // Công thức: (maxScore/4) × id
            }
        });
        
        // 3. Điểm từ peers (các nhóm đánh giá nhau)
        let peerScores = [];
        let peerDetails = [];
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
                const evaluatorName = evaluator ? evaluator.name : evaluatorId;
                peerDetails.push({ name: evaluatorName, score: peerScore });
            }
        });
        
        const avgPeerScore = peerScores.length > 0 
            ? peerScores.reduce((a, b) => a + b, 0) / peerScores.length 
            : 0;
        
        // 4. Điểm từ teachers (trung bình của các thầy cô)
        let teacherScores = [];
        let teacherDetails = [];
        Object.keys(evaluations.teachers || {}).forEach(teacherId => {
            const teacherEval = evaluations.teachers[teacherId];
            const teacherRating = teacherEval[member.id];
            if (teacherRating) {
                let teacherScore = 0;
                Object.keys(teacherRating).forEach(criteriaId => {
                    const levelId = teacherRating[criteriaId];
                    const criteria = evaluationSetup.memberCriteria.find(c => c.id == criteriaId);
                    if (criteria) {
                        teacherScore += (criteria.maxScore / 4) * levelId; // Công thức: (maxScore/4) × id
                    }
                });
                teacherScores.push(teacherScore);
                const teacherName = (players.find(p => p.id === teacherId)?.name) || teacherId;
                teacherDetails.push({ name: teacherName, score: teacherScore });
            }
        });
        
        const avgTeacherScore = teacherScores.length > 0 
            ? teacherScores.reduce((a, b) => a + b, 0) / teacherScores.length 
            : 0;
        
        // 5. Tổng điểm cuối cùng = Quiz + Host + Peer + Teacher
        const finalTotalScore = quizScore + hostScore + avgPeerScore + avgTeacherScore;
        
        results[member.id] = {
            name: member.name,
            quizScore: quizScore, // Điểm quiz gốc
            hostScore: hostScore, // Điểm đánh giá chủ phòng
            peerScore: avgPeerScore, // Điểm trung bình từ các nhóm
            teacherScore: avgTeacherScore, // Điểm trung bình từ thầy cô
            totalScore: finalTotalScore, // Tổng điểm cuối cùng
            details: {
                hostEvaluation: hostEval,
                peerEvaluations: peerScores,
                teacherEvaluations: teacherScores,
                peerEvaluationsDetails: peerDetails,
                teacherEvaluationsDetails: teacherDetails
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

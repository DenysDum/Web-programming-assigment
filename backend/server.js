require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin'); // Підключаємо Firebase Admin

let serviceAccount;

// Перевіряємо, чи є ключ у змінних оточеннях (це для Render)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
    // Якщо немає, значить ми запускаємо локально - читаємо з файлу
    serviceAccount = require('./firebase-service-account.json');
}

// Ініціалізуємо Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Наш доступ до бази даних

const app = express();

// Дозволяємо фронтенду робити запити до бекенду
app.use(cors());
// Дозволяємо серверу розуміти JSON формат у запитах
app.use(express.json());

app.use((req, res, next) => {
    // Отримуємо поточний час і форматуємо його
    const currentTime = new Date().toLocaleString('uk-UA');
    
    // Виводимо в консоль метод (POST, GET тощо), URL та час
    console.log(`[${currentTime}] 📥 Отримано ${req.method}-запит на шлях: ${req.url}`);
    
    // Дуже важливо! Передаємо керування далі до маршрутів
    next(); 
});

// Ініціалізація Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

// Головний маршрут для генерації чату (з вбудованим збереженням)
app.post('/api/chat', async (req, res) => {
    console.log("--> New prompt received:", req.body.prompt);
    // Тепер ми приймаємо ще й userId та chatId з фронтенду
    const { prompt, history, userId, chatId } = req.body;

    if (!prompt || !userId) {
        return res.status(400).json({ error: "Prompt and userId are required" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let currentChatId = chatId;

    try {
        // --- 1. ЗБЕРІГАЄМО ПРОМПТ КОРИСТУВАЧА В БАЗУ ДО ГЕНЕРАЦІЇ ---
        if (!currentChatId) {
            // Створюємо новий чат
            const newChat = {
                userId,
                title: prompt.substring(0, 30) + (prompt.length > 30 ? "..." : ""),
                messages: [{ sender: 'user', text: prompt }],
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };
            const docRef = await db.collection('chats').add(newChat);
            currentChatId = docRef.id;
        } else {
            // Додаємо в існуючий
            await db.collection('chats').doc(currentChatId).update({
                messages: admin.firestore.FieldValue.arrayUnion({ sender: 'user', text: prompt })
            });
        }

        // --- 2. ПОВІДОМЛЯЄМО ФРОНТЕНДУ ID ЧАТУ ---
        // Відправляємо спеціальний сигнал на фронт, щоб він знав, у який чат ми зараз пишемо
        res.write(`data: ${JSON.stringify({ chatId: currentChatId })}\n\n`);

        // --- 3. ЗАПУСКАЄМО ШІ ---
        const chat = model.startChat({ history: history || [] });
        const result = await chat.sendMessageStream(prompt);

        let fullAiResponse = "";
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullAiResponse += chunkText; // Збираємо відповідь на сервері
            res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        }

        // --- 4. ЗБЕРІГАЄМО ВІДПОВІДЬ ШІ В БАЗУ ---
        // Навіть якщо користувач закрив вкладку під час циклу вище, цей код виконається!
        if (fullAiResponse) {
            await db.collection('chats').doc(currentChatId).update({
                messages: admin.firestore.FieldValue.arrayUnion({ sender: 'ai', text: fullAiResponse })
            });
        }

        res.write('data: [DONE]\n\n');
        res.end();

    } catch (error) {
        console.error("AI generation error:", error);
        let errorMessage = error.message || "Unknown error occured.";
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

// ==========================================
// МАРШРУТИ ДЛЯ РОБОТИ З БАЗОЮ ДАНИХ FIREBASE
// ==========================================

// 1. READ: Отримати лише СПИСОК чатів (без повідомлень) для бокового меню
app.get('/api/chats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const snapshot = await db.collection('chats')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        const chats = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Повертаємо тільки ID і назву, ігноруючи масив messages!
            chats.push({ id: doc.id, title: data.title }); 
        });

        res.json(chats);
    } catch (error) {
        console.error("Error fetching chats:", error);
        res.status(500).json({ error: "Failed to fetch chats" });
    }
});

// 1.5. READ: Отримати повідомлення КОНКРЕТНОГО чату (коли на нього клікнули)
app.get('/api/chats/single/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const doc = await db.collection('chats').doc(chatId).get();
        
        if (!doc.exists) {
            return res.status(404).json({ error: "Chat not found" });
        }
        
        res.json(doc.data().messages || []);
    } catch (error) {
        console.error("Error fetching single chat:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

// 2. CREATE: Створити новий чат (після першого повідомлення)
app.post('/api/chats', async (req, res) => {
        console.log("--> New CREATE:", req.body.userId);
    try {
        const { userId, title, messages } = req.body;
        
        const newChat = {
            userId,
            title,
            messages,
            createdAt: admin.firestore.FieldValue.serverTimestamp() // Серверний час
        };

        const docRef = await db.collection('chats').add(newChat);
        res.json({ id: docRef.id, message: "Chat created successfully" });
        console.log("CREATE: successful");
    } catch (error) {
        console.error("Error creating chat:", error);
        res.status(500).json({ error: "Failed to create chat" });
    }
});

// 3. UPDATE: Додати нові повідомлення в існуючий чат
app.put('/api/chats/:id', async (req, res) => {
        console.log("--> New UPDATE chat:", req.params);
    try {
        const { id } = req.params;
        const { newMessages } = req.body; // Масив з двох повідомлень (user та ai)

        const chatRef = db.collection('chats').doc(id);
        await chatRef.update({
            // arrayUnion додає елементи в існуючий масив
            messages: admin.firestore.FieldValue.arrayUnion(...newMessages) 
        });

        res.json({ message: "Chat updated successfully" });
        console.log("UPDATE: successful");
    } catch (error) {
        console.error("Error updating chat:", error);
        res.status(500).json({ error: "Failed to update chat" });
    }
});

// 4. DELETE: Видалити чат
app.delete('/api/chats/:id', async (req, res) => {
    console.log("--> New DELETE:", req.params);
    try {
        const { id } = req.params;
        await db.collection('chats').doc(id).delete();
        res.json({ message: "Chat deleted successfully" });
        console.log("DELETE: successful");
    } catch (error) {
        console.error("Error deleting chat:", error);
        res.status(500).json({ error: "Failed to delete chat" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
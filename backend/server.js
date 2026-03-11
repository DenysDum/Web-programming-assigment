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

// Головний маршрут для генерації чату
app.post('/api/chat', async (req, res) => {
    console.log("--> New prompt received:", req.body.prompt);
    const { prompt, history } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const chat = model.startChat({
            history: history || []
        });

        const result = await chat.sendMessageStream(prompt);

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            const data = JSON.stringify({ text: chunkText });
            res.write(`data: ${data}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();

    } catch (error) {
        console.error("AI generation error:", error);
        
        let errorMessage = "Unknown error occured.";
        
        if (error.status === 503) {
            errorMessage = "AI Model isn't available now. Please try again later.";
        } else if (error.status === 429) {
            errorMessage = "Prompt limit is exceeded. Please try again in few minutes";
        } else if (error.message) {
            errorMessage = error.message; 
        }

        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

// ==========================================
// МАРШРУТИ ДЛЯ РОБОТИ З БАЗОЮ ДАНИХ FIREBASE
// ==========================================

// 1. READ: Отримати всі чати конкретного користувача (для бокового меню)
app.get('/api/chats/:userId', async (req, res) => {
        console.log("--> New READ chats:", req.params);
    try {
        const { userId } = req.params;
        const chatsRef = db.collection('chats');
        // Шукаємо чати користувача і сортуємо від найновіших до найстаріших
        const snapshot = await chatsRef.where('userId', '==', userId).orderBy('createdAt', 'desc').get();

        const chats = [];
        snapshot.forEach(doc => {
            chats.push({ id: doc.id, ...doc.data() });
        });

        res.json(chats);
        console.log("READ: successful");
    } catch (error) {
        console.error("Error fetching chats:", error);
        res.status(500).json({ error: "Failed to fetch chats" });
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
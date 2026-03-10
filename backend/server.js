require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Дозволяємо фронтенду робити запити до бекенду
app.use(cors());
// Дозволяємо серверу розуміти JSON формат у запитах
app.use(express.json());

// Ініціалізація Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

// Головний маршрут для чату
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
        // Створюємо об'єкт чату і передаємо йому попередню історію (якщо вона є)
        const chat = model.startChat({
            history: history || []
        });

        // Використовуємо sendMessageStream замість generateContentStream
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
        
        // Формуємо зрозуміле повідомлення про помилку
        let errorMessage = "Unknown error occured.";
        
        // Перевіряємо специфічні помилки від Google API
        if (error.status === 503) {
            errorMessage = "AI Model isn't available now. Please try again later.";
        } else if (error.status === 429) {
            errorMessage = "Prompt limit is exceeded. Please try again in few minutes";
        } else if (error.message) {
            // Якщо є текстовий опис від самого API, передаємо його
            errorMessage = error.message; 
        }

        // Відправляємо помилку на фронтенд у форматі JSON
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        
        // Обов'язково відправляємо сигнал завершення, щоб фронтенд розблокував кнопку
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
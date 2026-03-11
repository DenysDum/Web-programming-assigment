// Імпортуємо функції Firebase прямо з CDN (бо ми не використовуємо збирачі типу Webpack)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCcuo5rBjhtQ4DBCeDclAHO8SKHtd98Mu4",
  authDomain: "ai-chat-university.firebaseapp.com",
  projectId: "ai-chat-university",
  storageBucket: "ai-chat-university.firebasestorage.app",
  messagingSenderId: "936652123858",
  appId: "1:936652123858:web:5bad9aac07a125f136470b"
};

// Ініціалізація Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Ініціалізуємо провайдера Google
const provider = new GoogleAuthProvider();

const API_BASE_URL = 'https://my-ai-chat-backend-pblt.onrender.com';

let currentUser = null;
let currentChatId = null;

let isGenerating = false;

// Знаходимо елементи авторизації на сторінці
const historyList = document.getElementById('history-list');
const newChatBtn = document.getElementById('new-chat-btn');
const loginBtn = document.getElementById('login-btn');
const userInfo = document.getElementById('user-info');
const userAvatar = document.getElementById('user-avatar');


// Функція входу
loginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Logining Error:", error);
        alert("Logining Error: " + error.message);
    }
});

// Функція виходу (по кліку на аватарку)
userAvatar.addEventListener('click', async () => {
    if (confirm("Are you sure you want to log out?")) {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logouting Error:", error);
        }
    }
});

// СПОСТЕРІГАЧ ЗА СТАНОМ АВТОРИЗАЦІЇ
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Користувач залогінений
        currentUser = user;
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        userAvatar.src = user.photoURL;
        userAvatar.title = `Log out (${user.displayName})`;
        
        // --- НОВИЙ КОД ДЛЯ ПОКРАЩЕННЯ UX ---
        // 1. Скидаємо ID чату, щоб бути готовими до нової розмови
        currentChatId = null; 
        
        // 2. Змінюємо системне повідомлення на персоналізоване (англійською)
        chatBox.innerHTML = `<div class="message ai-message">Welcome, ${user.displayName}! How can I help you today?</div>`;
        
        // 3. ОДРАЗУ розблоковуємо поле вводу та кнопку
        userInput.disabled = false;
        sendBtn.disabled = false;
        // -----------------------------------
        
        loadUserChats();
    } else {
        // Користувач гість
        currentUser = null;
        currentChatId = null;
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
        userAvatar.src = '';
        
        historyList.innerHTML = '<div class="history-item">Log in to see history</div>';
        chatBox.innerHTML = '<div class="message ai-message">Please log in with Google to start chatting.</div>';
        
        // Блокуємо поля для гостей
        userInput.disabled = true;
        sendBtn.disabled = true;
    }
});

const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const historyItems = document.querySelectorAll('.history-item');

// Функція для створення повідомлення
function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender === 'user' ? 'user-message' : 'ai-message');
    
    if (sender === 'ai' && text) {
        // Якщо це ШІ і текст не порожній - парсимо Markdown
        messageDiv.innerHTML = marked.parse(text);
    } else {
        // Для користувача залишаємо звичайний текст для безпеки (щоб уникнути XSS ін'єкцій)
        messageDiv.textContent = text;
    }
    
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    return messageDiv;
}

async function loadUserChats() {
    if (!currentUser) return;
    
    // Показуємо "Loading..." ТІЛЬКИ якщо бокове меню абсолютно порожнє (при першому вході)
    if (historyList.children.length === 0) {
        historyList.innerHTML = '<div class="history-item">Loading...</div>';
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/chats/${currentUser.uid}`);
        if (!response.ok) throw new Error("Failed to fetch chats");
        
        const chats = await response.json();
        
        // Очищаємо список лише перед самим додаванням нових даних
        historyList.innerHTML = ''; 
        
        if (chats.length === 0) {
            historyList.innerHTML = '<div class="history-item">No chats yet</div>';
            return;
        }

        chats.forEach((chatData) => {
            const chatItem = document.createElement('div');
            chatItem.classList.add('history-item');
            if (chatData.id === currentChatId) chatItem.classList.add('active');
            
            const titleSpan = document.createElement('span');
            titleSpan.classList.add('chat-title');
            titleSpan.textContent = chatData.title;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('delete-chat-btn');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = "Delete chat";
            
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); 
                if (isGenerating) {
                    alert("Please wait for the AI to finish responding.");
                    return;
                }
                
                if (confirm("Are you sure you want to delete this chat?")) {
                    try {
                        await fetch(`${API_BASE_URL}/api/chats/${chatData.id}`, {
                            method: 'DELETE'
                        });
                        
                        if (currentChatId === chatData.id) {
                            currentChatId = null;
                            chatBox.innerHTML = `<div class="message ai-message">Welcome, ${currentUser.displayName}! How can I help you today?</div>`;
                        }
                        // Тут ми залишаємо виклик, бо список реально змінився (елемент видалено)
                        loadUserChats();
                    } catch (error) {
                        console.error("Error deleting chat:", error);
                        alert("Could not delete chat. Try again.");
                    }
                }
            });
            
            chatItem.appendChild(titleSpan);
            chatItem.appendChild(deleteBtn);
            
            // --- ОНОВЛЕНИЙ ОБРОБНИК КЛІКУ ПО ЧАТУ ---
            chatItem.addEventListener('click', async () => {
                if (isGenerating) {
                    alert("Please wait for the AI to finish responding.");
                    return;
                }
                
                // Якщо користувач клікнув на той самий чат, що вже відкритий - нічого не робимо
                if (currentChatId === chatData.id) return;
                
                currentChatId = chatData.id;
                
                // 1. ВІЗУАЛЬНЕ ПЕРЕМИКАННЯ АКТИВНОГО КЛАСУ БЕЗ ПЕРЕЗАВАНТАЖЕННЯ СПИСКУ
                document.querySelectorAll('.history-item').forEach(item => {
                    item.classList.remove('active');
                });
                chatItem.classList.add('active');
                
                // 2. Використовуємо красиву анімацію очікування замість тексту
                chatBox.innerHTML = `
                    <div class="message ai-message">
                        <div class="typing-indicator"><span></span><span></span><span></span></div>
                    </div>`;
                
                try {
                    const res = await fetch(`${API_BASE_URL}/api/chats/single/${chatData.id}`);
                    const messages = await res.json();
                    loadChatMessages(messages);
                } catch (error) {
                    chatBox.innerHTML = '<div class="message ai-message">Failed to load messages.</div>';
                }
                
                // Ми ВИДАЛИЛИ звідси loadUserChats() ! Мерехтіння більше не буде.
            });
            
            historyList.appendChild(chatItem);
        });
    } catch (error) {
        console.error("History loading error:", error);
        historyList.innerHTML = `<div class="history-item" style="color: red; font-size: 12px;">Loading error.</div>`;
    }
}


// Функція для відображення повідомлень вибраного чату
function loadChatMessages(messages) {
    chatBox.innerHTML = '';
    messages.forEach(msg => {
        addMessage(msg.text, msg.sender);
    });
    userInput.disabled = false;
    sendBtn.disabled = false;
}

// Обробка кнопки "Новий чат"
newChatBtn.addEventListener('click', () => {
    if (!currentUser || isGenerating) {
        if (isGenerating) alert("Please wait for the AI to finish responding.");
        return;
    }
    
    currentChatId = null;
    chatBox.innerHTML = `<div class="message ai-message">Welcome, ${currentUser.displayName}! How can I help you today?</div>`;
    loadUserChats();
});

// Обробка відправки повідомлення
async function handleSend() {
    // Якщо генерація вже йде, блокуємо нові запити
    if (isGenerating) return;

    const text = userInput.value.trim();
    if (text === '') return;

    isGenerating = true;

    addMessage(text, 'user');
    userInput.value = '';
    const aiMessageDiv = addMessage('', 'ai');

    // Анімація очікування
    aiMessageDiv.innerHTML = `
        <div class="typing-indicator">
            <span></span><span></span><span></span>
        </div>
    `;
    
    userInput.value = '';
    userInput.disabled = true;
    
    userInput.disabled = true;
    sendBtn.disabled = true;

    let reader;
    let fullAiResponse = ""; // Змінна для накопичення повної відповіді ШІ

    // ЗБИРАЄМО ІСТОРІЮ ДЛЯ КОНТЕКСТУ
    const historyForGemini = [];
    const messageNodes = chatBox.querySelectorAll('.message');
    
    for (let i = 0; i < messageNodes.length; i++) {
        const isUser = messageNodes[i].classList.contains('user-message');
        
        if (historyForGemini.length === 0 && !isUser) {
            continue; 
        }
        historyForGemini.push({
            role: isUser ? "user" : "model",
            parts: [{ text: messageNodes[i].textContent }]
        });
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt: text, 
                history: historyForGemini, 
                userId: currentUser.uid,
                chatId: currentChatId
            })
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break; 

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '').trim();
                    
                    // Спочатку перевіряємо сигнал завершення
                    if (dataStr === '[DONE]') {
                        return; // Просто виходимо, сервер сам все зберіг!
                    }
                    
                    // Потім обробляємо дані
                    try {
                        const parsedData = JSON.parse(dataStr);
                        
                        // Якщо сервер надіслав ID нового чату - зберігаємо його
                        if (parsedData.chatId) {
                            if (!currentChatId) {
                                currentChatId = parsedData.chatId;
                                loadUserChats();
                            }
                        } 
                        // Якщо сервер надіслав текст - малюємо його ОДИН раз
                        else if (parsedData.text) {
                            fullAiResponse += parsedData.text; 
                            aiMessageDiv.innerHTML = marked.parse(fullAiResponse); 
                            chatBox.scrollTop = chatBox.scrollHeight;
                        } 
                        // Якщо помилка
                        else if (parsedData.error) {
                            aiMessageDiv.innerHTML += `<br><span style="color: #d32f2f; font-weight: bold;">Error: ${parsedData.error}</span>`;
                            chatBox.scrollTop = chatBox.scrollHeight;
                        }
                    } catch (e) {
                        // Ігноруємо биті шматки JSON
                    }
                }
            }
        }
    } catch (error) {
        console.error('Connection error:', error);
        aiMessageDiv.textContent = 'Sorry, there was a connection error with the server.';
    } finally {
        if (reader) {
            reader.cancel().catch(err => console.error("Failed to close stream:", err));
        }
        userInput.disabled = false;
        sendBtn.disabled = false;
        userInput.focus();

        isGenerating = false;
    }
}

// Слухачі подій для вводу
sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') handleSend();
});
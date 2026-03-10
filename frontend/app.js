// Імпортуємо функції Firebase прямо з CDN (бо ми не використовуємо збирачі типу Webpack)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, doc, updateDoc, arrayUnion, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const db = getFirestore(app);

let currentUser = null;
let currentChatId = null;
const historyList = document.getElementById('history-list');
const newChatBtn = document.getElementById('new-chat-btn');

// Ініціалізуємо провайдера Google
const provider = new GoogleAuthProvider();

// Знаходимо елементи авторизації на сторінці
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
    historyList.innerHTML = '<div class="history-item">Loading...</div>';
    
    try {
        const q = query(
            collection(db, "chats"), 
            where("userId", "==", currentUser.uid),
            orderBy("createdAt", "desc")
        );
        
        const querySnapshot = await getDocs(q);
        historyList.innerHTML = ''; 
        
        if (querySnapshot.empty) {
            historyList.innerHTML = '<div class="history-item">No chats yet</div>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const chatData = docSnap.data();
            const chatItem = document.createElement('div');
            chatItem.classList.add('history-item');
            if (docSnap.id === currentChatId) chatItem.classList.add('active');
            
            // Створюємо контейнер для назви чату
            const titleSpan = document.createElement('span');
            titleSpan.classList.add('chat-title');
            titleSpan.textContent = chatData.title;
            
            // Створюємо кнопку видалення
            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('delete-chat-btn');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = "Delete chat";
            
            // Обробка кліку по кнопці видалення
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Щоб клік по кошику не відкривав чат
                
                if (confirm("Are you sure you want to delete this chat?")) {
                    try {
                        // Видаляємо документ з бази Firebase
                        await deleteDoc(doc(db, "chats", docSnap.id));
                        
                        // Якщо ми видалили той чат, який зараз відкритий, очищаємо екран
                        if (currentChatId === docSnap.id) {
                            currentChatId = null;
                            chatBox.innerHTML = '<div class="message ai-message">Start a new conversation!</div>';
                        }
                        
                        // Оновлюємо бокове меню
                        loadUserChats();
                    } catch (error) {
                        console.error("Error deleting chat:", error);
                        alert("Could not delete chat. Try again.");
                    }
                }
            });
            
            // Додаємо елементи в chatItem
            chatItem.appendChild(titleSpan);
            chatItem.appendChild(deleteBtn);
            
            // Обробка кліку по самому чату (для його відкриття)
            chatItem.addEventListener('click', () => {
                currentChatId = docSnap.id;
                loadChatMessages(chatData.messages);
                loadUserChats(); 
            });
            
            historyList.appendChild(chatItem);
        });
    } catch (error) {
        console.error("History loading error:", error);
        historyList.innerHTML = `<div class="history-item" style="color: red; font-size: 12px;">
            Loading error. Check console.
        </div>`;
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
    if (!currentUser) return;
    currentChatId = null;
    chatBox.innerHTML = '<div class="message ai-message">Start a new conversation!</div>';
});

// Обробка відправки повідомлення
async function handleSend() {
    const text = userInput.value.trim();
    if (text === '') return;

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

    // ЗБЕРЕЖЕННЯ ПОВІДОМЛЕННЯ КОРИСТУВАЧА В БАЗУ
    if (currentUser) {
        try {
            if (!currentChatId) {
                // Створюємо новий чат
                const newChatRef = await addDoc(collection(db, "chats"), {
                    userId: currentUser.uid,
                    title: text.substring(0, 30) + (text.length > 30 ? "..." : ""),
                    messages: [{ sender: 'user', text: text }],
                    createdAt: serverTimestamp()
                });
                currentChatId = newChatRef.id;
                loadUserChats(); // Оновлюємо бокове меню, щоб новий чат з'явився там
            } else {
                // Додаємо повідомлення до існуючого чату
                const chatRef = doc(db, "chats", currentChatId);
                await updateDoc(chatRef, {
                    messages: arrayUnion({ sender: 'user', text: text })
                });
            }
        } catch (error) {
            console.error("Error saving user message to Firebase:", error);
        }
    }

    let reader;
    let fullAiResponse = ""; // Змінна для накопичення повної відповіді ШІ

    // ЗБИРАЄМО ІСТОРІЮ ДЛЯ КОНТЕКСТУ
    // 1. ЗБИРАЄМО ІСТОРІЮ ДЛЯ КОНТЕКСТУ
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
        const response = await fetch('https://my-ai-chat-backend-pblt.onrender.com/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: text, history: historyForGemini })
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
                    
                    if (dataStr === '[DONE]') {
                        // КОЛИ ГЕНЕРАЦІЯ ЗАВЕРШЕНА - ЗБЕРІГАЄМО ВІДПОВІДЬ ШІ В БАЗУ
                        if (currentUser && currentChatId && fullAiResponse) {
                            try {
                                const chatRef = doc(db, "chats", currentChatId);
                                await updateDoc(chatRef, {
                                    messages: arrayUnion({ sender: 'ai', text: fullAiResponse })
                                });
                            } catch (error) {
                                console.error("Error saving AI message to Firebase:", error);
                            }
                        }
                        return; 
                    }
                    
                    try {
                        const parsedData = JSON.parse(dataStr);
                        if (parsedData.text) {
                            // 1. Додаємо новий шматок до повної відповіді
                            fullAiResponse += parsedData.text; 
                            
                            // 2. Парсимо ВЕСЬ накопичений текст і вставляємо як HTML
                            aiMessageDiv.innerHTML = marked.parse(fullAiResponse); 
                            
                            chatBox.scrollTop = chatBox.scrollHeight;
                        } else if (parsedData.error) {
                            aiMessageDiv.innerHTML += `<br><span style="color: #d32f2f; font-weight: bold;">Error: ${parsedData.error}</span>`;
                            chatBox.scrollTop = chatBox.scrollHeight;
                        }
                    } catch (e) {
                        // Ігноруємо помилки парсингу
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
    }
}

// Слухачі подій для вводу
sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') handleSend();
});

// Логіка для підсвічування активного чату в боковій панелі
historyItems.forEach(item => {
    item.addEventListener('click', () => {
        historyItems.forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        chatBox.innerHTML = `
            <div class="message ai-message">
                You opened history: "${item.textContent}". How can I help further?
            </div>
        `;
    });
});
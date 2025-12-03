function startSocket(token) {
    const socket = io({
        auth: { token }
    });

    const clienttotal = document.getElementById("clients-total");
    const messageContainer = document.getElementById("message-container");
    const messageform = document.getElementById("message-form");
    const messageinput = document.getElementById("message-input");

    let currentUserName = "User"; // fallback

    socket.on("connect_error", (err) => {
        alert("Access Denied: " + err.message);
    });

    socket.on("user-data", (user) => {
        const userInfo = document.getElementById("user-info");
        userInfo.innerText = `Logged in as: ${user.name} (${user.role})`;
        currentUserName = user.name; // Save real name
    });

    messageform.addEventListener("submit", (e) => {
        e.preventDefault();
        sendmessage();
    });

    function sendmessage() {
        if (messageinput.value.trim() === "") return;

        const data = {
            name: currentUserName,
            message: messageinput.value.trim(),
            dateTime: new Date()
        };

        socket.emit("message", data);
        addmessagetoui(true, data);
        messageinput.value = "";
    }

    socket.on("chat-message", (data) => {
        addmessagetoui(false, data);
    });

    function addmessagetoui(isOwn, data) {
        clearfeedback();

        const item = document.createElement('li');
        item.className = isOwn ? "message-right" : "message-left";

        item.innerHTML = `
            <div class="message-bubble">
                ${data.message}
                <span class="message-meta">${data.name} — ${moment(data.dateTime).fromNow()}</span>
            </div>
        `;

        messageContainer.appendChild(item);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }

    // === TYPING INDICATOR (FIXED!) ===
    let typingTimer;

    const sendTyping = () => {
        socket.emit("feedback", { feedback: `${currentUserName} is typing...` });
    };

    const stopTyping = () => {
        socket.emit("feedback", { feedback: "" });
    };

    messageinput.addEventListener("keypress", () => {
        clearTimeout(typingTimer);
        sendTyping();
    });

    messageinput.addEventListener("keyup", (e) => {
        clearTimeout(typingTimer);
        if (e.key !== "Enter") {
            typingTimer = setTimeout(stopTyping, 1000);
        }
    });

    messageinput.addEventListener("blur", stopTyping);

    socket.on("feedback", (data) => {
        clearfeedback();
        if (data.feedback) {
            const el = document.createElement("div");
            el.className = "message-feedback";
            el.textContent = data.feedback;
            document.getElementById("feedback-container").appendChild(el);
        }
    });

    function clearfeedback() {
        document.getElementById("feedback-container").innerHTML = "";
    }

    socket.on("clients-total", (count) => {
        clienttotal.innerText = `Client: ${count}`;
    });
}

// Token handling (unchanged)
window.addEventListener("token-received", () => {
    startSocket(window.IFRAME_TOKEN);
});

const urlParams = new URLSearchParams(window.location.search);
const directToken = urlParams.get("token");
if (directToken) {
    startSocket(directToken);
}
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get("token");

if (!token) {
    alert("Missing token in URL");
    throw new Error("Token missing");
}

const socket = io({
    auth: {
        token: token
    }
});

socket.on("connect", () => {});

socket.on("connect_error", (err) => {
    alert("Access Denied: " + err.message);
});

socket.on("user-data", (user) => {
    const userInfo = document.getElementById("user-info");
    userInfo.innerText = `Logged in as: ${user.name} (${user.role})`;
    nameinput.value = user.name;
});

const clienttotal = document.getElementById("clients-total");
const messageContainer = document.getElementById("message-container");
const nameinput = document.getElementById("name-input");
const messageform = document.getElementById("message-form");
const messageinput = document.getElementById("message-input");

messageform.addEventListener("submit", (e) => {
    e.preventDefault();
    sendmessage();
});

function sendmessage() {
    if (messageinput.value.trim() === "") {
        return;
    }

    const data = {
        name: nameinput.value,
        message: messageinput.value,
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

    const html = `
        <li class="${isOwn ? "message-right" : "message-left"}">
            <p class="message">
                ${data.message}
                <span>${data.name} — ${moment(data.dateTime).fromNow()}</span>
            </p>
        </li>
    `;

    messageContainer.insertAdjacentHTML("beforeend", html);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

messageinput.addEventListener("focus", () => {
    socket.emit("feedback", { feedback: `${nameinput.value} is typing...` });
});

messageinput.addEventListener("keypress", () => {
    socket.emit("feedback", { feedback: `${nameinput.value} is typing...` });
});

messageinput.addEventListener("blur", () => {
    socket.emit("feedback", { feedback: "" });
});

socket.on("feedback", (data) => {
    clearfeedback();

    if (!data.feedback) return;

    const html = `
        <li class="message-feedback">
            <p class="feedback">${data.feedback}</p>
        </li>
    `;

    messageContainer.insertAdjacentHTML("beforeend", html);
});

function clearfeedback() {
    document.querySelectorAll("li.message-feedback").forEach(el => el.remove());
}

socket.on("clients-total", (count) => {
    clienttotal.innerText = `Total clients: ${count}`;
});

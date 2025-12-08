function startSocket(token) {
  console.log("🔵 [SOCKET] Starting socket with token:", token);

  const socket = io({ auth: { token } });
  console.log("🟦 [SOCKET] io() initialized");

  const clienttotal = document.getElementById("clients-total");
  const messageContainer = document.getElementById("message-container");
  const messageform = document.getElementById("message-form");
  const messageinput = document.getElementById("message-input");

  let currentUserName = "User";
  console.log("👤 Current username (default):", currentUserName);

  // Pagination state
  let oldestTime = null;
  let loadingOld = false;

  // ----------------------------
  // LOAD INITIAL MESSAGES
  // ----------------------------
  async function loadInitialMessages() {
    console.log("📥 [LOAD] Loading initial messages...");
    try {
      console.log("➡️ [FETCH] GET /messages");
      const res = await fetch(
        `/messages?groupId=${window.GROUP_ID}&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) {
        console.error("❌ Failed to fetch messages:", res.status, await res.text());
        return;
      }

      const data = await res.json();
      console.log("📦 [LOAD] Initial messages received:", data.length);

      data.forEach((msg) => {
        const isOwn = msg.sender === currentUserName;
        addmessagetoui(isOwn, msg, false);
      });

      if (data.length > 0) {
        oldestTime = data[0].timestamp;
        console.log("⏳ Oldest message timestamp:", oldestTime);
      }

      messageContainer.scrollTop = messageContainer.scrollHeight;
      console.log("📜 UI scrolled to bottom");

    } catch (err) {
      console.error("❌ Error loading initial messages:", err);
    }
  }

  loadInitialMessages();

  // ----------------------------
  // INFINITE SCROLL TOP
  // ----------------------------
  messageContainer.addEventListener("scroll", async () => {
    if (messageContainer.scrollTop === 0 && !loadingOld && oldestTime) {
      console.log("⬆️ [SCROLL] User reached top → loading older messages...");
      loadingOld = true;

      const prevHeight = messageContainer.scrollHeight;

      console.log("➡️ [FETCH] GET older messages before:", oldestTime);
      const res = await fetch(
        `/messages?groupId=${window.GROUP_ID}&limit=20&before=${oldestTime}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const older = await res.json();
      console.log("📦 [SCROLL] Older messages received:", older.length);

      if (older.length > 0) {
        oldestTime = older[0].timestamp;
        console.log("⏳ Updated oldest timestamp:", oldestTime);

        older.forEach((msg) => {
          const isOwn = msg.sender === currentUserName;
          addmessagetoui(isOwn, msg, false, true);
        });

        messageContainer.scrollTop =
          messageContainer.scrollHeight - prevHeight;
      }

      loadingOld = false;
    }
  });

  // ----------------------------
  // SOCKET EVENTS
  // ----------------------------
  socket.on("connect_error", (err) => {
    console.log("❌ [SOCKET ERROR]", err.message);
    alert("Access Denied: " + err.message);
  });

  socket.on("user-data", (user) => {
    console.log("👤 [SOCKET] Received user data:", user);

    document.getElementById("user-info").innerText =
      `Logged in as: ${user.name} (${user.role})`;

    currentUserName = user.name;
    console.log("👤 Updated currentUserName →", currentUserName);
  });

  messageform.addEventListener("submit", (e) => {
    e.preventDefault();
    sendmessage();
  });

  function sendmessage() {
    if (!messageinput.value.trim()) {
      console.log("⚠️ [SEND] Empty message — ignored");
      return;
    }

    const msg = {
      name: currentUserName,
      message: messageinput.value.trim(),
      dateTime: new Date(),
      groupId: window.GROUP_ID
    };

    console.log("📤 [SEND] Emitting message:", msg);

    socket.emit("message", msg);
    addmessagetoui(true, msg);

    messageinput.value = "";
  }

  socket.on("chat-message", (data) => {
    console.log("📩 [RECEIVE] New message received:", data);
    const isOwn = data.sender === currentUserName;
    addmessagetoui(isOwn, data, true);
  });

  // ----------------------------
  // ADD MESSAGE TO UI
  // ----------------------------
  function addmessagetoui(isOwn, data, scrollDown = true, prepend = false) {
    console.log(
      `📝 [UI] Adding message — isOwn:${isOwn}, prepend:${prepend}`,
      data
    );

    clearfeedback();

    const item = document.createElement("li");
    item.className = isOwn ? "message-right" : "message-left";

    item.innerHTML = `
      <div class="message-bubble">
          ${data.message}
          <span class="message-meta">
            ${(data.sender || data.name)} —
            ${moment(data.timestamp || data.dateTime).fromNow()}
          </span>
      </div>
    `;

    if (prepend) {
      messageContainer.prepend(item);
    } else {
      messageContainer.appendChild(item);
    }

    if (scrollDown) {
      messageContainer.scrollTop = messageContainer.scrollHeight;
    }
  }

  // ----------------------------
  // TYPING INDICATOR
  // ----------------------------
  let typingTimer;

  const sendTyping = () => {
    console.log("⌨️ [TYPING] User typing…");
    socket.emit("feedback", { feedback: `${currentUserName} is typing...` });
  };

  const stopTyping = () => {
    console.log("⌨️ [TYPING] User stopped typing");
    socket.emit("feedback", { feedback: "" });
  };

  messageinput.addEventListener("keypress", () => {
    clearTimeout(typingTimer);
    sendTyping();
  });

  messageinput.addEventListener("keyup", (e) => {
    clearTimeout(typingTimer);
    if (e.key !== "Enter") typingTimer = setTimeout(stopTyping, 1000);
  });

  socket.on("feedback", (data) => {
    console.log("💬 [FEEDBACK] Typing update:", data);

    clearfeedback();
    if (data.feedback) {
      const el = document.createElement("div");
      el.className = "message-feedback";
      el.innerText = data.feedback;
      document.getElementById("feedback-container").appendChild(el);
    }
  });

  function clearfeedback() {
    document.getElementById("feedback-container").innerHTML = "";
  }

  socket.on("clients-total", (count) => {
    console.log("👥 [ONLINE USERS] Count updated:", count);
    clienttotal.innerText = `Client: ${count}`;
  });
}

// Token logic
window.addEventListener("token-received", () => {
  console.log("🔑 [TOKEN EVENT] Token received from parent iframe");
  startSocket(window.IFRAME_TOKEN);
});

const urlParams = new URLSearchParams(window.location.search);
const directToken = urlParams.get("token");

if (directToken) {
  console.log("🔑 [URL TOKEN] Token found in URL");
  startSocket(directToken);
}

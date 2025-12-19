// public/main.js  ←  FULL FILE WITH ONLY group-online-count ADDED

function createInitialsImageDataURL(
  name,
  size = 128,
  textColor = "#ffffff",
  bgColor = "#268cdf"
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = size;
  canvas.height = size;

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  // Initials
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join("");

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${size / 2}px Arial`;

  ctx.fillText(initials, size / 2, size / 2);

  return canvas.toDataURL("image/png");
}

function startSocket(token, groupId) {

  const socket = io({
    path: "/dlnv-chat/support/ws", 
    auth: {
      token: token,        // Required by your backend JWT decode
      groupId: groupId     // REQUIRED – your backend checks this!
    }
  });

  // Select UI elements
  const clienttotal = document.getElementById("clients-total");
  const messageContainer = document.getElementById("message-container");
  const messageform = document.getElementById("message-form");
  const messageinput = document.getElementById("message-input");

  let currentUserName = "User";

  // Pagination state
  let oldestTime = null;
  let loadingOld = false;

  // Load initial messages
  async function loadInitialMessages() {
    try {
      const res = await fetch(
        `/dlnv-chat/support/messages?groupId=${window.GROUP_ID}&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) throw new Error("Failed to load messages");

      const data = await res.json();

      data.forEach((msg) => {
        const isOwn = msg.sender === currentUserName;
        addMessageToUI(isOwn, msg, false);
      });

      if (data.length > 0) oldestTime = data[0].timestamp;

      messageContainer.scrollTop = messageContainer.scrollHeight;
    } catch (err) {
      console.error("Error loading messages:", err);
    }
  }


  loadInitialMessages();

  // Infinite scroll
  messageContainer.addEventListener("scroll", async () => {
    if (messageContainer.scrollTop === 0 && !loadingOld && oldestTime) {
      loadingOld = true;
      const prevHeight = messageContainer.scrollHeight;

      const res = await fetch(
        `/messages?groupId=${window.GROUP_ID}&limit=20&before=${oldestTime}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const older = await res.json();

      if (older.length > 0) {
        oldestTime = older[0].timestamp;
        older.forEach((msg) => {
          const isOwn = msg.sender === currentUserName;
          addMessageToUI(isOwn, msg, false, true);
        });
        messageContainer.scrollTop = messageContainer.scrollHeight - prevHeight;
      }
      loadingOld = false;
    }
  });

  // Socket events
  socket.on("connect", () => {
    // console.log("[SOCKET] Connected!");
  });

// socket.on("group-info-update", (groupInfo) => {
//   window.groupInfo = groupInfo;

//   const clientsTotalEl = document.getElementById("clients-total");

//   const active = groupInfo.activeClients ?? 0;
//   const total = groupInfo.totalClients ?? 0;

//   clientsTotalEl.innerText = `Active Clients: ${active} / ${total}`;


// });

socket.on("group-info-update", (groupInfo) => {
  window.groupInfo = groupInfo;

  // 🔹 SET SCRIPT NAME FROM GROUP INFO
  const scriptNameEl = document.getElementById("script-name");
  if (scriptNameEl) {
    scriptNameEl.innerText =
      groupInfo?.scriptTitle || "Script";
  }

  const clientsTotalEl = document.getElementById("clients-total");

  const active = groupInfo.activeClients ?? 0;
  const total = groupInfo.totalClients ?? 0;

  clientsTotalEl.innerText = `Active Clients: ${active} / ${total}`;
});


  socket.on("connect_error", (err) => {
      document.getElementById("chat-container")?.classList.add("hidden");
    console.error("[SOCKET ERROR]", err.message);
    alert("Chat Access Denied: " + err.message);
  });

socket.on("user-data", (user) => {
  currentUserName = user.name;

  // document.getElementById("user-info").innerText =
  //   `Logged in as ${user.name}`;

  // ✅ HIDE SPINNER, SHOW CHAT
  document.getElementById("chat-loader")?.remove();
  document.getElementById("chat-container")?.classList.remove("hidden");
});


  socket.on("chat-message", (data) => {
    const isOwn = data.sender === currentUserName;
    addMessageToUI(isOwn, data, true);
    // console.log("adding the chat to the page")
   if (!isOwn) {
    // console.log("trying to send the notification")
    // console.log(" window group info: for image", window.groupInfo);
    
        const userid = data.userId;
      const participant = window.groupInfo?.participants?.[userid] || null;
const userimage = participant?.image || null;

    // window.parent.postMessage(
    //   {
    //     type: "NEW_CHAT_MESSAGE",
    //     payload: {
    //       message: data.message,
    //       sender: data.sender,
    //       groupId: data.groupId,
    //       image: userimage
    //     }
    //   },
    //   "*"
    // );
  const groupSettings = getGroupSettings(data.groupId);

const senderRole = participant?.role; // advisor | trader | admin

// let shouldNotify = true;

// if (senderRole === "trader" && !groupSettings.clientNotification) {
//   shouldNotify = false;
// }

// if (senderRole === "advisor" && !groupSettings.advisorNotification) {
//   shouldNotify = false;
// }

// if (shouldNotify) {
//   window.parent.postMessage(
//     {
//       type: "NEW_CHAT_MESSAGE",
//       payload: {
//         message: data.message,
//         sender: data.sender,
//         groupId: data.groupId,
//         image: userimage
//       }
//     },
//     "*"
//   );
// }

  }
  });

  // ——————————————————————————————
  // 🔥 NEW LOGIC: UNIQUE USERS PER GROUP
  // ——————————————————————————————
  // socket.on("group-online-count", (count) => {
  //   clienttotal.innerText = `Clients: ${count}`;
  // });

  // (Your original clients-total is removed because Option A asked for group-based only)

  // Send message
  messageform.addEventListener("submit", (e) => {
    e.preventDefault();
    // console.log("Sending message... clicked");
    sendMessage();
  });

  function sendMessage() {
    
    if (!messageinput.value.trim()) return;

    const msg = {
      message: messageinput.value.trim(),
      groupId: window.GROUP_ID
    };

    socket.emit("message", msg);

    const outgoingMsg = {
      sender: currentUserName,
      message: msg.message,
      timestamp: new Date(),
      groupId: window.GROUP_ID
    };

    addMessageToUI(true, outgoingMsg);
    messageinput.value = "";
  }


  function addMessageToUI(isOwn, data, scrollDown = true, prepend = false) {
  clearFeedback();

  const item = document.createElement("li");
  item.className = isOwn ? "message-right" : "message-left";

  let avatarHTML = "";

  // 👉 SHOW IMAGE ONLY FOR OTHER USERS
  if (!isOwn) {
    const participant = window.groupInfo?.participants?.[data.userId];
    const image = participant?.image;

    avatarHTML = `
      <div class="avatar">
        ${
          image
            ? `<img src="${image}" alt="avatar" />`
            : `<div class="avatar-fallback">${((data.sender).toUpperCase() || "U")[0]}</div>`
        }
      </div>
    `;
  }

  item.innerHTML = `
    ${avatarHTML}
    <div class="message-bubble">
      ${data.message}
      <span class="message-meta">
        ${data.sender} • ${moment(data.timestamp).fromNow()}
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


  // Typing indicator
  let typingTimer;
  const sendTyping = () => socket.emit("feedback", { feedback: `${currentUserName} is typing...` });
  const stopTyping = () => socket.emit("feedback", { feedback: "" });

  messageinput.addEventListener("keypress", () => {
    clearTimeout(typingTimer);
    sendTyping();
  });

  messageinput.addEventListener("keyup", (e) => {
    clearTimeout(typingTimer);
    if (e.key !== "Enter") typingTimer = setTimeout(stopTyping, 1000);
  });

  socket.on("feedback", (data) => {
    clearFeedback();
    if (data.feedback) {
      const el = document.createElement("div");
      el.className = "message-feedback";
      el.innerText = data.feedback;
      document.getElementById("feedback-container").appendChild(el);
    }
  });

  function clearFeedback() {
    document.getElementById("feedback-container").innerHTML = "";
  }
}

// ————————————————————————————————————————
// RECEIVE TOKEN FROM ANGULAR PARENT PAGE
// ————————————————————————————————————————
window.addEventListener("message", (event) => {
  // console.log("[IFRAME] postMessage received:", event.data);

  if (event.data?.type === "SEND_TOKEN") {
    // console.log("TOKEN & GROUPID RECEIVED FROM ANGULAR!");
    // console.log("Token preview:", event.data.token.substring(0, 30) + "...");
    // console.log("Group ID:", event.data.groupId);

    // if(event.data.token==null || ! event.data.groupId){
    //       window.IFRAME_TOKEN =  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE3NjQ1Nzk5NDcsImV4cCI6MTc5NjExNTk0NywiYXVkIjoidGVzdCIsInN1YiI6InRlc3QiLCJHaXZlbk5hbWUiOiJLYXJhbiIsIlN1cm5hbWUiOiIuIiwiRW1haWwiOiJLYXJhbkBleGFtcGxlLmNvbSIsIlJvbGUiOiJBZG1pbiJ9.PAE7HcQguhb4bh2hLH5qQrvaHJpQsbbI8T3P6u6QGyE";  
    //       window.GROUP_ID = "1234";  
    // }

    window.IFRAME_TOKEN = event.data.token;
    window.GROUP_ID = event.data.groupId;

    // Start the chat
    startSocket(window.IFRAME_TOKEN, window.GROUP_ID);
  }
});

function getNotificationSettings() {
  return JSON.parse(localStorage.getItem("chatNotificationSettings")) || {
    notification: {}
  };
}

function saveNotificationSettings(data) {
  localStorage.setItem(
    "chatNotificationSettings",
    JSON.stringify(data)
  );
}

function getGroupSettings(groupId) {
  const settings = getNotificationSettings();
  return (
    settings.notification[groupId] || {
      advisorNotification: true,
      clientNotification: true
    }
  );
}

function updateGroupSettings(groupId, newSettings) {
  const settings = getNotificationSettings();
  settings.notification[groupId] = newSettings;
  saveNotificationSettings(settings);
}
const notifBtn = document.getElementById("notification-btn");
const dropdown = document.getElementById("notification-dropdown");

const muteTraderCheckbox = document.getElementById("mute-trader");
const muteClientCheckbox = document.getElementById("mute-client");

notifBtn.addEventListener("click", () => {
  dropdown.classList.toggle("hidden");

  // Load current group settings
  const groupSettings = getGroupSettings(window.GROUP_ID);

  muteTraderCheckbox.checked = !groupSettings.advisorNotification;
  muteClientCheckbox.checked = !groupSettings.clientNotification;
});

// Save changes
muteTraderCheckbox.addEventListener("change", () => {
  const groupSettings = getGroupSettings(window.GROUP_ID);
  groupSettings.advisorNotification = !muteTraderCheckbox.checked;
  updateGroupSettings(window.GROUP_ID, groupSettings);
});

muteClientCheckbox.addEventListener("change", () => {
  const groupSettings = getGroupSettings(window.GROUP_ID);
  groupSettings.clientNotification = !muteClientCheckbox.checked;
  updateGroupSettings(window.GROUP_ID, groupSettings);
});

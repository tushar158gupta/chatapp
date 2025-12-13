const express = require("express");
const path = require("path");
const app = express();
const mongoose = require("mongoose");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");
const socketio = require("socket.io");

const PORT = process.env.PORT || 8000;

//----------------------------------------------------
// 1) Connect to MongoDB
//----------------------------------------------------
mongoose
  .connect("mongodb+srv://tushar158:tushar158@cluster0.yi9towt.mongodb.net/chatdb")
  .then(() => console.log("Mongo connected"))
  .catch((e) => console.error("Mongo connection error", e));

// Define chat message schema
const chatSchema = new mongoose.Schema({
  sender: String,  // to remove
  message: String,
  senderEmail: String, // to remove
  groupId: String,
  userId: String,
  timestamp: { type: Date, default: Date.now },
});

// Create chat model
const Chat = mongoose.model("Chat", chatSchema);

//----------------------------------------------------
// 2) Connect to Redis
//----------------------------------------------------
const redis = createClient({
  url: "rediss://default:ASmWAAIncDJmZjQzZWVjYzhkZGM0ZDkxYmY0MDljNzJmMjg3YzRhMHAyMTA2NDY@meet-moose-10646.upstash.io:6379",
  socket: { tls: true, rejectUnauthorized: false }
});

redis.connect();

redis.on("ready", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error", err));

//----------------------------------------------------
// 3) Start Express Server
//----------------------------------------------------
const server = app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

//----------------------------------------------------
// 4) Decode JWT Without Secret (manual decode)
//----------------------------------------------------
function decodeJWT(token) {
  const parts = token.split('.');
  const payload = parts[1];
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

//----------------------------------------------------
// 5) Initialize Socket.io
//----------------------------------------------------
const io = socketio(server, {
  path: "/dlnv-chat/support/ws",   // custom path
});
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = "d1nvdb4ndw3b517353cr37";
const ALLOWED_ROLES = ["ADMIN", "ADVISOR", "TRADER", "admin", "advisor", "trader", "Admin", "Advisor", "Trader"];

//----------------------------------------------------
// 6) Socket authentication middleware
//----------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const groupId = socket.handshake.auth.groupId;

  if (!token) return next(new Error("Unauthorized: No token provided"));

  try {
    const decoded = decodeJWT(token);

    if (!ALLOWED_ROLES.includes(decoded?.user?.role || decoded?.user?.rType)) {
      return next(new Error("Unauthorized: Role not allowed"));
    }

    socket.user = {
      name: decoded.user?.profile?.fName || decoded?.user?.fName,
      email: decoded.user?.profile?.email || decoded?.user?.email,
      role: decoded.user?.role || decoded?.user?.role,
      userId: decoded.user?.id
    };

    next();
  } catch (err) {
    return next(new Error("Unauthorized: Invalid token"));
  }
});

//----------------------------------------------------
// 7) Redis batching
//----------------------------------------------------
const BATCH_KEY = "batchMessages";
const BATCH_SIZE = 20;

async function flushBatchToMongo() {
  const batch = await redis.lRange(BATCH_KEY, 0, -1);
  if (batch.length === 0) return;

  const docs = batch.map((m) => JSON.parse(m));
  await Chat.insertMany(docs);
  console.log("Flushed", batch.length, "messages to MongoDB");
  await redis.del(BATCH_KEY);
}

//----------------------------------------------------
// 9) Fetch messages
//----------------------------------------------------
app.get("/dlnv-chat/support/messages", async (req, res) => {
  const groupId = req.query.groupId;
  const limit = parseInt(req.query.limit || 20);
  const before = req.query.before;

  const redisRaw = await redis.lRange(BATCH_KEY, 0, -1);
  const redisMessages = redisRaw
    .map(r => JSON.parse(r))
    .filter(msg => msg.groupId === groupId);

  let mongoFilter = {};
  if (groupId) mongoFilter.groupId = groupId;
  if (before) mongoFilter.timestamp = { $lt: new Date(before) };

  const mongoMessages = await Chat.find(mongoFilter)
    .sort({ timestamp: -1 })
    .limit(limit);

  const all = [...redisMessages, ...mongoMessages]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);

  res.json(all.reverse());
});

//----------------------------------------------------
// 10) UNIQUE ONLINE USER PER GROUP LOGIC
//----------------------------------------------------

// { groupId: Set(userIds) }
const onlineGroupUsers = {};

io.on("connection", async (socket) => {
  const groupId = socket.handshake.auth.groupId;
  const userId = socket.user.userId;

  if (!groupId || !userId) return;

  socket.join(groupId);

  if (!onlineGroupUsers[groupId]) {
    onlineGroupUsers[groupId] = new Set();
  }

  // Add unique user
  onlineGroupUsers[groupId].add(userId);

  // Emit count ONLY to this group
  io.to(groupId).emit("group-online-count", onlineGroupUsers[groupId].size);

  socket.emit("user-data", socket.user);

  // ----- Handle Messages -----
  socket.on("message", async (data) => {
    const messageObj = {
      sender: socket.user.name,
      senderEmail: socket.user.email,
      message: data.message,
      timestamp: new Date(),
      groupId: data.groupId,
      userId: socket.user.userId
    };

    await redis.rPush(BATCH_KEY, JSON.stringify(messageObj));

    const batchLen = await redis.lLen(BATCH_KEY);
    if (batchLen >= BATCH_SIZE) await flushBatchToMongo();

    socket.broadcast.to(data.groupId).emit("chat-message", messageObj);
  });

  // ----- Handle Disconnect -----
  socket.on("disconnect", () => {
    if (onlineGroupUsers[groupId]) {
      onlineGroupUsers[groupId].delete(userId);

      if (onlineGroupUsers[groupId].size === 0) {
        delete onlineGroupUsers[groupId];
      }
    }

    io.to(groupId).emit(
      "group-online-count",
      onlineGroupUsers[groupId]?.size || 0
    );
  });
});

//----------------------------------------------------
// 11) Auto flush
//----------------------------------------------------
setInterval(() => {
  flushBatchToMongo();
}, 10000);

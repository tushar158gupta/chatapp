const express = require("express");
const path = require("path");
const app = express();
const mongoose = require("mongoose");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");
const socketio = require("socket.io");

const PORT = process.env.PORT || 8000;

//----------------------------------------------------
// 1) MONGO CONNECTION
//----------------------------------------------------
console.log("🟦 [MONGO] Connecting...");

mongoose
  .connect("mongodb+srv://tushar158:tushar158@cluster0.yi9towt.mongodb.net/chatdb")
  .then(() => console.log("🟩 [MONGO] Connected"))
  .catch((e) => console.error("❌ [MONGO ERROR]", e));

const chatSchema = new mongoose.Schema({
  sender: String,
  message: String,
  senderEmail: String,
  groupId: String,
  timestamp: { type: Date, default: Date.now },
});
const Chat = mongoose.model("Chat", chatSchema);

//----------------------------------------------------
// 2) REDIS CONNECTION
//----------------------------------------------------
console.log("🟦 [REDIS] Connecting...");

const redis = createClient({
  url: "rediss://default:ASmWAAIncDJmZjQzZWVjYzhkZGM0ZDkxYmY0MDljNzJmMjg3YzRhMHAyMTA2NDY@meet-moose-10646.upstash.io:6379",
  socket: { tls: true, rejectUnauthorized: false }
});
redis.connect();

redis.on("ready", () => console.log("🟩 [REDIS] Ready"));
redis.on("error", (err) => console.error("❌ [REDIS ERROR]", err));

//----------------------------------------------------
// 3) EXPRESS SERVER
//----------------------------------------------------
const server = app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});

//----------------------------------------------------
// 4) JWT DECODE FUNCTION
//----------------------------------------------------
function decodeJWT(token) {
  const parts = token.split('.');
  const payload = parts[1];
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

//----------------------------------------------------
// 5) SOCKET.IO SETUP
//----------------------------------------------------
const io = socketio(server);
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = "d1nvdb4ndw3b517353cr37";
const ALLOWED_ROLES = ["ADMIN", "ADVISOR", "TRADER"];

//----------------------------------------------------
// 6) SOCKET AUTH MIDDLEWARE
//----------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    console.error("❌ [SOCKET] No token provided");
    return next(new Error("Unauthorized: No token"));
  }

  try {
    const decoded = decodeJWT(token);

    if (!ALLOWED_ROLES.includes(decoded.user.role)) {
      console.error("❌ [SOCKET] Role not allowed:", decoded.user.role);
      return next(new Error("Unauthorized: Role not allowed"));
    }

    socket.user = {
      name: decoded.user?.profile?.fName,
      email: decoded.user?.email,
      role: decoded.user?.role,
    };

    next();

  } catch (err) {
    console.error("❌ [SOCKET] Invalid token");
    return next(new Error("Unauthorized: Invalid token"));
  }
});

//----------------------------------------------------
// 7) BATCHING LOGIC
//----------------------------------------------------
const BATCH_KEY = "batchMessages";
const BATCH_SIZE = 20;

async function flushBatchToMongo() {
  const batch = await redis.lRange(BATCH_KEY, 0, -1);
  if (batch.length === 0) return;

  const docs = batch.map((m) => JSON.parse(m));

  await Chat.insertMany(docs);
  console.log(`🟧 [BATCH] Flushed ${batch.length} messages to MongoDB`);

  await redis.del(BATCH_KEY);
}

//----------------------------------------------------
// 8) REST API TOKEN VERIFICATION
//----------------------------------------------------
function verifyRESTToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

//----------------------------------------------------
// 9) GET MESSAGES (WITH REDIS + MONGO MERGE)
//----------------------------------------------------
app.get("/messages", verifyRESTToken, async (req, res) => {
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
// 10) SOCKET EVENT HANDLERS
//----------------------------------------------------
let onlineUsers = 0;

io.on("connection", async (socket) => {
  onlineUsers++;
  io.emit("clients-total", onlineUsers);

  socket.emit("user-data", socket.user);

  socket.on("message", async (data) => {
    const messageObj = {
      sender: socket.user.name,
      message: data.message,
      timestamp: new Date(),
      groupId: data.groupId
    };

    await redis.rPush(BATCH_KEY, JSON.stringify(messageObj));

    const batchLen = await redis.lLen(BATCH_KEY);
    if (batchLen >= BATCH_SIZE) {
      await flushBatchToMongo();
    }

    socket.broadcast.emit("chat-message", messageObj);
  });

  socket.on("disconnect", () => {
    onlineUsers--;
    io.emit("clients-total", onlineUsers);
  });
});

//----------------------------------------------------
// 11) AUTO FLUSH EVERY 10 SEC
//----------------------------------------------------
setInterval(() => {
  flushBatchToMongo();
}, 10000);

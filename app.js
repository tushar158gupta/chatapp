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
  sender: String,
  message: String,
  senderEmail: String,
  groupId: String,
  userId:String,
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

// Redis status logs
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
// 5) Initialize Socket.io and serve static files
//----------------------------------------------------
const io = socketio(server);
app.use(express.static(path.join(__dirname, "public")));

// JWT secret and allowed user roles
const JWT_SECRET = "d1nvdb4ndw3b517353cr37";
const ALLOWED_ROLES = ["ADMIN", "ADVISOR", "TRADER" , "admin" , "advisor" , "trader" , "Admin","Advisor" , "Trader"];

//----------------------------------------------------
// 6) Socket authentication middleware
//----------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const groupId = socket.handshake.auth.groupId;
  // console.log("Token received:", token);

  if (!token) {
    return next(new Error("Unauthorized: No token provided"));
  }

  try {
    const decoded = decodeJWT(token);
    // console.log("decoding the token tusharrrrrrr")
    // console.log("i am the decoded data", decoded.user.lName)
    console.log("i am the decoded data", decoded)

    console.log(decoded?.role)

    if (!ALLOWED_ROLES.includes(decoded?.user?.role||decoded?.user?.rType)) {
      return next(new Error("Unauthorized: Role not allowed"));
    }

    console.log("accepted user")

    socket.user = {
      name: decoded.user?.profile?.fName|| decoded?.user?.fName,
      email: decoded.user?.profile?.email|| decoded?.user?.email,
      role: decoded.user?.role||decoded?.user?.role,
      userId:decoded.user?.id

    };
    next();
  } catch (err) {
    console.log(err)
    return next(new Error("Unauthorized: Invalid token"));
  }
});

//----------------------------------------------------
// 7) Redis message batching configuration
//----------------------------------------------------
const BATCH_KEY = "batchMessages";
const BATCH_SIZE = 20;

// Push batched messages from Redis to MongoDB
async function flushBatchToMongo() {
  const batch = await redis.lRange(BATCH_KEY, 0, -1);
  if (batch.length === 0) return;

  const docs = batch.map((m) => JSON.parse(m));

  await Chat.insertMany(docs);
  console.log("Flushed", batch.length, "messages to MongoDB");

  await redis.del(BATCH_KEY);
}

//----------------------------------------------------
// 8) REST Middleware to verify JWT token
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
// 9) Fetch messages from MongoDB + Redis
//----------------------------------------------------
// app.get("/messages", verifyRESTToken, async (req, res) => {
app.get("/messages", async (req, res) => {
  const groupId = req.query.groupId;
  const limit = parseInt(req.query.limit || 20);
  const before = req.query.before;

  // Read unflushed messages from Redis
  const redisRaw = await redis.lRange(BATCH_KEY, 0, -1);
  const redisMessages = redisRaw
    .map(r => JSON.parse(r))
    .filter(msg => msg.groupId === groupId);

  // Mongo filters
  let mongoFilter = {};
  if (groupId) mongoFilter.groupId = groupId;
  if (before) mongoFilter.timestamp = { $lt: new Date(before) };

  // Fetch from Mongo
  const mongoMessages = await Chat.find(mongoFilter)
    .sort({ timestamp: -1 })
    .limit(limit);

  // Combine Redis + Mongo and sort
  const all = [...redisMessages, ...mongoMessages]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);

  res.json(all.reverse());
});

//----------------------------------------------------
// 10) Socket event listeners for chat system
//----------------------------------------------------
let onlineUsers = 0;

io.on("connection", async (socket) => {
  onlineUsers++;
  io.emit("clients-total", onlineUsers);

  // Send user data to client
  socket.emit("user-data", socket.user);

  // Handle incoming messages
  socket.on("message", async (data) => {
const messageObj = {
  sender: socket.user.name,
  senderEmail: socket.user.email,   // <<< FIX
  message: data.message,
  timestamp: new Date(),
  groupId: data.groupId, 
  userId:socket.user.userId
};


    // Add message to Redis batch
    await redis.rPush(BATCH_KEY, JSON.stringify(messageObj));

    // Flush batch if size limit reached
    const batchLen = await redis.lLen(BATCH_KEY);
    if (batchLen >= BATCH_SIZE) {
      await flushBatchToMongo();
    }

    // Send message to other clients
    socket.broadcast.emit("chat-message", messageObj);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    onlineUsers--;
    io.emit("clients-total", onlineUsers);
  });
});

//----------------------------------------------------
// 11) Auto flush Redis batch to Mongo every 10 seconds
//----------------------------------------------------
setInterval(() => {
  flushBatchToMongo();
}, 10000);

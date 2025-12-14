const express = require("express");
const path = require("path");
const app = express();
const mongoose = require("mongoose");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");
const socketio = require("socket.io");
const OpenTraderScripts = require("./models/openTraderScripts.model");
const Trader = require("./models/trader.model");
const Advisor = require("./models/advisor.model");

const PORT = process.env.PORT || 8000;
require("dotenv").config();


//----------------------------------------------------
// 1) Connect to MongoDB
//----------------------------------------------------
console.log("Mongo URI Loaded:", !!process.env.MONGODB_URI);
mongoose
  .connect( process.env.MONGODB_URI )
  .then(() => console.log("Mongo connected"))
  .catch((e) => console.error("Mongo connection error", e));

// Define chat message schema
const chatSchema = new mongoose.Schema({
  sender: String, // to remove
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
  socket: { tls: true, rejectUnauthorized: false },
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


// set to save users

const onlineGroupUsers = {};


//----------------------------------------------------
// 4) Decode JWT Without Secret (manual decode)
//----------------------------------------------------
function decodeJWT(token) {
  const parts = token.split(".");
  const payload = parts[1];
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

//----------------------------------------------------
// 5) Initialize Socket.io
//----------------------------------------------------
const io = socketio(server, {
  path: "/dlnv-chat/support/ws", // custom path
});
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = "d1nvdb4ndw3b517353cr37";
const ALLOWED_ROLES = [
  "ADMIN",
  "ADVISOR",
  "TRADER",
  "admin",
  "advisor",
  "trader",
  "Admin",
  "Advisor",
  "Trader",
];

//----------------------------------------------------
// 6) Socket authentication middleware
//----------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
const  groupId = socket.handshake.auth.groupId;

  if (!token) return next(new Error("Unauthorized: No token provided"));

  try {
    const decoded = decodeJWT(token);

    if (!ALLOWED_ROLES.includes(decoded?.user?.role || decoded?.user?.rType)) {
      return next(new Error("Unauthorized: Role not allowed"));
    }
    // console.log("Decoded JWT:", decoded.user?.fName);
    let name = "";
    if(decoded.user?.profile?.fName){
      name =`${decoded.user?.profile?.fName} ${ decoded.user?.profile?.lName}` 
    }else{
      name =`${decoded.user?.fName} ${ decoded.user?.lName}`  
    }

    socket.user = {
      name: name,
      email: decoded.user?.profile?.email || decoded?.user?.email,
      role: decoded.user?.role || decoded?.user?.role,
      userId: decoded.user?.id,
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
  // await Chat.insertMany(docs);
  // console.log("Flushed", batch.length, "messages to MongoDB");
  // await redis.del(BATCH_KEY);
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
    .map((r) => JSON.parse(r))
    .filter((msg) => msg.groupId === groupId);

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
app.get(`/dlnv-chat/support/groupInfo`, async (req, res) => {
  try {
    const groupId = req.query.groupId;
    const activeClients = onlineGroupUsers[groupId]?.size || 0;
    // console.log("jai shree ram",activeClients)

    // 1️⃣ Get all OpenTraderScripts for this group
    const openScripts = await OpenTraderScripts.find({
      scriptId: new mongoose.Types.ObjectId(groupId),
    });

    // 2️⃣ Extract unique traderIds & advisorIds
    const traderIds = [
      ...new Set(openScripts.map((o) => o.traderId.toString())),
    ];
    const advisorIds = [
      ...new Set(openScripts.map((o) => o.otherInfo.script.userId.toString())),
    ];

    // 3️⃣ Fetch Traders
    const traders = await Trader.find(
      { _id: { $in: traderIds } },
      { "profile.fName": 1, "profile.lName": 1 }
    );

    // 4️⃣ Fetch Advisors
    const advisors = await Advisor.find(
      { _id: { $in: advisorIds } },
      { fName: 1, lName: 1, dp: 1 }
    );

    // 5️⃣ Build response objects
    const traderInfo = traders.map((t) => ({
      fname: t.profile?.fName || "",
      lname: t.profile?.lName || "",
      userId: t._id,
      image: "",
    }));

    const advisorInfo = advisors.map((a) => ({
      fname: a.fName || "",
      lname: a.lName || "",
      userId: a._id,
      image: a.dp || "",
    }));

    res.json({
      groupId,
      advisorId: advisorIds[0] || null,
      totalClients: traderInfo.length,
      activeClients,
      advisorInfo,
      traderInfo,
      adminInfo: [],
    });
  } catch (err) {
    console.error("groupInfo error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


async function getGroupInfo(groupId) {
  const activeClients = onlineGroupUsers[groupId]?.size || 0;

  const openScripts = await OpenTraderScripts.find({
    scriptId: new mongoose.Types.ObjectId(groupId),
  });

  const traderIds = [
    ...new Set(openScripts.map((o) => o.traderId.toString())),
  ];

  const advisorIds = [
    ...new Set(openScripts.map((o) => o.otherInfo.script.userId.toString())),
  ];

  const traders = await Trader.find(
    { _id: { $in: traderIds } },
    { "profile.fName": 1, "profile.lName": 1 }
  );

  const advisors = await Advisor.find(
    { _id: { $in: advisorIds } },
    { fName: 1, lName: 1, dp: 1 }
  );

  // 🔥 BUILD PARTICIPANTS MAP
  const participants = {};

  // Advisors
  advisors.forEach((a) => {
    participants[a._id.toString()] = {
      fname: a.fName || "",
      lname: a.lName || "",
      userId: a._id,
      image: a.dp || "",
      role: "advisor",
    };
  });

  // Traders
  traders.forEach((t) => {
    participants[t._id.toString()] = {
      fname: t.profile?.fName || "",
      lname: t.profile?.lName || "",
      userId: t._id,
      image: "",
      role: "trader",
    };
  });

  return {
    groupId,
    advisorId: advisorIds[0] || null,
    totalClients: traders.length,
    activeClients,
    participants, // ✅ HERE
    advisorInfo: advisors.map((a) => ({
      fname: a.fName,
      lname: a.lName,
      userId: a._id,
      image: a.dp || "",
    })),
    traderInfo: traders.map((t) => ({
      fname: t.profile?.fName,
      lname: t.profile?.lName,
      userId: t._id,
      image: "",
    })),
    adminInfo: [],
  };
}

//----------------------------------------------------
// 10) UNIQUE ONLINE USER PER GROUP LOGIC
//----------------------------------------------------

// { groupId: Set(userIds) }

io.on("connection", async (socket) => {
  
  const groupId = socket.handshake.auth.groupId;
  const userId = socket.user.userId;

  
  if (!groupId || !userId) return;
  
  socket.join(groupId);
  
  if (!onlineGroupUsers[groupId]) {
    onlineGroupUsers[groupId] = new Set();
  }
  
  const role = socket.user.role;
  // console.log("User role========================:", role);

  if (role.toLowerCase() !="admin"&& role.toLowerCase()!="advisor") {
    // console.log("***************************" , role.toLowerCase());
  onlineGroupUsers[groupId].add(userId);
   
  }

  
  
  // Emit count ONLY to this group
  io.to(groupId).emit("group-online-count", onlineGroupUsers[groupId].size);

  const groupInfo = await getGroupInfo(groupId);
  // console.log("groupInfo on connect:", groupInfo);
io.to(groupId).emit("group-info-update", groupInfo);
  
  socket.emit("user-data", socket.user);

  // ----- Handle Messages -----
  socket.on("message", async (data) => {
    const messageObj = {
      sender: socket.user.name,
      senderEmail: socket.user.email,
      message: data.message,
      timestamp: new Date(),
      groupId: data.groupId,
      userId: socket.user.userId,
    };

    await redis.rPush(BATCH_KEY, JSON.stringify(messageObj));

    const batchLen = await redis.lLen(BATCH_KEY);
    if (batchLen >= BATCH_SIZE) await flushBatchToMongo();

    socket.broadcast.to(data.groupId).emit("chat-message", messageObj);
  });

  // ----- Handle Disconnect -----
  socket.on("disconnect", async() => {
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
    const groupInfo = await getGroupInfo(groupId);
io.to(groupId).emit("group-info-update", groupInfo);

  });
});

//----------------------------------------------------
// 11) Auto flush
//----------------------------------------------------
setInterval(() => {
  // flushBatchToMongo();
}, 10000);

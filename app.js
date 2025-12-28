// ===================================================
// app.js - DLNV Chat & Notification Server
// ===================================================

const express = require("express");
const path = require("path");
const app = express();
const mongoose = require("mongoose");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");
const socketio = require("socket.io");

// Models
const OpenTraderScripts = require("./models/openTraderScripts.model");
const Trader = require("./models/trader.model");
const Advisor = require("./models/advisor.model");
const Associates = require("./models/associates.model");

const PORT = process.env.PORT || 8000;
require("dotenv").config();

// ----------------------------------------------------
// 1) Connect to MongoDB
// ----------------------------------------------------
mongoose
  .connect(
    "mongodb+srv://qareadonly:4daGEbRiLI68VTpK@dlnv-qa.svztmll.mongodb.net/dlnv-db?retryWrites=true&w=majority&appName=DLNV-QA"
  )
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

// ----------------------------------------------------
// 2) Connect to Redis (for message batching)
// ----------------------------------------------------
const redis = createClient({
  url: "rediss://default:ASmWAAIncDJmZjQzZWVjYzhkZGM0ZDkxYmY0MDljNzJmMjg3YzRhMHAyMTA2NDY@meet-moose-10646.upstash.io:6379",
  socket: { tls: true, rejectUnauthorized: false },
});

redis.connect();

redis.on("ready", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error", err));

// ----------------------------------------------------
// 3) Start Express Server
// ----------------------------------------------------
const server = app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

// ----------------------------------------------------
// 4) Global Variables & Constants
// ----------------------------------------------------
const onlineGroupUsers = {}; // { groupId: Set(userId) } - tracks unique online users per group

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

// Serve static files (chat UI)
app.use(express.static(path.join(__dirname, "public")));

// ----------------------------------------------------
// 5) Initialize Socket.IO Instances
// ----------------------------------------------------
// Main chat socket (custom path)
const io = socketio(server, {
  path: "/dlnv-chat/support/ws", // custom path
});

// Notification socket (separate namespace)
const notificationIO = socketio(server, {
  path: "/dlnv-chat/notify/ws",
  cors: {
    origin: ["http://localhost:4000", "http://localhost:4200", "http://localhost:4201"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ----------------------------------------------------
// 6) Notification Socket Authentication & Connection Handling
// ----------------------------------------------------
notificationIO.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("No token"));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = {
      userId: decoded.user.id,
      role: decoded.user.role || decoded.user.rType,
      name: decoded.user.fName || "User",
    };
    next();
  } catch (e) {
    next(new Error("Invalid token"));
  }
});

notificationIO.on("connection", (socket) => {
  console.log(
    "[NOTIFY SOCKET CONNECTED]",
    socket.user.userId,
    socket.user.role
  );

  socket.join(socket.user.userId);

  socket.on("disconnect", () => {
    console.log("[NOTIFY SOCKET DISCONNECTED]", socket.user.userId);
  });
});

// ----------------------------------------------------
// 7) Main Chat Socket Authentication Middleware
// ----------------------------------------------------
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  const groupId = socket.handshake.auth.groupId;

  if (!token) return next(new Error("Unauthorized: No token provided"));
  if (!groupId) return next(new Error("Unauthorized: No groupId provided"));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!ALLOWED_ROLES.includes(decoded?.user?.role || decoded?.user?.rType)) {
      return next(new Error("Unauthorized: Role not allowed"));
    }

    let name = "";
    if (decoded.user?.profile?.fName) {
      name = `${decoded.user?.profile?.fName} ${decoded.user?.profile?.lName}`;
    } else {
      name = `${decoded.user?.fName} ${decoded.user?.lName}`;
    }
    if (decoded?.user?.rType?.toLowerCase() === "admin") {
      name = "Daily Trades Admin";
    }
    console.log("Decoded user info:", decoded.user);
    if (decoded?.user?.role?.toLowerCase() === "trader") {
      name  = await Trader.findById(decoded.user?.id).then(trader => {
        if (trader && trader.profile) {
          return `${trader.profile.fName} ${trader.profile.lName}`;
        } else {
          return name;
        } })
        console.log("Trader name fetched:", name);
    }

    socket.user = {
      name: name,
      email: decoded.user?.profile?.email || decoded?.user?.email,
      role: decoded.user?.role || decoded?.user?.role || decoded?.user?.rType,
      userId: decoded.user?.id,
    };

    next();
  } catch (err) {
    return next(new Error("Unauthorized: Invalid token"));
  }
});

// ----------------------------------------------------
// 8) Helper: API Token Verification Middleware
// ----------------------------------------------------
async function verifyApiToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const groupId = req.query.groupId || req.body.groupId;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: No token" });
    }

    if (!groupId) {
      return res.status(400).json({ message: "groupId is required" });
    }

    const token = authHeader.split(" ")[1];

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);

    const role = decoded?.user?.role || decoded?.user?.rType;

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(403).json({ message: "Forbidden: Role not allowed" });
    }

    const userId = decoded.user?.id;

    // GROUP ACCESS CHECK
    let hasAccess = false;

    // Admin → always allowed
    if (role.toLowerCase() === "admin") {
      hasAccess = true;
    } else {
      const openScripts = await OpenTraderScripts.find({
        scriptId: new mongoose.Types.ObjectId(groupId),
      });

      for (const os of openScripts) {
        // Trader
        if (os.traderId?.toString() === userId) {
          hasAccess = true;
          break;
        }

        // Advisor
        if (os.otherInfo?.script?.userId?.toString() === userId) {
          hasAccess = true;
          break;
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({
        message: "Forbidden: You are not part of this group",
      });
    }

    // Attach user to request
    req.user = {
      userId,
      role,
      email: decoded.user?.profile?.email || decoded.user?.email,
      name: decoded.user?.profile?.fName
        ? `${decoded.user.profile.fName} ${decoded.user.profile.lName || ""}`
        : `${decoded.user?.fName || ""} ${decoded.user?.lName || ""}`,
    };

    next();
  } catch (err) {
    console.error("API auth error:", err.message);
    return res.status(401).json({
      message: "Unauthorized: Invalid or expired token",
    });
  }
}

// ----------------------------------------------------
// 9) Helper: Get Group Information (used in sockets & API)
// ----------------------------------------------------
async function getGroupInfo(groupId) {
  const activeClients = onlineGroupUsers[groupId]?.size || 0;

  const openScripts = await OpenTraderScripts.find({
    scriptId: new mongoose.Types.ObjectId(groupId),
  });

  // console.log("openScripts :", openScripts);

  const scriptTitle = openScripts[0]?.otherInfo?.script?.title || "Support Group";

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

  const admins = await Associates.find();

  const advisors = await Advisor.find(
    { _id: { $in: advisorIds } },
    { fName: 1, lName: 1, dp: 1 }
  );

  // Build participants map
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

  // Admins
  admins.forEach((adm) => {
    participants[adm._id.toString()] = {
      fname: adm?.fName || "Daily Trades",
      lname: adm?.lName || "Admin",
      userId: adm?._id,
      image: adm?.dp || "",
      role: "admin",
    };
  });

  return {
    groupId,
    scriptTitle,
    advisorId: advisorIds[0] || null,
    totalClients: traders.length,
    activeClients,
    participants,
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
    adminInfo: admins.map((adm) => ({
      fname: adm?.fName || "Daily Trades",
      lname: adm?.lName || "Admin",
      userId: adm?._id,
      image: adm?.dp || "",
    })),
  };
}

// ----------------------------------------------------
// 10) API Routes
// ----------------------------------------------------
// Fetch chat messages (from Redis batch + MongoDB)
app.get("/dlnv-chat/support/messages", verifyApiToken, async (req, res) => {
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

// Get group info (members, online count, etc.)
app.get(`/dlnv-chat/support/groupInfo`, verifyApiToken, async (req, res) => {
  try {
    const groupId = req.query.groupId;
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

// ----------------------------------------------------
// 11) Redis Batching Constants & Flush Function
// ----------------------------------------------------
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

// ----------------------------------------------------
// 12) Main Chat Socket Connection Handling
// ----------------------------------------------------
io.on("connection", async (socket) => {
  const groupId = socket.handshake.auth.groupId;
  const userId = socket.user.userId;

  if (!groupId || !userId) return;

  socket.join(groupId);

  if (!onlineGroupUsers[groupId]) {
    onlineGroupUsers[groupId] = new Set();
  }

  const role = socket.user.role;

  if (role?.toLowerCase() !== "admin" && role?.toLowerCase() !== "advisor") {
    onlineGroupUsers[groupId].add(userId);
  }

  // Emit online count to group
  io.to(groupId).emit("group-online-count", onlineGroupUsers[groupId].size);

  // Send updated group info
  const groupInfo = await getGroupInfo(groupId);
  // console.log("groupInfo on connect:", groupInfo);
  io.to(groupId).emit("group-info-update", groupInfo);

  // Send user data to the connected client
  socket.emit("user-data", socket.user);

  // Handle incoming messages
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

    // Broadcast message to others in group
    socket.broadcast.to(data.groupId).emit("chat-message", messageObj);

    // Send push notification to all group members (except sender)
    const groupInfo = await getGroupInfo(data.groupId);

    Object.keys(groupInfo.participants).forEach((uid) => {
      if (uid !== socket.user.userId) {
        notificationIO
          .to(uid)
          .emit("chat-notification", {
            sender: socket.user.name,
            senderRole: socket.user.role.toLowerCase(),
            message: data.message,
            image: groupInfo.participants[socket.user.userId]?.image || "",
            groupId: data.groupId,
          });
      }
    });
  });

  // Handle disconnect
  socket.on("disconnect", async () => {
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

// ----------------------------------------------------
// 13) Auto-flush Redis batch every 10 seconds (currently commented)
// ----------------------------------------------------
setInterval(() => {
  // flushBatchToMongo();
}, 10000);
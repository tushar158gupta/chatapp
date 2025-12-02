const express = require("express");
const path = require("path");
const app = express();

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
    console.log("running on port 4000")
});


const jwt = require("jsonwebtoken");
const io = require("socket.io")(server);

app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = "qwertyuiopasdfghjklzxcvbnm123456";
const ALLOWED_ROLES = ["Admin", "Advisor", "Trader"];

io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
        return next(new Error("Unauthorized: No token"));
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const role = decoded.Role;

        if (!ALLOWED_ROLES.includes(role)) {
            return next(new Error("Unauthorized: Role not allowed"));
        }

        socket.user = {
            name: decoded.GivenName,
            email: decoded.Email,
            role: decoded.Role
        };

        next();

    } catch (err) {
        return next(new Error("Unauthorized: Invalid token"));
    }
});

let connectedUsers = new Set();

io.on("connection", (socket) => {
    socket.emit("user-data", socket.user);

    connectedUsers.add(socket.id);
    io.emit("clients-total", connectedUsers.size);

    socket.on("disconnect", () => {
        connectedUsers.delete(socket.id);
        io.emit("clients-total", connectedUsers.size);
    });

    socket.on("message", (data) => {
        socket.broadcast.emit("chat-message", data);
    });

    socket.on("feedback", (data) => {
        socket.broadcast.emit("feedback", data);
    });
});

io.on("connection_error", (err) => {});

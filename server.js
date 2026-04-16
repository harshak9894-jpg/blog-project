const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const flash = require("connect-flash");
const methodOverride = require("method-override");
const path = require("path");
const http = require("http");
const User = require("./models/User");
const Conversation = require("./models/Conversation");
const { initChatSocket } = require("./realtime/chatSocket");
const { ensureUploadsDir, getUploadsDir } = require("./utils/uploads");

dotenv.config();

const app = express();
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 5000;

ensureUploadsDir();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static(getUploadsDir()));
app.use(methodOverride("_method"));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const sessionMiddleware = session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction
  }
});

app.use(sessionMiddleware);

initChatSocket(server, sessionMiddleware);

app.use(flash());

app.use((req, res, next) => {
  Promise.resolve().then(async () => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.user = req.session.userId;
    res.locals.currentPath = req.path;
    const rawSearch = req.query.search;
    res.locals.search = typeof rawSearch === "string"
      ? rawSearch
      : (Array.isArray(rawSearch) ? rawSearch[0] : "") || "";
    res.locals.currentUser = null;
    res.locals.unreadNotificationsCount = 0;
    res.locals.unreadChatCount = 0;

    if (req.session.userId) {
      const [currentUser, chatConversations] = await Promise.all([
        User.findById(req.session.userId)
          .select("displayName handle profilePic savedPosts notifications"),
        Conversation.find({ participants: req.session.userId })
          .select("participantSettings")
      ]);

      if (currentUser) {
        res.locals.currentUser = currentUser;
        res.locals.unreadNotificationsCount = currentUser.notifications.filter((notification) => !notification.read).length;
        res.locals.unreadChatCount = chatConversations.reduce((sum, conversation) => {
          const participantSetting = (conversation.participantSettings || []).find(
            (setting) => String(setting.user) === String(req.session.userId)
          );
          return sum + (participantSetting?.unreadCount || 0);
        }, 0);
      }
    }

    next();
  }).catch(next);
});

app.use("/", require("./routes/auth"));
app.use("/", require("./routes/post"));
app.use("/", require("./routes/chat"));

app.use((req, res) => {
  res.status(404).render("notFound");
});

app.use((err, req, res, next) => {
  console.error(err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong";

  if (req.accepts("json") && !req.accepts("html")) {
    return res.status(statusCode).json({ error: message });
  }

  res.status(statusCode).render("error", {
    message,
    statusCode
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

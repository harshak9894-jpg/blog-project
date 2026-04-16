function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash("error", "Please login first");
    return res.redirect("/login");
  }

  next();
}

function requireLoginJson(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Login required" });
  }

  next();
}

module.exports = {
  requireLogin,
  requireLoginJson
};

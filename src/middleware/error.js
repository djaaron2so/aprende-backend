export function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(err, req, res, next) {
  console.error("❌ Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    details: err.details || undefined
  });
}

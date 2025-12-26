import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT || 8091),
  WORKER_URL: process.env.WORKER_URL || "http://localhost:8091",
  PUBLIC_FILES_BASE: process.env.PUBLIC_FILES_BASE || "http://localhost:8081",

  // Stripe (lo activamos al final)
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || ""
};

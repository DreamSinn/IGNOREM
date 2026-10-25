import { closeDatabase, ensureSchema } from "./db.js";

try {
  await ensureSchema();
  console.log("Schema aplicado.");
} finally {
  await closeDatabase();
}

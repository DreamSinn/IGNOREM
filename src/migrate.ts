import { closeDatabase, ensureSchema } from "./db.js";
import { ensureWarehouseSchema } from "./warehouse-db.js";

try {
  await ensureSchema();
  await ensureWarehouseSchema();
  console.log("Schema aplicado.");
} finally {
  await closeDatabase();
}

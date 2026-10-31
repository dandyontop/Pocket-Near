import { migrate, pool } from "./db.js";
try { await migrate(); console.info("Pocket Near database schema is ready."); }
finally { await pool.end(); }

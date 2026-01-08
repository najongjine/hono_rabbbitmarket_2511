import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as dotenv from "dotenv";
import { cors } from "hono/cors"; // <-- 보안 해재
import { dbMiddleware } from "./db/db.js"; // DB

const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";
dotenv.config({ path: envFile });

const app = new Hono<HonoEnv>();
app.use("*", dbMiddleware); // DB 등록
app.use("*", cors()); // <-- 보안 해재
/**
 * 서버설정
 * DB 설정
 * 보안설정
 */
app.get("/", (c) => {
  return c.text("health check!");
});

/** router 설정 */
import hospitalRouter from "./router/hospital_router.js";
import testRouter from "./router/test_router.js";
import { HonoEnv } from "./types/types.js";
app.route("/api/hospital", hospitalRouter);
app.route("/api/test", testRouter);
/** router 설정 END */

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);

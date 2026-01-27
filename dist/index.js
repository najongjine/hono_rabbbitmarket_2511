import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as dotenv from "dotenv";
import { cors } from "hono/cors"; // <-- 보안 해재
import { dbMiddleware } from "./db/db.js"; // DB
const envFile = process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";
dotenv.config({ path: envFile });
const app = new Hono();
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
import userRouter from "./router/user_router.js";
import testRouter from "./router/test_router.js";
import itemRouter from "./router/item_router.js";
app.route("/api/test", testRouter);
app.route("/api/user", userRouter);
app.route("/api/item", itemRouter);
/** router 설정 END */
serve({
    fetch: app.fetch,
    port: 3000,
}, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
});

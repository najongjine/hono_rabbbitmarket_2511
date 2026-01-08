import { createMiddleware } from "hono/factory";
import { Pool } from "@neondatabase/serverless";
import { HonoEnv } from "../types/types.js";

export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  // [수정 포인트 1] c.env에 없으면 process.env에서 찾도록 수정 (Node.js 호환성)
  const connectionString = c.env?.DATABASE_URL || process.env.DATABASE_URL;

  // 연결 문자열이 없는 경우 방어 코드
  if (!connectionString) {
    console.error("❌ Error: DATABASE_URL is missing in .env file");
    return c.json({ error: "Server Configuration Error" }, 500);
  }

  // 2. Pool 생성
  const pool = new Pool({ connectionString });

  // 3. 컨텍스트(c)에 db 인스턴스 주입
  c.set("db", pool);

  try {
    await next();
  } finally {
    // [수정 포인트 2] executionCtx 에러 방지를 위한 완벽한 처리
    try {
      // Edge 환경 (Vercel, Cloudflare)
      if (c.executionCtx) {
        c.executionCtx.waitUntil(pool.end());
      } else {
        throw new Error("No executionCtx");
      }
    } catch (e) {
      // Node.js 환경 (Local)
      await pool.end();
    }
  }
});

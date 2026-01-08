import { Pool } from "@neondatabase/serverless";

export type Bindings = {
  DATABASE_URL: string;
};

export type Variables = {
  db: Pool;
};

// Hono 앱 전체에 적용될 제네릭 타입
export type HonoEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

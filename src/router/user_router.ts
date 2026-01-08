import { Hono } from "hono";
import { HonoEnv } from "../types/types.js";

const router = new Hono<HonoEnv>();

interface ResultType {
  success?: boolean;
  data?: any;
  msg?: string;
}
router.get("/query_string", async (c) => {
  let result: ResultType = { success: true };
  try {
    let query = String(c?.req?.query("query") ?? "데이터 안보냄");

    query = query?.trim() ?? "";
    result.data = `클라이언트가 보낸 q 라는 데이터: ${query}`;
    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

/** 큰 데이터 받는 방법. 이거를 제일 많이 씀 */
router.post("/formdata_body", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db = c.var.db;
    const body = await c.req.parseBody({ all: true });

    let files = body["files"];

    let nickname = String(body["nickname"] || "");
    nickname = nickname?.trim() || "";
    let phone_number = String(body["phone_number"] || "");
    phone_number = phone_number?.trim() || "";
    let addr = String(body["addr"] || "");
    addr = addr?.trim() || "";
    let long = Number(body["long"] || 0);
    let lat = Number(body["lat"] || 0);

    const query = `
      INSERT INTO t_user (
        nickname, 
        phone_number, 
        addr, 
        long, 
        lat, 
        geo_point
      ) VALUES (
        $1, 
        $2, 
        $3, 
        $4, 
        $5, 
        ST_SetSRID(ST_MakePoint($4, $5), 4326)
      )
      RETURNING *;
    `;

    // 3. 파라미터 바인딩 ($1, $2... 순서 중요)
    const values = [nickname, phone_number, addr, long, lat];

    // 4. 실행
    const result = await db.query(query, values);

    if (!Array.isArray(files)) {
      files = [files];
    }
    const fileInfos = files.map((f: any) => ({
      name: f.name, // 파일명
      size: f.size, // 파일 크기
      type: f.type, // 파일 타입 (MIME)
    }));

    // 3. 각 파일을 Binary(Buffer)로 변환
    // map 내에서 await를 써야 하므로 Promise.all 사용
    const fileData = await Promise.all(
      files.map(async (file: any) => {
        // (핵심) Web Standard File -> ArrayBuffer -> Node.js Buffer 변환
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 이제 'buffer' 변수에는 실제 바이너리 데이터가 들어있습니다.
        // (예: fs.writeFileSync('save.png', buffer) 등으로 저장 가능)

        return {
          name: file.name,
          type: file.type,
          size: file.size,
          // JSON으로 확인하기 위해 바이너리를 Base64 문자열로 살짝 보여줌
          binaryPreview: buffer.toString("base64").substring(0, 50) + "...",
          // 혹은 Hex 코드로 확인
          hexPreview: buffer.toString("hex").substring(0, 20) + "...",
        };
      })
    );

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

export default router;

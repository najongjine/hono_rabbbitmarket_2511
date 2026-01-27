import { Hono } from "hono";
const router = new Hono();
router.get("/query_string", async (c) => {
    let result = { success: true };
    try {
        let query = String(c?.req?.query("query") ?? "데이터 안보냄");
        query = query?.trim() ?? "";
        result.data = `클라이언트가 보낸 q 라는 데이터: ${query}`;
        return c.json(result);
    }
    catch (error) {
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
router.get("/query_string_array", async (c) => {
    let result = { success: true };
    try {
        const tags = c.req.queries("tags");
        result.data = tags;
        return c.json(result);
    }
    catch (error) {
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
router.get("/header", async (c) => {
    let result = { success: true };
    try {
        const custom_header = c.req.header("custom_header");
        result.data = custom_header;
        return c.json(result);
    }
    catch (error) {
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
/** 큰 데이터 받는 방법. 이거를 제일 많이 씀 */
router.post("/formdata_body", async (c) => {
    let result = { success: true };
    try {
        const body = await c.req.parseBody({ all: true });
        let files = body["files"];
        const strdata1 = body["strdata1"];
        if (!Array.isArray(files)) {
            files = [files];
        }
        const fileInfos = files.map((f) => ({
            name: f.name, // 파일명
            size: f.size, // 파일 크기
            type: f.type, // 파일 타입 (MIME)
        }));
        // 3. 각 파일을 Binary(Buffer)로 변환
        // map 내에서 await를 써야 하므로 Promise.all 사용
        const fileData = await Promise.all(files.map(async (file) => {
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
        }));
        result.data = {
            strdata1: strdata1,
            fileInfos: fileInfos,
            fileData: fileData,
        };
        return c.json(result);
    }
    catch (error) {
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
router.post("/json_body", async (c) => {
    let result = { success: true };
    try {
        const body = await c.req.json();
        let sample1 = body?.sample1;
        let sample2 = body?.sample2;
        result.data = {
            sample1: sample1,
            sample2: sample2,
        };
        return c.json(result);
    }
    catch (error) {
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
router.get("/db_select_test", async (c) => {
    let result = { success: true };
    const db = c.var.db;
    let id = Number(c?.req?.query("id") ?? 0);
    try {
        // ⭐️ SQL Injection 방지: $1 문법 사용
        // 쌩쿼리지만 파라미터 바인딩을 통해 안전하게 처리됩니다.
        let _data = await db.query("SELECT * FROM hospitals WHERE id = $1", [id] // 배열 순서대로 $1에 매핑됨
        );
        let _data2 = _data?.rows;
        result.data = _data2;
        return c.json(result);
    }
    catch (error) {
        console.error(error);
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
router.post("/db_post_test", async (c) => {
    let result = { success: true };
    const db = c.var.db;
    let id = Number(c?.req?.query("id") ?? 0);
    // body에서 데이터 파싱
    const { name, email } = await c.req.json();
    try {
        // ⭐️ SQL Injection 방지: $1, $2, $3 사용
        const query = `
      UPDATE users 
      SET name = $1, email = $2, updated_at = NOW() 
      WHERE id = $3
      RETURNING *
    `;
        const _data = await db.query(query, [name, email, id]);
        result.data = _data;
        return c.json(result);
    }
    catch (error) {
        console.error(error);
        result.success = false;
        result.msg = `!server error. ${error?.message ?? ""}`;
        return c.json(result);
    }
});
export default router;

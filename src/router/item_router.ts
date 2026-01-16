import { Hono } from "hono";
import {
  HonoEnv,
  ImgBBUploadResult,
  KakaoAddressResponse,
} from "../types/types.js";
import {
  comparePassword,
  decryptData,
  encryptData,
  generateToken,
  hashPassword,
  verifyToken,
} from "../utils/utils.js";

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

router.get("/get_item_by_id", async (c) => {
  let result: ResultType = { success: true };
  const db = c.var.db;
  try {
    let item_id = Number(c?.req?.query("item_id") || 0);
    const updateQuery = `
    SELECT 
     i.id as item_id
    ,i.user_id
    ,i.category_id
    ,c.name as category_name
    ,i.title
    ,i.content
    ,i.price
    ,i.status
    ,i.addr
    ,i.created_at
    ,i.updated_at
    ,ST_AsGeoJSON(geo_point)::json as geo_point
    ,embedding::json as embedding
    -- 2. 이미지를 JSON 배열로 변환 (핵심!)
    , COALESCE(
        json_agg(
          json_build_object(
            'img_id', img.id,
            'url', img.img_url,
            'created_dt', img.created_dt
          )
        ) FILTER (WHERE img.id IS NOT NULL), 
        '[]'
      ) as images
    FROM t_items as i
    LEFT JOIN t_category as c ON c.id=i.category_id
    LEFT JOIN t_item_img as img ON img.item_id = i.id
    WHERE id = $1
    GROUP BY i.id, c.name;
  `;
    let _result: any = await db.query(updateQuery, [item_id]);
    _result = _result?.rows || [];
    result.data = _result;

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

/** 큰 데이터 받는 방법. 이거를 제일 많이 씀 */
router.post("/upsert_item", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db = c.var.db;

    // 1. 헤더에서 Authorization 값 가져오기
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      result.success = false;
      result.msg = `!토큰이 없습니다.`;
      return c.json(result);
    }

    // 2. "Bearer " 문자열 제거하고 순수 토큰만 추출
    const token = authHeader.split(" ")[1];

    // 3. JWT 검증 (utils.ts의 verifyToken 사용)
    const payload: any = verifyToken(token);

    if (!payload || !payload.data) {
      result.success = false;
      result.msg = `!유효하지 않은 토큰입니다.`;
      return c.json(result);
    }

    // 4. 암호화된 데이터 복호화 (utils.ts의 decryptData 사용)
    // payload 구조가 { data: encUser, iat:..., exp:... } 이므로 payload.data를 꺼냄
    const decryptedString = decryptData(payload.data);

    // 5. JSON 문자열을 객체로 변환
    const user = JSON.parse(decryptedString);

    const body = await c.req.parseBody({ all: true });

    let files = body["files"];

    let category_id = Number(body["category_id"] || 0);
    let item_id = Number(body["item_id"] || 0);
    let title = String(body["title"] || "");
    title = title?.trim() || "";
    let content = String(body["content"] || "");
    content = content?.trim() || "";
    let price = Number(body["price"] || 0);

    console.log(`files: `, files);

    // [1단계] item_id가 있다면(수정 모드라면), 먼저 DB 찔러서 확인
    if (item_id > 0) {
      const checkQuery = `SELECT * FROM t_item 
      WHERE id = $1 AND user_id = $2`;
      const checkResult = await db.query(checkQuery, [item_id, user?.id]);

      // Case 1: 아이디에 해당하는 글이 아예 없음
      if (checkResult.rowCount === 0) {
        return c.json({ error: "존재하지 않는 게시물입니다." }, 404);
      }

      // Case 3: 통과 -> 여기서 Update 로직 수행
      const updateQuery = `
    UPDATE t_item 
    SET category_id = $1, title = $2, content = $3, price = $4, updated_at = NOW()
    WHERE id = $5
  `;
      await db.query(updateQuery, [
        category_id,
        title,
        content,
        price,
        item_id,
      ]);
    } else {
      // [2단계] item_id가 0이면 조회할 필요 없이 바로 Insert
      const insertQuery = `
    INSERT INTO t_item (category_id, user_id, title, content, price, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id;
  `;
      const insertResult = await db.query(insertQuery, [
        category_id,
        user?.id,
        title,
        content,
        price,
      ]);
      const newId = insertResult.rows[0].id;
      item_id = newId;
    }

    let uploadedUrls: string[] = [];
    let uploadResults: ImgBBUploadResult[] = [];
    const IMGBB_API_KEY = String(process?.env?.IMGBB_API_KEY || "");
    if (files) {
      if (!Array.isArray(files)) {
        files = [files];
      }

      // Promise.all의 결과를 외부 변수 uploadResults에 할당
      uploadResults = await Promise.all(
        files.map(async (file: any): Promise<ImgBBUploadResult> => {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64Image = buffer.toString("base64");

            const formData = new FormData();
            formData.append("key", IMGBB_API_KEY);
            formData.append("image", base64Image);
            formData.append("name", file.name);

            const response = await fetch("https://api.imgbb.com/1/upload", {
              method: "POST",
              body: formData,
            });

            const result: any = await response.json();

            if (result.success) {
              return {
                status: "success",
                filename: file.name,
                url: result.data.url,
                delete_url: result.data.delete_url,
              };
            } else {
              console.error(`ImgBB Upload Error for ${file.name}:`, result);
              return {
                status: "fail",
                filename: file.name,
                error: result.error?.message || "Unknown error",
              };
            }
          } catch (error) {
            console.error("Network or Parsing Error:", error);
            return {
              status: "error",
              filename: file.name,
              error: String(error),
            };
          }
        })
      );

      // 성공한 URL만 따로 모으기 (필요 시)
      uploadedUrls = uploadResults
        .filter((r) => r.status === "success" && r.url)
        .map((r) => r.url as string);
    }

    // ---------------------------------------------------------
    // 4. 이제 if 문 밖에서도 결과(uploadResults)를 확인하고 예외처리 가능합니다.
    // ---------------------------------------------------------

    console.log("전체 결과 상세:", uploadResults);
    console.log("성공한 URL 목록:", uploadedUrls);

    // 예: 하나라도 실패한 게 있는지 체크하고 싶을 때
    const failedUploads = uploadResults.filter((r) => r.status !== "success");

    if (failedUploads.length > 0) {
      console.warn("일부 이미지 업로드 실패:", failedUploads);
      // 여기서 클라이언트에게 실패 알림을 보내거나 재시도 로직을 짤 수 있음
    }

    if (uploadResults.length === 0 && files) {
      // 파일은 있었는데 결과가 비어있는 이상 케이스 등 처리
    }
    if (uploadedUrls?.length || 0) {
    }

    /* uploadedUrls 여기에 이미지 url 담겨 있음
    이걸 t_item_img 에 추가 하세요
     */
    for (const e of uploadedUrls) {
      const insertQuery = `
    INSERT INTO t_item_img (item_id,img_url)
    VALUES ($1, $2)
    RETURNING id;
  `;
      const insertResult = await db.query(insertQuery, [item_id, e]);
    }

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

export default router;

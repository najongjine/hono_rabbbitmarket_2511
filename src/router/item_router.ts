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
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as dotenv from "dotenv";

const router = new Hono<HonoEnv>();

const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";
dotenv.config({ path: envFile });
const apiKey = process.env.GEMINI_API_KEY || "";
console.log("---------------------------------------------------");
console.log(
  "GEMINI API KEY 확인:",
  apiKey ? "키가 존재합니다 (OK)" : "!!! 키가 없습니다 (NULL) !!!",
);
console.log("---------------------------------------------------");
const genAI = new GoogleGenerativeAI(apiKey);

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

router.get("/get_items", async (c) => {
  let result: ResultType = { success: true };
  const db = c.var.db;
  try {
    // 1. 헤더에서 Authorization 값 가져오기
    const authHeader = c.req.header("Authorization");
    let user: any = {};
    try {
      // 2. "Bearer " 문자열 제거하고 순수 토큰만 추출
      const token = authHeader?.split(" ")[1] || "";

      // 3. JWT 검증 (utils.ts의 verifyToken 사용)
      const payload: any = verifyToken(token);

      // 4. 암호화된 데이터 복호화 (utils.ts의 decryptData 사용)
      // payload 구조가 { data: encUser, iat:..., exp:... } 이므로 payload.data를 꺼냄
      const decryptedString = decryptData(payload.data);

      // 5. JSON 문자열을 객체로 변환
      user = JSON.parse(decryptedString);
    } catch (error: any) {
      user = {};
    }

    // 6. 유저 위치 정보 확인
    const userLat = Number(user?.lat);
    const userLong = Number(user?.long);
    // 유효한 위치 정보인지 확인 (0도 유효한 좌표일 수 있으나 여기서는 0이면 없는 것으로 간주했던 기존 로직 유지/보완)
    // 보통 0,0 은 바다 한가운데라 유저 위치로 잘 안나오긴 함.
    const hasLocation =
      !isNaN(userLat) && !isNaN(userLong) && (userLat !== 0 || userLong !== 0);

    const paramLat = hasLocation ? userLat : null;
    const paramLong = hasLocation ? userLong : null;

    // [추가] 필터링 파라미터 파싱
    const categoryId = Number(c.req.query("category_id") || 0);
    const searchKeyword = String(c.req.query("search_keyword") || "").trim();

    // -----------------------------------------------------------
    // [추가 로직] Embedding API 호출하여 벡터값 생성
    // -----------------------------------------------------------
    let embeddingVectorStr = null; // DB에 넣을 문자열 (예: "[-0.1, 0.5, ...]")

    if (searchKeyword?.length > 0) {
      try {
        const embedRes = await fetch(
          "https://wildojisan-embeddinggemma-300m-fastapi.hf.space/make_text_embedding",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // API 스펙에 맞춰 documents 배열에 title을 담아 보냅니다.
            body: JSON.stringify({
              documents: [searchKeyword],
              query: searchKeyword,
            }),
          },
        );

        const embedJson: any = await embedRes.json();
        console.log(`embedJson: `, embedJson);

        // 응답 구조: { success: true, data: [ [vector...] ], ... }
        if (embedJson.success && embedJson.data && embedJson.data.length > 0) {
          // 첫 번째 문서의 벡터를 가져옴
          const vector = embedJson.data[0];
          // DB 저장을 위해 JSON 문자열로 변환
          embeddingVectorStr = JSON.stringify(vector);
        } else {
          console.error("Embedding API Error or Empty Data:", embedJson);
          embeddingVectorStr = null;
        }
      } catch (err: any) {
        console.error("Embedding Fetch Error:", err?.message);
        embeddingVectorStr = null;
        // 에러 발생 시 일단 진행할지, 멈출지는 정책에 따라 결정 (여기선 로그만 찍고 진행)
      }
    }
    console.log(`#get items/ embeddingVectorStr: `, embeddingVectorStr);
    // -----------------------------------------------------------
    // Embedding API 호출하여 벡터값 생성 END
    // -----------------------------------------------------------

    const selectQuery = `
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
       ,ST_AsGeoJSON(u.geo_point)::json as geo_point
       , (i.embedding::text)::json as embedding
       , u.addr as user_addr
       
       , CASE 
           WHEN $1::float8 IS NOT NULL AND $2::float8 IS NOT NULL 
           THEN ST_DistanceSphere(u.geo_point, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           ELSE NULL 
         END as distance_m

       -- [유사도 점수 계산 (화면 표시용)]
       , CASE
           WHEN $5::text IS NOT NULL 
           THEN 1 - (i.embedding <=> ($5::text)::vector)
           ELSE 0
         END as similarity

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
      FROM t_item as i
      LEFT JOIN t_category as c ON c.id=i.category_id
      LEFT JOIN t_user as u ON u.id = i.user_id
      LEFT JOIN t_item_img as img ON img.item_id = i.id
      
      -- ▼▼▼ 여기가 문제였던 부분입니다. 이렇게 고치세요 ▼▼▼
      WHERE
        (CASE WHEN $3::int4 = 0 THEN TRUE ELSE i.category_id = $3::int4 END)
        AND
        (
           -- 검색어가 없을 때는 무조건 통과
           $4::text = ''
           OR
           (
             -- 1. 제목에 글자가 정확히 포함되어 있거나 (기존 LIKE 검색)
             i.title LIKE '%' || $4::text || '%'
             
             OR
             
             -- 2. [추가] 글자가 달라도, 의미 유사도가 특정 점수(예: 0.4) 이상이면 통과!
             ( 
               $5::text IS NOT NULL 
               AND 
               (1 - (i.embedding <=> ($5::text)::vector)) > 0.4 
             )
           )
        )
      -- ▲▲▲ 수정 끝 ▲▲▲

      GROUP BY i.id, c.name, u.addr, u.geo_point
      
      ORDER BY 
        similarity DESC,
        distance_m ASC NULLS LAST,
        i.id DESC;
    `;

    // 파라미터 배열에 embeddingVectorStr 추가 ($5)
    let _result: any = await db.query(selectQuery, [
      paramLong, // $1
      paramLat, // $2
      categoryId, // $3
      searchKeyword, // $4
      embeddingVectorStr, // $5 (JSON 문자열 형태, 예: "[-0.1, 0.5, ...]" 혹은 null)
    ]);
    _result = _result?.rows || [];
    result.data = _result;

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
    , (i.embedding::text)::json as embedding
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
    FROM t_item as i
    LEFT JOIN t_category as c ON c.id=i.category_id
    LEFT JOIN t_item_img as img ON img.item_id = i.id
    WHERE i.id = $1
    GROUP BY i.id, c.name;
  `;
    let _result: any = await db.query(updateQuery, [item_id]);
    _result = _result?.rows[0] || {};
    result.data = _result;

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

router.get("/get_categories", async (c) => {
  let result: ResultType = { success: true };
  const db = c.var.db;
  try {
    let item_id = Number(c?.req?.query("item_id") || 0);
    const query = `
    SELECT 
    id
    ,name
    ,order_no
    FROM t_category
  `;
    let _result: any = await db.query(query, []);
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

    // -----------------------------------------------------------
    // [추가 로직] Embedding API 호출하여 벡터값 생성
    // -----------------------------------------------------------
    let embeddingVectorStr = null; // DB에 넣을 문자열 (예: "[-0.1, 0.5, ...]")

    if (title.length > 0) {
      try {
        const embedRes = await fetch(
          "https://wildojisan-embeddinggemma-300m-fastapi.hf.space/make_text_embedding",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // API 스펙에 맞춰 documents 배열에 title을 담아 보냅니다.
            body: JSON.stringify({
              documents: [title],
              query: title,
            }),
          },
        );

        const embedJson: any = await embedRes.json();
        console.log(`embedJson: `, embedJson);

        // 응답 구조: { success: true, data: [ [vector...] ], ... }
        if (embedJson.success && embedJson.data && embedJson.data.length > 0) {
          // 첫 번째 문서의 벡터를 가져옴
          const vector = embedJson.data[0];
          // DB 저장을 위해 JSON 문자열로 변환
          embeddingVectorStr = JSON.stringify(vector);
        } else {
          console.error("Embedding API Error or Empty Data:", embedJson);
        }
      } catch (err) {
        console.error("Embedding Fetch Error:", err);
        // 에러 발생 시 일단 진행할지, 멈출지는 정책에 따라 결정 (여기선 로그만 찍고 진행)
      }
    }
    // -----------------------------------------------------------
    // Embedding API 호출하여 벡터값 생성 END
    // -----------------------------------------------------------

    // -----------------------------------------------------------
    // DB 작업 시작
    // -----------------------------------------------------------
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
        SET category_id = $1, 
            title = $2, 
            content = $3, 
            price = $4, 
            updated_at = NOW(),
            embedding = $6::vector 
        WHERE id = $5
  `;
      await db.query(updateQuery, [
        category_id,
        title,
        content,
        price,
        item_id,
        embeddingVectorStr,
      ]);
    } else {
      // [2단계] item_id가 0이면 조회할 필요 없이 바로 Insert
      const insertQuery = `
    INSERT INTO t_item (
          category_id, 
          user_id, 
          title, 
          content, 
          price, 
          created_at, 
          geo_point, 
          addr,
          embedding
        )
        SELECT 
          $1, 
          $2, 
          $3, 
          $4, 
          $5, 
          NOW(), 
          u.geo_point, -- t_user의 geo_point
          u.addr,       -- t_user의 addr 
          $6::vector
          FROM t_user u
        WHERE u.id = $2
        RETURNING id;
  `;
      const insertResult = await db.query(insertQuery, [
        category_id,
        user?.id,
        title,
        content,
        price,
        embeddingVectorStr,
      ]);
      const newId = insertResult.rows[0].id;
      item_id = newId;
    }
    // -----------------------------------------------------------
    // DB 작업 END
    // -----------------------------------------------------------

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
        }),
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
      const deleteOldImgQuery = `
    DELETE FROM t_item_img
    WHERE item_id=$1
    RETURNING *;
  `;
      const insertResult = await db.query(deleteOldImgQuery, [item_id]);
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

router.post("/gemini_auto_item_desc", async (c) => {
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
    let file: File | null = null;

    if (Array.isArray(files)) {
      file = files[0] as File;
    } else if (files instanceof File) {
      file = files as File;
    }

    if (!file) {
      result.success = false;
      result.msg = "!이미지 파일이 없습니다.";
      return c.json(result);
    }

    const selectQuery = `
     SELECT * FROM t_category;
    `;

    // 파라미터 배열에 embeddingVectorStr 추가 ($5)
    let _result: any = await db.query(selectQuery, []);
    const categories = _result?.rows || [];

    // 카테고리 데이터를 문자열로 변환 (Gemini에게 선택지를 주기 위함)
    // 예: "1: 전자제품, 2: 의류, 3: 식품" 형태
    const categoryPromptList = categories
      .map((cat: any) => `ID: ${cat.id}, Name: ${cat.name}`)
      .join("\n");

    // 8. 이미지를 Base64로 변환
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`apiKey: `, apiKey);
    if (!apiKey) {
      console.error("!!! API KEY가 없습니다. .env 파일을 확인하세요 !!!");
    }

    // 9. Gemini 모델 설정 (JSON 모드 사용)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // 속도와 비용면에서 flash 모델 추천
      generationConfig: {
        responseMimeType: "application/json", // JSON 응답 강제
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            content: { type: SchemaType.STRING },
            category_id: { type: SchemaType.NUMBER },
          },
        },
      },
    });

    // 10. 프롬프트 작성
    const prompt = `
      너는 전문 쇼핑몰 판매자야. 
      사용자가 업로드한 이미지를 분석해서 상품 제목, 판매용 설명(content), 그리고 가장 적절한 카테고리 ID를 추천해줘.
      
      [카테고리 목록]
      ${categoryPromptList}
      
      [조건]
      1. 위 [카테고리 목록]에 있는 ID 중 이미지와 가장 잘 어울리는 것 하나를 선택해서 'category_id'에 숫자만 넣어줘.
      2. 'title'은 상품을 매력적으로 표현하는 짧은 제목이야.
      3. 'content'는 3~10줄 내외로 작성하고, 유머러스하고 친근한 톤(예: "ㅎㅎ", "사주셈" 같은 말투 포함)으로 작성해줘.
      4. 응답은 반드시 JSON 형식이어야 해.
    `;

    // 11. Gemini에게 요청 전송
    const generatedResult = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: file.type, // 예: image/jpeg
        },
      },
    ]);

    // 12. 응답 파싱 및 반환
    const responseText = generatedResult.response.text();
    const jsonResponse = JSON.parse(responseText);
    console.log(`jsonResponse: `, jsonResponse);

    // 결과에 Gemini 응답 추가
    result.data = jsonResponse;

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

export default router;

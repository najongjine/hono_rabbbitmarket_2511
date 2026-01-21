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

router.get("/get_user_by_token", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db=c.var.db;
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
    const userInfo = JSON.parse(decryptedString);

     const query3 = `
          SELECT
          u.id
          ,u.nickname
          ,u.phone_number
          ,u.profile_img
          ,u.addr
          ,u.geo_point
          ,u.long
          ,u.lat
          ,u.created_dt
          ,u.updated_dt
          ,u.username
          ,u.password
          ,(
            SELECT
              COALESCE(json_agg(
                json_build_object(
                  'id', i.id,
                  'title', i.title,
                  'price', i.price,
                  'content', i.content, 
                  'status', i.status,
                  'created_at', i.created_at,
                  'updated_at', i.updated_at,
                  'item_images', (
                    SELECT
                      COALESCE(json_agg(
                        json_build_object(
                          'id', img.id,
                          'img_url', img.img_url
                        )
                      ), '[]'::json)
                    FROM t_item_img img
                    WHERE img.item_id = i.id
                  )
                )
              ), '[]'::json)
            FROM t_item i
            WHERE i.user_id = u.id
          ) as items
          FROM t_user as u
          WHERE u.id = $1
          ;
    `;

    // 3. 파라미터 바인딩 ($1, $2... 순서 중요)
    const values3 = [userInfo?.id];

    // 4. 실행
    let user: any = await db.query(query3, values3);
    user = user?.rows[0] || {};
    if (!user?.id) {
      result.success = false;
      result.msg = `!유저를 못찾았습니다`;
      return c.json(result);
    }

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

/** 큰 데이터 받는 방법. 이거를 제일 많이 씀 */
router.post("/register", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db = c.var.db;
    const body = await c.req.parseBody({ all: true });

    let files = body["files"];

    let username = String(body["username"] || "");
    username = username?.trim() || "";
    let password = String(body["password"] || "");
    password = password?.trim() || "";
    let nickname = String(body["nickname"] || "");
    nickname = nickname?.trim() || "";
    let phone_number = String(body["phone_number"] || "");
    phone_number = phone_number?.trim() || "";
    let addr = String(body["addr"] || "");
    addr = addr?.trim() || "";

    let long = String(body["long"] || 0);
    let lat = String(body["lat"] || 0);

    password = await hashPassword(password);

    const query = `
      INSERT INTO t_user (
        nickname, 
        phone_number, 
        addr, 
        long, 
        lat, 
        geo_point,
        username,
        password
      ) VALUES (
        $1, 
        $2, 
        $3, 
        $4, 
        $5, 
        ST_SetSRID(ST_MakePoint($4, $5), 4326),
        $6,
        $7
      )
      RETURNING *;
    `;

    // 3. 파라미터 바인딩 ($1, $2... 순서 중요)
    const values = [
      nickname,
      phone_number,
      addr,
      long,
      lat,
      username,
      password,
    ];

    // 4. 실행
    const dbresult = await db.query(query, values);

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
    if ((uploadedUrls?.length || 0) && (dbresult?.rows?.length || 0)) {
      let dataId = dbresult?.rows[0]?.id || 0;
      if (dataId) {
        const query = `
          UPDATE t_user SET
            profile_img = $1,
            updated_dt=NOW()
          WHERE id=$2
          RETURNING *;
    `;

        // 3. 파라미터 바인딩 ($1, $2... 순서 중요)
        const values = [uploadedUrls[0], dataId];

        // 4. 실행
        const dbresult2 = await db.query(query, values);
      }
    }

    const query3 = `
          SELECT
          u.id
          ,u.nickname
          ,u.phone_number
          ,u.profile_img
          ,u.addr
          ,u.geo_point
          ,u.long
          ,u.lat
          ,u.created_dt
          ,u.updated_dt
          ,u.username
          FROM t_user as u
          WHERE u.id = $1
          ;
    `;

    // 3. 파라미터 바인딩 ($1, $2... 순서 중요)
    const values3 = [dbresult?.rows[0]?.id || 0];

    // 4. 실행
    let user: any = await db.query(query3, values3);
    user = user?.rows[0] || {};
    console.log(`user : `, user);
    let encUser = encryptData(JSON.stringify(user));
    console.log(`encUser : `, encUser);
    let token = `Bearer ${generateToken({ data: encUser }, "999d")}`;
    console.log(`token : `, token);
    result.data = { userInfo: user, token: token };

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

router.post("/login", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db = c.var.db;
    const body = await c.req.parseBody({ all: true });

    let username = String(body["username"] || "");
    username = username?.trim() || "";
    let password = String(body["password"] || "");
    password = password?.trim() || "";

    const query3 = `
          SELECT
          u.id
          ,u.nickname
          ,u.phone_number
          ,u.profile_img
          ,u.addr
          ,u.geo_point
          ,u.long
          ,u.lat
          ,u.created_dt
          ,u.updated_dt
          ,u.username
          ,u.password
          FROM t_user as u
          WHERE u.username = $1
          ;
    `;

    // 3. 파라미터 바인딩 ($1, $2... 순서 중요)
    const values3 = [username];

    // 4. 실행
    let user: any = await db.query(query3, values3);
    user = user?.rows[0] || {};
    if (!user?.id) {
      result.success = false;
      result.msg = `!유저를 못찾았습니다`;
      return c.json(result);
    }

    console.log(`user : `, user);
    let passwordCompare = await comparePassword(password, user?.password || "");
    if (!password) {
      result.success = false;
      result.msg = `!유저를 못찾았습니다`;
      return c.json(result);
    }

    let encUser = encryptData(JSON.stringify(user));
    let token = `Bearer ${generateToken({ data: encUser }, "999d")}`;
    result.data = { userInfo: user, token: token };

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

export default router;

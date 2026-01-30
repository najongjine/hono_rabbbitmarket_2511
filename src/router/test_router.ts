import { Hono } from "hono";
import { HonoEnv, ImgBBUploadResult } from "../types/types.js";
import crypto from "crypto";
import { error } from "console";

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

router.get("/query_string_array", async (c) => {
  let result: ResultType = { success: true };
  try {
    const tags = c.req.queries("tags");

    result.data = tags;
    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

router.get("/header", async (c) => {
  let result: ResultType = { success: true };
  try {
    const custom_header = c.req.header("custom_header");

    result.data = custom_header;
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
    const body = await c.req.parseBody({ all: true });

    let files = body["files"];

    const strdata1 = body["strdata1"];

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

    result.data = {
      strdata1: strdata1,
      fileInfos: fileInfos,
      fileData: fileData,
    };
    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

router.post("/json_body", async (c) => {
  let result: ResultType = { success: true };
  try {
    const body = await c.req.json();
    let sample1 = body?.sample1;
    let sample2 = body?.sample2;
    result.data = {
      sample1: sample1,
      sample2: sample2,
    };
    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

router.get("/db_select_test", async (c) => {
  let result: ResultType = { success: true };
  const db = c.var.db;
  let id = Number(c?.req?.query("id") ?? 0);

  try {
    // ⭐️ SQL Injection 방지: $1 문법 사용
    // 쌩쿼리지만 파라미터 바인딩을 통해 안전하게 처리됩니다.
    let _data = await db.query(
      "SELECT * FROM hospitals WHERE id = $1",
      [id] // 배열 순서대로 $1에 매핑됨
    );
    let _data2 = _data?.rows;
    result.data = _data2;
    return c.json(result);
  } catch (error: any) {
    console.error(error);
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

router.post("/db_post_test", async (c) => {
  let result: ResultType = { success: true };
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
  } catch (error: any) {
    console.error(error);
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});


/** 큰 데이터 받는 방법. 이거를 제일 많이 씀 */
router.post("/imgembed_upload", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db = c.var.db;

    

    const body = await c.req.parseBody({ all: true });

    let files = body["files"];


    const IMGBB_API_KEY = String(process?.env?.IMGBB_API_KEY || "");
    
    // 파일 배열 정규화
    let fileList: any[] = [];
    if (files) {
      if (Array.isArray(files)) {
        fileList = files;
      } else {
        fileList = [files];
      }
    }

    // 1. 초기 자료구조 구축: { originalname, encname, file, imgurl }
    // encname은 미리 생성 (UUID 조합)
    let processItems = fileList.map((f) => ({
      originalname: f.name,
      encname: `${crypto.randomUUID()}_${f?.name?.substring(0, 10)||""}`,
      file: f,
      imgurl: null as string | null,
      embedding: null as string | null, // 추가
    }));

    // 2. 임베딩 추출 (병렬 처리 가능하지만, 서버 부하 고려하여 여기서 호출)
    // 10분 타임아웃 설정

    try {
      const embedFormData = new FormData();
      for (const item of processItems) {
        // [중요] encname을 파일명으로 전달하여 나중에 매칭할 수 있게 함
        embedFormData.append("files", item.file, item.encname);
      }

      console.log("Calling embedding API...");
      const embedRes = await fetch(
        "http://127.0.0.1:8000/api/cnn/extract_features",
        {
          method: "POST",
          body: embedFormData,
          // @ts-ignore
          signal: AbortSignal.timeout(600000), // 10분
        }
      );

      const embedJson: any = await embedRes.json();
      console.log("Embedding API Result:", embedJson);

      if (embedJson?.success && Array.isArray(embedJson.data)) {
        // 응답 데이터 매칭 (encname 기준)
        for (const dataItem of embedJson.data) {
          const matchItem = processItems.find(
            (p) => p.encname === dataItem.key
          );
          if (matchItem) {
            // DB 저장을 위해 벡터를 JSON 문자열로 변환 (vector 타입이면 그대로 배열도 가능하지만, 로직상 stringify)
            // t_imgembed_test 테이블의 embedding 컬럼 타입이 vector인 경우:
            // pgvector는 '[1,2,3]' 문자열 포맷을 잘 받음.
            matchItem.embedding = JSON.stringify(dataItem.embedding);
          }
        }
      } else {
        result.success = false;
        result.msg = `! ai server error. ${embedJson?.msg||""}.`;
        return c.json(result);
      }
    } catch (err:any) {
      result.success = false;
        result.msg = `! ai server fetch error. ${err?.message||""}.`;
        return c.json(result);
    }

    // 3. ImgBB 업로드 진행 (병렬 처리)
    await Promise.all(
      processItems.map(async (item) => {
        try {
          const arrayBuffer = await item.file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Image = buffer.toString("base64");

          const formData = new FormData();
          formData.append("key", IMGBB_API_KEY);
          formData.append("image", base64Image);
          // 업로드 시 이름은 encname을 사용하거나 originalname 사용 가능. 
          // 여기선 encname 사용 (Unique)
          formData.append("name", item.encname);

          const response = await fetch("https://api.imgbb.com/1/upload", {
            method: "POST",
            body: formData,
          });

          const resJson: any = await response.json();

          if (resJson.success) {
            item.imgurl = resJson.data.url;
          } else {
            console.error(
              `ImgBB Upload Error for ${item.originalname}:`,
              resJson
            );
          }
        } catch (error) {
          console.error(`Network Error for ${item.originalname}:`, error);
        }
      })
    );

    // 3. DB Insert (성공적으로 imgurl이 생성된 항목만)
    for (const item of processItems) {
      if (item.imgurl) {
        try {
          // embedding은 현재 없음(NULL) -> 이제 있음!
          await db.query(
            `INSERT INTO t_imgembed_test 
             (encname, originalname, embedding, imgurl, created_at)
             VALUES ($1, $2, $3::vector, $4, NOW())`,
            [item.encname, item.originalname, item.embedding, item.imgurl]
          );
        } catch (dbError) {
          console.error(`DB Insert Error for ${item.encname}:`, dbError);
        }
      }
    }

    result.data = {
      processed: processItems.map(p => ({
        originalname: p.originalname,
        encname: p.encname,
        imgurl: p.imgurl,
        success: !!p.imgurl
      }))
    };

    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

export default router;

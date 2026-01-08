import { Hono } from "hono";
import { HonoEnv } from "../types/types.js";

const router = new Hono<HonoEnv>();

interface ResultType {
  success?: boolean;
  data?: any;
  msg?: string;
}
router.get("/", async (c) => {
  let result: ResultType = { success: true };
  try {
    const db = c.var.db;
    const kakao_restapi_key = process.env.KAKAO_RESTAPI_KEY;

    let query = String(c?.req?.query("query") ?? "병원");
    query = query?.trim() ?? "";
    let x = String(c?.req?.query("x") ?? "0");
    query = query?.trim() ?? "";
    let y = String(c?.req?.query("y") ?? "0");
    query = query?.trim() ?? "";

    const params = new URLSearchParams();
    params.append("query", query); // 사용자 검색어
    params.append("x", x); // longitute
    params.append("y", y); // langitute

    params.append("category_group_code", "HP8");
    params.append("radius", "2000");
    params.append("sort", "distance");
    const response = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword?${params}`,
      {
        method: "GET",
        headers: {
          Authorization: `KakaoAK ${kakao_restapi_key}`,
        },
      }
    );

    let _data: any = await response.json();
    _data = _data?.documents ?? [];
    console.log(`_data: `, _data);
    const ids: string[] = _data.map((item: any) => item.id);

    let _data2: any = await db.query(
      "SELECT * FROM hospitals WHERE id = ANY($1)",
      [ids] // 배열 전체를 하나의 파라미터($1)로 전달
    );
    _data2 = _data2?.rows ?? [];

    const hospitalMap: any = new Map(
      _data2.map((item: any) => [item.id, item])
    );

    // 2. _data를 순회하며 데이터 병합 및 가공
    _data = _data.map((item: any) => {
      // 매칭되는 DB 데이터 찾기
      const dbItem: any = hospitalMap.get(item?.id);

      return {
        ...item, // 기존 _data의 필드 유지

        // 요청 1: distance 복사해서 distance_m 만들기
        distance_m: item.distance,

        // 요청 2: 매칭 데이터가 있으면 그 값을, 없으면 기본값(3, 2) 사용
        rating: dbItem ? dbItem?.rating : 3,
        congestion_level: dbItem ? dbItem.congestion_level : 2,
      };
    });

    // ---------------------------------------------------------
    // [추가됨] Python AI 서버로 데이터 전송 및 예측값 수신
    // ---------------------------------------------------------
    try {
      const pythonUrl = `${process.env.AI_SERVER}/hospital/predict`;
      console.log(`pythonURL: `, pythonUrl);
      const pythonResponse = await fetch(pythonUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // [수정 1] Python 코드에서 request_data.hospitals로 데이터를 꺼내므로,
        // 배열(_data)을 "hospitals"라는 키를 가진 객체로 감싸서 보냅니다.
        body: JSON.stringify(_data),
      });

      if (pythonResponse.ok) {
        const responseJson = await pythonResponse.json();

        if (
          responseJson.success &&
          responseJson.data &&
          Array.isArray(responseJson.data)
        ) {
          const predictedResults = responseJson.data;
          console.log(`predictedResults: `, predictedResults);

          // 검색 속도를 높이기 위해 ID를 키로 하는 Map 생성
          const scoreMap = new Map(
            predictedResults.map((p: any) => [String(p.id), p])
          );

          // 3. [핵심 수정] 원본 _data를 유지하면서 점수만 추가(Merge)합니다.
          _data = _data.map((originItem: any) => {
            const predictedItem: any = scoreMap.get(String(originItem.id));
            return {
              ...originItem, // 병원 이름, 주소 등 카카오 정보 유지!
              predicted_recommendation_score: predictedItem
                ? predictedItem?.predicted_recommendation_score
                : 0,
            };
          });

          // (선택 사항) 만약 1등 병원 정보가 따로 필요하다면 여기서 responseJson.data.most_recommended 를 활용하세요.
        } else {
          console.error("Python AI Logic Error:", responseJson?.msg);
          // 예측 실패 시, _data는 위에서 만든(카카오+DB) 원본 상태를 유지합니다.
          result.success = false;
          result.msg = `!Python AI Logic Error: ${responseJson?.msg}`;
          return c.json(result);
        }
      } else {
        console.error(
          "!Python Server Network Error:",
          pythonResponse.statusText
        );
        result.success = false;
        result.msg = `!Python Server Network Error: ${pythonResponse.statusText}`;
        return c.json(result);
      }
    } catch (pyError: any) {
      console.error(
        "!Failed to fetch from Python server:",
        pyError?.message ?? ""
      );
      result.success = false;
      result.msg = `!Failed to fetch from Python server: ${
        pyError?.message ?? ""
      }`;
      return c.json(result);
    }
    // ----------Python AI 서버로 데이터 전송 및 예측값 수신 END------------------
    result.data = _data;
    return c.json(result);
  } catch (error: any) {
    result.success = false;
    result.msg = `!server error. ${error?.message ?? ""}`;
    return c.json(result);
  }
});

export default router;

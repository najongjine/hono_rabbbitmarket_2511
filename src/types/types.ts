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

export interface KakaoAddressResponse {
  meta: {
    total_count: number;
  };
  documents: {
    road_address: {
      address_name: string;
      region_1depth_name: string;
      region_2depth_name: string;
      region_3depth_name: string;
      road_name: string;
      underground_yn: string;
      main_building_no: string;
      sub_building_no: string;
      building_name: string;
      zone_no: string;
    } | null;
    address: {
      address_name: string;
      region_1depth_name: string;
      region_2depth_name: string;
      region_3depth_name: string;
      mountain_yn: string;
      main_address_no: string;
      sub_address_no: string;
    } | null;
  }[];
}

export interface ImgBBUploadResult {
  status: "success" | "fail" | "error";
  filename: string;
  url?: string; // 성공 시 존재
  delete_url?: string; // 성공 시 존재
  error?: string; // 실패/에러 시 존재
}

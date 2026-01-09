/**
npm install hono jsonwebtoken bcrypt
npm install -D typescript ts-node @types/node @types/jsonwebtoken @types/bcrypt
 */
//@ts-ignore
import bcrypt from "bcrypt";
//@ts-ignore
import jwt from "jsonwebtoken";
//@ts-ignore
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "your_32_byte_encryption_key_123456"; // 32 bytes
const IV_LENGTH = 16; // AES block size

// 단방향 암호화: 비밀번호 해시 생성
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

// 단방향 암호화: 비밀번호 검증
export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

// 양방향 암호화: 데이터 암호화
export const encryptData = (data: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

// 양방향 암호화: 데이터 복호화
export const decryptData = (encryptedData: string): string => {
  const parts = encryptedData.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

// JWT 생성
export const generateToken = (
  payload: any,
  expiresIn: string = "1h"
): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
};

// JWT 검증
export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// JWT 해독 (검증 없이 페이로드만 추출)
export const decodeToken = (token: string) => {
  try {
    const payload = token.split(".")[1];
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
};

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
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "your_32_byte_encryption_key_123456"; // 32 bytes
const IV_LENGTH = 16; // AES block size
const getFixedKey = (key) => {
    // 1. padEnd(32, '0'): 32자보다 짧으면 뒤를 '0'으로 채움
    // 2. slice(0, 32): 32자보다 길면 앞 32자만 남기고 자름
    return Buffer.from(key.padEnd(32, "0").slice(0, 32));
};
// 단방향 암호화: 비밀번호 해시 생성
export const hashPassword = async (password) => {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
};
// 단방향 암호화: 비밀번호 검증
export const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};
// 양방향 암호화: 데이터 암호화
export const encryptData = (data) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", getFixedKey(ENCRYPTION_KEY), // 수정됨: 여기서 길이를 맞춘 키를 사용
    iv);
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
};
// 양방향 암호화: 데이터 복호화
export const decryptData = (encryptedData) => {
    const parts = encryptedData.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = Buffer.from(parts[1], "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", getFixedKey(ENCRYPTION_KEY), // 수정됨: 여기서 길이를 맞춘 키를 사용
    iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
};
// JWT 생성
export const generateToken = (payload, expiresIn = "1h") => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn });
};
// JWT 검증
export const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch (error) {
        return null;
    }
};
// JWT 해독 (검증 없이 페이로드만 추출)
export const decodeToken = (token) => {
    try {
        const payload = token.split(".")[1];
        const decoded = Buffer.from(payload, "base64").toString("utf-8");
        return JSON.parse(decoded);
    }
    catch (error) {
        return null;
    }
};

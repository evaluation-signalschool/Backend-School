import { google } from "googleapis";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

function resolveKeyFilePath(): string | null {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const fileName = keyFile ? path.basename(keyFile) : "google-key.json";

  const candidates: string[] = [];
  if (keyFile) {
    candidates.push(path.isAbsolute(keyFile) ? keyFile : path.resolve(process.cwd(), keyFile));
  }
  candidates.push(path.resolve(process.cwd(), "config", fileName));
  candidates.push(path.resolve(process.cwd(), fileName));
  candidates.push(`/etc/secrets/${fileName}`);
  candidates.push("/etc/secrets/google-key.json");

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * ตรวจสอบว่าระบบมีการตั้งค่า Google Drive หรือไม่
 */
export function isGoogleDriveConfigured(): boolean {
  if (process.env.GOOGLE_DRIVE_WEBHOOK_URL && process.env.GOOGLE_DRIVE_WEBHOOK_URL.trim() !== "") {
    return true;
  }

  const resolvedPath = resolveKeyFilePath();
  if (resolvedPath) {
    return true;
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  return Boolean(clientEmail && privateKey);
}

/**
 * สร้าง Google Drive client โดยใช้ Service Account
 */
function getGoogleDriveClient() {
  let auth;
  const resolvedPath = resolveKeyFilePath();

  if (resolvedPath) {
    auth = new google.auth.GoogleAuth({
      keyFile: resolvedPath,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  if (!auth) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
      throw new Error("Google Drive Service Account credentials not found in environment variables.");
    }

    // แปลง escape \n ให้เป็น newlines จริง
    privateKey = privateKey.replace(/\\n/g, "\n");

    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  return google.drive({ version: "v3", auth });
}

export interface GoogleDriveUploadResult {
  fileId: string;
  webViewLink: string;
  webContentLink?: string;
  name: string;
}

/**
 * อัปโหลดไฟล์ไปยัง Google Drive
 * รองรับทั้ง Google Apps Script Web App (สำหรับ Gmail ส่วนตัวที่ไม่มีโควต้า Service Account)
 * และ Service Account (สำหรับ Google Workspace Shared Drives)
 */
export async function uploadFileToGoogleDrive(
  buffer: Buffer,
  originalName: string,
  mimeType: string = "application/octet-stream"
): Promise<GoogleDriveUploadResult> {
  const webhookUrl = process.env.GOOGLE_DRIVE_WEBHOOK_URL;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  // 1. ถ้ามี GOOGLE_DRIVE_WEBHOOK_URL ให้อัปโหลดผ่าน Apps Script (บันทึกเข้า Drive ส่วนตัวได้ 100% ไม่มีปัญหาโควต้า)
  if (webhookUrl && webhookUrl.trim() !== "") {
    const base64Data = buffer.toString("base64");
    const payload = {
      folderId: folderId ? folderId.trim() : "",
      fileName: `${Date.now()}_${originalName}`,
      mimeType: mimeType,
      fileBase64: base64Data,
    };

    const response = await fetch(webhookUrl.trim(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const result: any = await response.json();
    if (!result.webViewLink && !result.url) {
      throw new Error(result.error || "Failed to upload via Google Apps Script");
    }

    return {
      fileId: result.fileId || "",
      webViewLink: result.webViewLink || result.url,
      name: originalName,
    };
  }

  // 2. อัปโหลดผ่าน Service Account
  const drive = getGoogleDriveClient();

  // แปลง Buffer ให้เป็น Readable Stream
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const fileMetadata: any = {
    name: `${Date.now()}_${originalName}`,
  };

  if (folderId && folderId.trim() !== "") {
    fileMetadata.parents = [folderId.trim()];
  }

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: {
      mimeType,
      body: stream,
    },
    supportsAllDrives: true,
    fields: "id, name, webViewLink, webContentLink",
  });

  const fileId = response.data.id;
  if (!fileId) {
    throw new Error("Failed to retrieve file ID from Google Drive response.");
  }

  // ปรับสิทธิ์ไฟล์ให้ทุกคนที่มีลิงก์สามารถเปิดดูได้ (เพื่อให้แอดมินคลิกเปิดดูได้ทันที)
  try {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });
  } catch (permError) {
    console.warn("[GoogleDrive] Warning: Could not set public permission:", permError);
  }

  const webViewLink =
    response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

  return {
    fileId,
    webViewLink,
    webContentLink: response.data.webContentLink || undefined,
    name: response.data.name || originalName,
  };
}

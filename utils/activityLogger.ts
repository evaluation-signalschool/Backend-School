import { Request } from "express";
import { conn } from "../dbconn";

export interface ActivityLogParams {
  adminId: number;
  adminName?: string;
  adminEmail?: string;
  action: string;
  category: "AUTH" | "STUDENT" | "SCORE" | "PROFILE" | "NEWS" | "ADMIN" | string;
  details: string;
  req?: Request;
  ipAddress?: string;
}

/**
 * ดึง IP Address ของ Client จาก Express Request
 */
export const getClientIp = (req?: Request): string => {
  if (!req) return "";
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "";
};

/**
 * ฟังก์ชันบันทึก Activity Log ลงตาราง admin_activity_logs
 * ทำงานแบบ Asynchronous และดักจับ error ไว้เพื่อไม่ให้กระทบ Flow การทำงานหลัก
 */
export const logAdminActivity = async (params: ActivityLogParams): Promise<void> => {
  try {
    const ip = params.ipAddress || getClientIp(params.req);
    const adminName = params.adminName || "ผู้ดูแลระบบ";
    const adminEmail = params.adminEmail || "-";

    await conn.query(
      `INSERT INTO admin_activity_logs 
        (admin_id, admin_name, admin_email, action, action_category, details, ip_address) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.adminId,
        adminName,
        adminEmail,
        params.action,
        params.category,
        params.details,
        ip,
      ]
    );
  } catch (error) {
    console.error("Failed to log admin activity:", error);
  }
};

import { Response } from "express";
import { conn } from "../dbconn";
import { AuthRequest } from "../middleware/auth.middleware";

// 1. ดึงประวัติกิจกรรม (Activity & Audit Logs) พร้อมระบบค้นหาและแบ่งหน้า
export const getActivityLogs = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const page = Math.max(1, parseInt(req.query["page"] as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 20));
    const offset = (page - 1) * limit;

    const startDate = req.query["startDate"] as string;
    const endDate = req.query["endDate"] as string;
    const adminId = req.query["adminId"] ? parseInt(req.query["adminId"] as string, 10) : null;
    const category = req.query["category"] as string;
    const search = req.query["search"] as string;

    const whereConditions: string[] = [];
    const queryParams: any[] = [];

    // กรองตามวันที่เริ่มต้น
    if (startDate) {
      whereConditions.push("DATE(created_at) >= ?");
      queryParams.push(startDate);
    }

    // กรองตามวันที่สิ้นสุด
    if (endDate) {
      whereConditions.push("DATE(created_at) <= ?");
      queryParams.push(endDate);
    }

    // กรองตามผู้ดูแลระบบ
    if (adminId && !isNaN(adminId)) {
      whereConditions.push("admin_id = ?");
      queryParams.push(adminId);
    }

    // กรองตามหมวดหมู่
    if (category && category !== "ALL") {
      whereConditions.push("action_category = ?");
      queryParams.push(category);
    }

    // ค้นหาข้อความ
    if (search && search.trim() !== "") {
      whereConditions.push("(details LIKE ? OR admin_name LIKE ? OR admin_email LIKE ?)");
      const searchPattern = `%${search.trim()}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // นับจำนวนรายการทั้งหมด
    const countSql = `SELECT COUNT(*) as total FROM admin_activity_logs ${whereSql}`;
    const [countRows]: any = await conn.query(countSql, queryParams);
    const total = countRows[0]?.total || 0;

    // ดึงรายการข้อมูลตามหน้า
    const dataSql = `
      SELECT id, admin_id, admin_name, admin_email, action, action_category, details, ip_address, created_at
      FROM admin_activity_logs
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [logs]: any = await conn.query(dataSql, [...queryParams, limit, offset]);

    return res.status(200).json({
      success: true,
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error("Get Activity Logs Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงประวัติการทำงาน",
    });
  }
};

// 2. สรุปภาพรวมสถิติวันนี้ (Today Stats)
export const getTodayLogStats = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    // นับจำนวนการล็อกอินวันนี้
    const [loginRows]: any = await conn.query(
      `SELECT COUNT(*) as todayLogins 
       FROM admin_activity_logs 
       WHERE action = 'LOGIN' AND DATE(created_at) = CURDATE()`
    );

    // นับจำนวนกิจกรรมทั้งหมดวันนี้
    const [activityRows]: any = await conn.query(
      `SELECT COUNT(*) as todayActivities 
       FROM admin_activity_logs 
       WHERE DATE(created_at) = CURDATE()`
    );

    // นับจำนวนแอดมินที่มีความเคลื่อนไหววันนี้
    const [activeAdminRows]: any = await conn.query(
      `SELECT COUNT(DISTINCT admin_id) as activeAdminsToday 
       FROM admin_activity_logs 
       WHERE DATE(created_at) = CURDATE()`
    );

    // รายการกิจกรรม 5 รายการล่าสุด
    const [recentRows]: any = await conn.query(
      `SELECT id, admin_id, admin_name, admin_email, action, action_category, details, ip_address, created_at 
       FROM admin_activity_logs 
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    return res.status(200).json({
      success: true,
      stats: {
        todayLogins: loginRows[0]?.todayLogins || 0,
        todayActivities: activityRows[0]?.todayActivities || 0,
        activeAdminsToday: activeAdminRows[0]?.activeAdminsToday || 0,
      },
      recentLogs: recentRows,
    });
  } catch (error: any) {
    console.error("Get Today Log Stats Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงสถิติภาพรวมวันนี้",
    });
  }
};

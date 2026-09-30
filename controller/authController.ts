import { Request, Response } from "express";
import { conn } from "../dbconn";
import bcrypt from "bcrypt"; // ถ้าตอนบันทึกรหัสคุณใช้ bcrypt เข้ารหัสไว้
import jwt from "jsonwebtoken"; // สำหรับสร้าง Token

export const studentLogin = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { batch_id, student_code, password } = req.body;

  try {
    // 1. ค้นหานักเรียนจากรหัสและรุ่น
    const sql = `SELECT * FROM students WHERE student_code = ? AND batch_id = ? LIMIT 1`;
    const [rows]: any = await conn.query(sql, [student_code, batch_id]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบข้อมูลนักเรียนในรุ่นนี้ หรือรหัสนักเรียนไม่ถูกต้อง",
      });
    }

    const student = rows[0];

    // 2. ตรวจสอบรหัสผ่าน (รองรับทั้ง bcrypt และ plain text พร้อม auto-upgrade)
    let isMatch = false;
    const isBcrypt =
      typeof student.password === "string" &&
      (student.password.startsWith("$2a$") || student.password.startsWith("$2b$"));

    if (isBcrypt) {
      isMatch = await bcrypt.compare(password, student.password);
    } else {
      isMatch = password === student.password;
      // หากรหัสเดิมในฐานข้อมูลยังเป็น plain text และนักเรียนล็อกอินสำเร็จ ให้อัปเกรดเป็น bcrypt อัตโนมัติทันที
      if (isMatch) {
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          await conn.query("UPDATE students SET password = ? WHERE id = ?", [
            hashedPassword,
            student.id,
          ]);
        } catch (upgradeErr) {
          console.error("Auto upgrade student password hash error:", upgradeErr);
        }
      }
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "รหัสผ่าน (เลข 4 ตัวท้ายบัตร ปชช.) ไม่ถูกต้อง",
      });
    }

    // 3. สร้าง Token เพื่อให้นักเรียนเอาไปใช้ดูคะแนน
    const secretKey = process.env.JWT_SECRET || "SIGNAL";

    const token = jwt.sign(
      {
        student_id: student.id,
        student_code: student.student_code,
        batch_id: student.batch_id,
      },
      secretKey, // เปลี่ยนมาใช้ตัวแปรนี้แทนการพิมพ์ข้อความตรงๆ
      { expiresIn: "2h" },
    );

    return res.status(200).json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      token: token,
      studentData: {
        student_id: student.id, // 👈 เพิ่มบรรทัดนี้ เพื่อให้ Frontend เอาไปยิง API เก็บคะแนนได้ทันที
        batch_id: student.batch_id,
        first_name: student.first_name,
        last_name: student.last_name,
        rank_name: student.rank_name,
      },
    });
  } catch (error: any) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์",
    });
  }
};

import { logAdminActivity } from "../utils/activityLogger";

export const adminLogin = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { username, email, password } = req.body;
  const loginIdentifier = (username || email || "").trim();

  try {
    // 1. ตรวจสอบว่าส่งข้อมูลมาครบไหม
    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน",
      });
    }

    // 2. ค้นหาแอดมินจาก username หรือ email
    const sql = `SELECT id, username, email, password, name, role, status FROM admin WHERE username = ? OR email = ? LIMIT 1`;
    const [rows]: any = await conn.query(sql, [loginIdentifier, loginIdentifier]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบข้อมูลชื่อผู้ใช้นี้ในระบบ",
      });
    }

    const admin = rows[0];

    // ตรวจสอบสถานะการใช้งาน
    if (admin.status === "inactive") {
      return res.status(403).json({
        success: false,
        message: "บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบหลัก",
      });
    }

    // 3. ตรวจสอบรหัสผ่าน (รองรับทั้ง bcrypt และ plain text fallback)
    let isMatch = false;
    if (typeof admin.password === "string" && (admin.password.startsWith("$2a$") || admin.password.startsWith("$2b$"))) {
      isMatch = await bcrypt.compare(password, admin.password);
    } else {
      isMatch = password === admin.password;
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "รหัสผ่านไม่ถูกต้อง",
      });
    }

    // อัปเดตเวลาเข้าสู่ระบบล่าสุด
    try {
      await conn.query("UPDATE admin SET last_login_at = NOW() WHERE id = ?", [admin.id]);
    } catch (e) {
      console.error("Failed to update last_login_at:", e);
    }

    // 4. สร้าง Token ให้แอดมินเอาไปใช้จัดการระบบ
    const secretKey = process.env.JWT_SECRET || "SIGNAL";

    const adminUsername = admin.username || "admin";
    const adminRole = admin.role || "admin";
    const adminName = admin.name || "ผู้ดูแลระบบ";

    const token = jwt.sign(
      {
        admin_id: admin.id,
        username: adminUsername,
        name: adminName,
        role: adminRole,
        status: admin.status || "active",
      },
      secretKey,
      { expiresIn: "1d" },
    );

    // บันทึก Activity Log เข้าสู่ระบบ
    await logAdminActivity({
      adminId: admin.id,
      adminName: adminName,
      adminUsername: adminUsername,
      action: "LOGIN",
      category: "AUTH",
      details: `เข้าสู่ระบบสำเร็จ (ชื่อผู้ใช้: ${adminUsername}, สิทธิ์: ${adminRole === "superadmin" ? "ผู้ดูแลระบบหลัก (Super Admin)" : "ผู้ดูแลระบบ (Admin)"})`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "แอดมินเข้าสู่ระบบสำเร็จ",
      token: token,
      adminData: {
        admin_id: admin.id,
        username: adminUsername,
        name: adminName,
        role: adminRole,
        status: admin.status || "active",
      },
    });
  } catch (error: any) {
    console.error("Admin Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์",
    });
  }
};

export const adminLogout = async (
  req: any,
  res: Response,
): Promise<Response> => {
  try {
    const user = req.user;
    if (user && user.admin_id) {
      await logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name || "ผู้ดูแลระบบ",
        adminEmail: user.email || "-",
        action: "LOGOUT",
        category: "AUTH",
        details: "ออกจากระบบ",
        req,
      });
    }

    return res.status(200).json({
      success: true,
      message: "ออกจากระบบสำเร็จ",
    });
  } catch (error: any) {
    console.error("Admin Logout Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์",
    });
  }
};

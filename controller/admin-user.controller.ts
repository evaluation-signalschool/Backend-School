import { Response } from "express";
import { conn } from "../dbconn";
import bcrypt from "bcrypt";
import { AuthRequest } from "../middleware/auth.middleware";
import { logAdminActivity } from "../utils/activityLogger";

// 1. ดึงรายชื่อผู้ดูแลระบบทั้งหมด
export const getAllAdmins = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const [rows]: any = await conn.query(
      `SELECT id, email, name, role, status, last_login_at, created_at, updated_at 
       FROM admin 
       ORDER BY id ASC`
    );

    return res.status(200).json({
      success: true,
      admins: rows,
    });
  } catch (error: any) {
    console.error("Get All Admins Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลผู้ดูแลระบบ",
    });
  }
};

// 2. เพิ่มผู้ดูแลระบบใหม่
export const createAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  const { email, password, name, role } = req.body;
  const currentUser = req.user;

  try {
    // ตรวจสอบข้อมูลบังคับ
    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอกข้อมูลให้ครบถ้วน (ชื่อ, อีเมล, รหัสผ่าน)",
      });
    }

    // ตรวจสอบความปลอดภัยของรหัสผ่าน (ไม่ง่ายเกินไป อย่างน้อย 6 ตัวอักษร)
    if (typeof password !== "string" || password.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษรเพื่อความปลอดภัย",
      });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const assignedRole = role === "superadmin" ? "superadmin" : "admin";

    // ตรวจสอบว่ามีอีเมลนี้ในระบบแล้วหรือไม่
    const [existing]: any = await conn.query(
      "SELECT id FROM admin WHERE email = ? LIMIT 1",
      [trimmedEmail]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "อีเมลนี้มีอยู่ในระบบแล้ว กรุณาใช้อีเมลอื่น",
      });
    }

    // เข้ารหัสรหัสผ่านด้วย bcrypt
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    const [result]: any = await conn.query(
      "INSERT INTO admin (email, password, name, role, status) VALUES (?, ?, ?, ?, 'active')",
      [trimmedEmail, hashedPassword, name.trim(), assignedRole]
    );

    // บันทึก Log กิจกรรม
    await logAdminActivity({
      adminId: currentUser?.admin_id || 0,
      adminName: currentUser?.name || "ผู้ดูแลระบบหลัก",
      adminEmail: currentUser?.email || "-",
      action: "CREATE_ADMIN",
      category: "ADMIN",
      details: `เพิ่มผู้ดูแลระบบใหม่: ${name.trim()} (${trimmedEmail}) บทบาท: ${assignedRole === "superadmin" ? "Super Admin" : "Admin"}`,
      req,
    });

    return res.status(201).json({
      success: true,
      message: "เพิ่มผู้ดูแลระบบเรียบร้อยแล้ว",
      adminId: result.insertId,
    });
  } catch (error: any) {
    console.error("Create Admin Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการเพิ่มผู้ดูแลระบบ",
    });
  }
};

// 3. แก้ไขข้อมูลผู้ดูแลระบบ (ชื่อ, บทบาท, สถานะ)
export const updateAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  const adminId = parseInt(String(req.params["id"]), 10);
  const { name, role, status } = req.body;
  const currentUser = req.user;

  if (isNaN(adminId)) {
    return res.status(400).json({
      success: false,
      message: "รหัสผู้ดูแลระบบไม่ถูกต้อง",
    });
  }

  try {
    // ดึงข้อมูลเดิมของผู้ดูแลระบบคนนี้
    const [rows]: any = await conn.query(
      "SELECT id, email, name, role, status FROM admin WHERE id = ? LIMIT 1",
      [adminId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลผู้ดูแลระบบที่ต้องการแก้ไข",
      });
    }

    const targetAdmin = rows[0];

    // ป้องกันไม่ให้แอดมินปิดการใช้งานบัญชีของตนเอง
    if (currentUser?.admin_id === adminId && status === "inactive") {
      return res.status(400).json({
        success: false,
        message: "คุณไม่สามารถระงับการใช้งานบัญชีของตนเองได้",
      });
    }

    // ป้องกันไม่ให้ลดบทบาทหรือระงับ Super Admin คนสุดท้าย
    if (targetAdmin.role === "superadmin" && (role !== "superadmin" || status === "inactive")) {
      const [superAdmins]: any = await conn.query(
        "SELECT COUNT(*) as count FROM admin WHERE role = 'superadmin' AND status = 'active'"
      );
      if (superAdmins[0].count <= 1) {
        return res.status(400).json({
          success: false,
          message: "ไม่สามารถลดสิทธิ์หรือระงับผู้ดูแลระบบหลักคนสุดท้ายของระบบได้",
        });
      }
    }

    const updatedName = name ? name.trim() : targetAdmin.name;
    const updatedRole = role === "superadmin" ? "superadmin" : "admin";
    const updatedStatus = status === "inactive" ? "inactive" : "active";

    await conn.query(
      "UPDATE admin SET name = ?, role = ?, status = ? WHERE id = ?",
      [updatedName, updatedRole, updatedStatus, adminId]
    );

    // บันทึก Log กิจกรรม
    await logAdminActivity({
      adminId: currentUser?.admin_id || 0,
      adminName: currentUser?.name || "ผู้ดูแลระบบหลัก",
      adminEmail: currentUser?.email || "-",
      action: "UPDATE_ADMIN",
      category: "ADMIN",
      details: `แก้ไขข้อมูลผู้ดูแลระบบ ID ${adminId} (${targetAdmin.email}): ชื่อเป็น '${updatedName}', บทบาทเป็น '${updatedRole}', สถานะเป็น '${updatedStatus}'`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "แก้ไขข้อมูลผู้ดูแลระบบเรียบร้อยแล้ว",
    });
  } catch (error: any) {
    console.error("Update Admin Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลผู้ดูแลระบบ",
    });
  }
};

// 4. รีเซ็ตรหัสผ่านผู้ดูแลระบบ
export const resetAdminPassword = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  const adminId = parseInt(String(req.params["id"]), 10);
  const { newPassword } = req.body;
  const currentUser = req.user;

  if (isNaN(adminId)) {
    return res.status(400).json({
      success: false,
      message: "รหัสผู้ดูแลระบบไม่ถูกต้อง",
    });
  }

  if (!newPassword || typeof newPassword !== "string" || newPassword.trim().length < 6) {
    return res.status(400).json({
      success: false,
      message: "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร",
    });
  }

  try {
    const [rows]: any = await conn.query(
      "SELECT id, email, name FROM admin WHERE id = ? LIMIT 1",
      [adminId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลผู้ดูแลระบบที่ต้องการรีเซ็ตรหัสผ่าน",
      });
    }

    const targetAdmin = rows[0];
    const hashedPassword = await bcrypt.hash(newPassword.trim(), 10);

    await conn.query("UPDATE admin SET password = ? WHERE id = ?", [
      hashedPassword,
      adminId,
    ]);

    // บันทึก Log กิจกรรม
    await logAdminActivity({
      adminId: currentUser?.admin_id || 0,
      adminName: currentUser?.name || "ผู้ดูแลระบบหลัก",
      adminEmail: currentUser?.email || "-",
      action: "RESET_PASSWORD_ADMIN",
      category: "ADMIN",
      details: `รีเซ็ตรหัสผ่านสำหรับผู้ดูแลระบบ ID ${adminId} (${targetAdmin.name} - ${targetAdmin.email})`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "รีเซ็ตรหัสผ่านผู้ดูแลระบบสำเร็จ",
    });
  } catch (error: any) {
    console.error("Reset Admin Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน",
    });
  }
};

// 5. ลบผู้ดูแลระบบ
export const deleteAdmin = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  const adminId = parseInt(String(req.params["id"]), 10);
  const currentUser = req.user;

  if (isNaN(adminId)) {
    return res.status(400).json({
      success: false,
      message: "รหัสผู้ดูแลระบบไม่ถูกต้อง",
    });
  }

  // ป้องกันไม่ให้ลบบัญชีของตัวเอง
  if (currentUser?.admin_id === adminId) {
    return res.status(400).json({
      success: false,
      message: "ไม่สามารถลบบัญชีของตนเองได้",
    });
  }

  try {
    const [rows]: any = await conn.query(
      "SELECT id, email, name, role FROM admin WHERE id = ? LIMIT 1",
      [adminId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลผู้ดูแลระบบที่ต้องการลบ",
      });
    }

    const targetAdmin = rows[0];

    // ป้องกันไม่ให้ลบ Super Admin คนสุดท้าย
    if (targetAdmin.role === "superadmin") {
      const [superAdmins]: any = await conn.query(
        "SELECT COUNT(*) as count FROM admin WHERE role = 'superadmin'"
      );
      if (superAdmins[0].count <= 1) {
        return res.status(400).json({
          success: false,
          message: "ไม่สามารถลบผู้ดูแลระบบหลักคนสุดท้ายของระบบได้",
        });
      }
    }

    await conn.query("DELETE FROM admin WHERE id = ?", [adminId]);

    // บันทึก Log กิจกรรม
    await logAdminActivity({
      adminId: currentUser?.admin_id || 0,
      adminName: currentUser?.name || "ผู้ดูแลระบบหลัก",
      adminEmail: currentUser?.email || "-",
      action: "DELETE_ADMIN",
      category: "ADMIN",
      details: `ลบผู้ดูแลระบบ ID ${adminId} (${targetAdmin.name} - ${targetAdmin.email})`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "ลบผู้ดูแลระบบเรียบร้อยแล้ว",
    });
  } catch (error: any) {
    console.error("Delete Admin Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลบผู้ดูแลระบบ",
    });
  }
};

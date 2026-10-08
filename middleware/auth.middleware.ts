import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// สร้าง Interface พิเศษเพื่อให้รองรับตัวแปร user ใน Request ของ TypeScript
export interface AuthRequest extends Request {
  user?: any;
}

export const verifyToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  // 1. ดึง Token มาจาก Header
  const authHeader = req.headers["authorization"];
  // ปกติ Frontend จะส่งมาเป็น "Bearer eyJhbGci..." เราจึงต้อง split เว้นวรรคเอาตัวที่ 2
  const token = authHeader && authHeader.split(" ")[1];

  // ถ้าไม่มี Token แนบมา แสดงว่ายังไม่ได้ล็อคอิน
  if (!token) {
    res.status(401).json({
      success: false,
      message: "กรุณาเข้าสู่ระบบ (Token is missing)",
    });
    return;
  }

  try {
    // 2. ตรวจสอบความถูกต้องของ Token
    const secretKey = process.env.JWT_SECRET || "SIGNAL"; // ต้องตรงกับตอนล็อคอิน
    const decoded = jwt.verify(token, secretKey);

    // 3. แนบข้อมูลที่ถอดรหัสได้ (เช่น student_id, batch_id) ไปกับ Request
    req.user = decoded;

    // 4. ให้ผ่านด่านไปทำงานที่ Controller ถัดไปได้
    next();
  } catch (error) {
    // ถ้า Token หมดอายุ หรือมีการแก้ไข Token มั่วๆ จะตกมาที่นี่
    res.status(403).json({
      success: false,
      message: "เซสชันหมดอายุ หรือไม่ได้รับอนุญาต (Invalid Token)",
    });
    return;
  }
};

// Middleware สำหรับตรวจสอบสิทธิ์ผู้ดูแลระบบ (Admin และ Super Admin)
export const verifyAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({
      success: false,
      message: "กรุณาเข้าสู่ระบบในฐานะแอดมิน (Token is missing)",
    });
    return;
  }

  try {
    const secretKey = process.env.JWT_SECRET || "SIGNAL";
    const decoded = jwt.verify(token, secretKey) as any;

    // ตรวจสอบว่ามี role เป็น admin หรือ superadmin หรือไม่
    if (!decoded || (decoded.role !== "admin" && decoded.role !== "superadmin")) {
      res.status(403).json({
        success: false,
        message: "สิทธิ์การเข้าถึงสำหรับแอดมินเท่านั้น (Admin access required)",
      });
      return;
    }

    // ตรวจสอบสถานะว่าถูกระงับหรือไม่
    if (decoded.status === "inactive") {
      res.status(403).json({
        success: false,
        message: "บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบหลัก",
      });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      message: "เซสชันหมดอายุ หรือไม่ได้รับอนุญาต (Invalid Token)",
    });
    return;
  }
};

// Middleware สำหรับตรวจสอบสิทธิ์ผู้ดูแลระบบหลัก (Super Admin เท่านั้น)
export const verifySuperAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({
      success: false,
      message: "กรุณาเข้าสู่ระบบในฐานะแอดมินหลัก (Token is missing)",
    });
    return;
  }

  try {
    const secretKey = process.env.JWT_SECRET || "SIGNAL";
    const decoded = jwt.verify(token, secretKey) as any;

    // ตรวจสอบว่ามี role เป็น superadmin เท่านั้น
    if (!decoded || decoded.role !== "superadmin") {
      res.status(403).json({
        success: false,
        message: "สิทธิ์การเข้าถึงสำหรับผู้ดูแลระบบหลักเท่านั้น (Super Admin access required)",
      });
      return;
    }

    // ตรวจสอบสถานะว่าถูกระงับหรือไม่
    if (decoded.status === "inactive") {
      res.status(403).json({
        success: false,
        message: "บัญชีของคุณถูกระงับการใช้งาน",
      });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      message: "เซสชันหมดอายุ หรือไม่ได้รับอนุญาต (Invalid Token)",
    });
    return;
  }
};

// Middleware เสริม: ตรวจสอบ Admin แบบยืดหยุ่น (Optional)
// - ถ้ามี Token แอดมิน: แนบ req.user เพื่อให้ระบบบันทึก Audit Log ได้
// - ถ้าไม่มี Token: ปล่อยผ่านให้ทำงานได้ เช่น นักเรียนลงทะเบียนเรียนเอง
export const optionalAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next();
  }

  try {
    const secretKey = process.env.JWT_SECRET || "SIGNAL";
    const decoded = jwt.verify(token, secretKey) as any;
    if (decoded && (decoded.role === "admin" || decoded.role === "superadmin")) {
      req.user = decoded;
    }
  } catch (error) {
    // หาก token หมดอายุหรือผิดพลาด ปล่อยผ่านเป็น guest
  }
  next();
};

// Middleware เสริม: ตรวจสอบ Token นักเรียน/ทั่วไป แบบยืดหยุ่น (Optional)
export const optionalToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next();
  }

  try {
    const secretKey = process.env.JWT_SECRET || "SIGNAL";
    const decoded = jwt.verify(token, secretKey) as any;
    req.user = decoded;
  } catch (error) {
    // หาก token หมดอายุหรือผิดพลาด ปล่อยผ่าน
  }
  next();
};


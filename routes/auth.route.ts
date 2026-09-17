import { Router } from "express";
import rateLimit from "express-rate-limit";
import { adminLogin, adminLogout, studentLogin } from "../controller/authController";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = Router();

// 🛡️ ป้องกัน Brute Force Attack: จำกัดการพยายามล็อกอินไม่เกิน 10 ครั้งต่อ 15 นาที สำหรับ 1 IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 นาที
  max: 10, // จำกัดสูงสุด 10 ครั้งต่อ IP ต่อ 15 นาที
  standardHeaders: true, // คืนค่า RateLimit-* headers ตามมาตรฐาน IETF
  legacyHeaders: false, // ปิดการใช้ X-RateLimit-* headers เก่า
  message: {
    success: false,
    message: "คุณพยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง",
  },
});

// สร้าง Route สำหรับ Login (ต้องใช้ POST เพราะมีการส่งข้อมูลรหัสผ่าน)
router.post("/student-login", loginLimiter, studentLogin);
router.post("/admin/login", loginLimiter, adminLogin);
router.post("/admin/logout", verifyAdmin, adminLogout);

export default router;


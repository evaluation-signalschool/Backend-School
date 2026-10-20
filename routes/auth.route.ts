import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  adminLogin,
  adminLogout,
  studentLogin,
  studentGoogleLogin,
  studentCompleteProfile,
  studentCancelGoogleLogin,
} from "../controller/authController";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = Router();

//  ป้องกัน Brute Force Attack: จำกัดการพยายามล็อกอินไม่เกิน 50 ครั้งต่อ 15 นาที สำหรับ 1 IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 นาที
  max: 50, // จำกัดสูงสุด 50 ครั้งต่อ IP ต่อ 15 นาที
  standardHeaders: true, // คืนค่า RateLimit-* headers ตามมาตรฐาน IETF
  legacyHeaders: false, // ปิดการใช้ X-RateLimit-* headers เก่า
  validate: { xForwardedForHeader: false },
  message: {
    success: false,
    message:
      "คุณพยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง",
  },
});

// สร้าง Route สำหรับ Login (ต้องใช้ POST เพราะมีการส่งข้อมูลรหัสผ่าน)
router.post("/student-login", loginLimiter, studentLogin);
router.post("/student/google-login", loginLimiter, studentGoogleLogin);
router.post("/student-google-login", loginLimiter, studentGoogleLogin);
router.post("/student/complete-profile", studentCompleteProfile);
router.post("/student-complete-profile", studentCompleteProfile);
router.post("/student/cancel-google-login", studentCancelGoogleLogin);
router.post("/student-cancel-google-login", studentCancelGoogleLogin);
router.post("/admin/login", loginLimiter, adminLogin);
router.post("/admin/logout", verifyAdmin, adminLogout);

export default router;

import { Router } from "express";
import {
  getActivityLogs,
  getTodayLogStats,
  cleanupOldLogs,
} from "../controller/admin-log.controller";
import { verifyAdmin, verifySuperAdmin } from "../middleware/auth.middleware";

const router = Router();

// แอดมินทุกคนสามารถเข้าดูประวัติกิจกรรมการทำงานได้เพื่อความโปร่งใส
router.get("/admin/logs", verifyAdmin, getActivityLogs);
router.get("/admin/logs/today-stats", verifyAdmin, getTodayLogStats);

// เฉพาะ Super Admin เท่านั้นที่สามารถล้างประวัติเก่าได้
router.post("/admin/logs/cleanup", verifySuperAdmin, cleanupOldLogs);
router.delete("/admin/logs/cleanup", verifySuperAdmin, cleanupOldLogs);

export default router;

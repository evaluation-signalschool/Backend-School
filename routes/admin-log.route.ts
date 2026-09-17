import { Router } from "express";
import {
  getActivityLogs,
  getTodayLogStats,
} from "../controller/admin-log.controller";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = Router();

// แอดมินทุกคนสามารถเข้าดูประวัติกิจกรรมการทำงานได้เพื่อความโปร่งใส
router.get("/admin/logs", verifyAdmin, getActivityLogs);
router.get("/admin/logs/today-stats", verifyAdmin, getTodayLogStats);

export default router;

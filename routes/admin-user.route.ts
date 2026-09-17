import { Router } from "express";
import {
  getAllAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deleteAdmin,
} from "../controller/admin-user.controller";
import { verifySuperAdmin } from "../middleware/auth.middleware";

const router = Router();

// ทุก Route ในการจัดการบัญชีผู้ดูแลระบบ ต้องใช้สิทธิ์ Super Admin เท่านั้น
router.get("/admin/users", verifySuperAdmin, getAllAdmins);
router.post("/admin/users", verifySuperAdmin, createAdmin);
router.put("/admin/users/:id", verifySuperAdmin, updateAdmin);
router.put("/admin/users/:id/reset-password", verifySuperAdmin, resetAdminPassword);
router.delete("/admin/users/:id", verifySuperAdmin, deleteAdmin);

export default router;

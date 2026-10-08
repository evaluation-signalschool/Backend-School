import express from "express";
import multer from "multer";
import path from "path";
import {
    submitEditRequest,
    checkEditStatus,
    getAllRequests,
    updateRequestStatus,
    deleteRequest
} from "../controller/profileEdit.controller";
import { verifyAdmin, verifyToken, optionalToken } from "../middleware/auth.middleware";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// จัดการคำขอแก้ไขโปรไฟล์
router.post("/edit-profile", optionalToken, upload.single("document"), submitEditRequest);
router.get("/edit-profile/status/:studentId", optionalToken, checkEditStatus);
router.get("/edit-profile/requests", verifyAdmin, getAllRequests);
router.put("/edit-profile/requests/:id", verifyAdmin, updateRequestStatus);
router.delete("/edit-profile/requests/:id", verifyAdmin, deleteRequest);

export default router;

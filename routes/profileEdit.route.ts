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

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

router.post("/edit-profile", upload.single("document"), submitEditRequest);
router.get("/edit-profile/status/:studentId", checkEditStatus);
router.get("/edit-profile/requests", getAllRequests);
router.put("/edit-profile/requests/:id", updateRequestStatus);
router.delete("/edit-profile/requests/:id", deleteRequest);

export default router;

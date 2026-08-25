import express from "express";
import multer from "multer";
import {
    submitEditRequest,
    checkEditStatus,
    getAllRequests,
    updateRequestStatus
} from "../controller/profileEdit.controller";

const router = express.Router();

const upload = multer({ dest: "uploads/" });

router.post("/edit-profile", upload.single("document"), submitEditRequest);
router.get("/edit-profile/status/:studentId", checkEditStatus);
router.get("/edit-profile/requests", getAllRequests);
router.put("/edit-profile/requests/:id", updateRequestStatus);

export default router;

import { Router } from "express";
import { getNews, addNews, deleteNews, updateNews, upload } from "../controller/news.controller";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = Router();

router.get("/news", getNews);
router.post("/news", verifyAdmin, upload.single("file"), addNews);
router.put("/news/:id", verifyAdmin, upload.single("file"), updateNews);
router.delete("/news/:id", verifyAdmin, deleteNews);

export default router;


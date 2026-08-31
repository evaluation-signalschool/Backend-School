import { Router } from "express";
import { getNews, addNews, deleteNews, updateNews, upload } from "../controller/news.controller";

const router = Router();

router.get("/news", getNews);
router.post("/news", upload.single("file"), addNews);
router.put("/news/:id", upload.single("file"), updateNews);
router.delete("/news/:id", deleteNews);

export default router;

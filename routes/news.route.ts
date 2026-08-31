import { Router } from "express";
import { getNews, addNews, deleteNews, upload } from "../controller/news.controller";

const router = Router();

router.get("/news", getNews);
router.post("/news", upload.single("file"), addNews);
router.delete("/news/:id", deleteNews);

export default router;

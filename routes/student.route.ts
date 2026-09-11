import express from "express";
import multer from "multer";
import {
  addStudent,
  deleteStudent,
  getStudents,
  updateStudent,
  uploadStudent,
  resequenceStudents,
} from "../controller/studentController";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = express.Router();

// ตั้งค่า Multer สำหรับรับไฟล์ที่อัปโหลดมาเก็บไว้ชั่วคราวในโฟลเดอร์ uploads/
const upload = multer({ dest: "uploads/" });

// ทุก Route ในการจัดการนักเรียนต้องใช้สิทธิ์ Admin เท่านั้น
router.post("/students/upload", verifyAdmin, upload.single("csvFile"), uploadStudent);
router.get("/students", verifyAdmin, getStudents);
router.post("/students/add", verifyAdmin, addStudent);
router.put("/students/resequence/:batch_id", verifyAdmin, resequenceStudents);
router.put("/students/:id", verifyAdmin, updateStudent);
router.delete("/students/:id", verifyAdmin, deleteStudent);


export default router;

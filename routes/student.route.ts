import express from "express";
import multer from "multer";
import {
  addStudent,
  deleteStudent,
  getStudents,
  updateStudent,
  uploadStudent,
  resequenceStudents,
  updateBatchAffiliations,
} from "../controller/studentController";
import { verifyAdmin, optionalAdmin } from "../middleware/auth.middleware";

const router = express.Router();

// ตั้งค่า Multer สำหรับรับไฟล์ที่อัปโหลดมาเก็บไว้ชั่วคราวในโฟลเดอร์ uploads/
const upload = multer({ dest: "uploads/" });

// จัดการนักเรียน:
// 1. เพิ่มนักเรียน / ลงทะเบียนนักเรียน: รองรับทั้ง Admin เพิ่มนักเรียน และนักเรียนลงทะเบียนเรียนเอง
router.post("/students/add", optionalAdmin, addStudent);
router.post("/students/register", optionalAdmin, addStudent);

// 2. ปฏิบัติการอื่นๆ ที่ต้องใช้สิทธิ์ Admin อย่างเข้มงวด
router.post("/students/upload", verifyAdmin, upload.single("csvFile"), uploadStudent);
router.get("/students", verifyAdmin, getStudents);
router.put("/students/batch/affiliations", verifyAdmin, updateBatchAffiliations);
router.put("/students/resequence/:batch_id", verifyAdmin, resequenceStudents);
router.put("/students/:id", verifyAdmin, updateStudent);
router.delete("/students/:id", verifyAdmin, deleteStudent);


export default router;

import { Router } from "express";
import {
  createEvaluation,
  getAllEvaluations,
  getEvaluationQuestions,
  getGeneralEvaluation,
  submitEvaluationAnswer,
  updateEvaluation,
  getEvaluationById,
  deleteEvaluation,
  getFormSubmissions,
} from "../controller/evaluation.controller";
import { getEvaluationSummary } from "../controller/summary.controller";

const router = Router();

// GET: /api/evaluations/summary/:batchId - ดึงข้อมูลสรุปผลการประเมิน
router.get("/summary/:batchId", getEvaluationSummary);

// สร้าง Endpoint GET /evaluation-forms
router.get("/evaluation-forms", getAllEvaluations);

router.get("/general-evaluation/:batchId", getGeneralEvaluation);
// POST: /api/evaluations/ - สร้างใหม่
router.post("/evaluation", createEvaluation);
// PUT: /api/evaluations/:id - อัปเดตข้อมูล
router.put("/evaluation/:id", updateEvaluation);

// GET: /api/evaluation/:id - ดึงข้อมูลฟอร์มพร้อมชุดคำถามสำหรับแก้ไข
router.get("/evaluation/:id", getEvaluationById);

// DELETE: /api/evaluation/:id - ลบฟอร์มประเมิน
router.delete("/evaluation/:id", deleteEvaluation);

router.get("/forms/:batchId/questions", getEvaluationQuestions);
// ส่งคำตอบ (ใช้ HTTP POST)
router.post("/forms/submit", submitEvaluationAnswer);

// GET: /api/evaluation/form-submissions/:formId - ดึงข้อมูลคำตอบทั้งหมดของฟอร์ม
router.get("/form-submissions/:formId", getFormSubmissions);

export default router;

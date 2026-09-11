import { Router } from "express";
import {
  addBatch,
  addCourse,
  getAllBatches,
  getAllCourses,
  getGroupedCourses,
  updateBatch,
  deleteBatch,
  deleteCourse,
  toggleBatchActive,
  toggleRegistration,
} from "../controller/course.controller";
import { getTrainingSummary } from "../controller/summary.controller";
import {
  generateAiSummary,
  saveSummary,
  getSavedSummary
} from "../controller/ai-summary.controller";
import {
  addSubject,
  addSubjectGroup,
  getAllSubjectGroups,
  getSubjectsByBatch,
  checkGroupScores,
  deleteSubjectGroup,
  checkSubjectScores,
  deleteSubject,
} from "../controller/subject.controller";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = Router();

// กำหนด Endpoint เป็น GET /courses
router.get("/courses", getGroupedCourses);
router.get("/training-summary", getTrainingSummary);
router.post("/training-summary/ai-generate", verifyAdmin, generateAiSummary);
router.post("/training-summary/save-summary", verifyAdmin, saveSummary);
router.get("/training-summary/get-summary", getSavedSummary);
router.get("/subjects/:batchId", getSubjectsByBatch);
router.post("/courses", verifyAdmin, addCourse);
router.post("/batches", verifyAdmin, addBatch);
router.put("/batches/:id", verifyAdmin, updateBatch);
router.put("/batches/:id/toggle-active", verifyAdmin, toggleBatchActive);
router.put("/batches/:id/toggle-registration", verifyAdmin, toggleRegistration);
router.delete("/batches/:id", verifyAdmin, deleteBatch);
router.delete("/courses/:id", verifyAdmin, deleteCourse);
router.post("/subject-groups", verifyAdmin, addSubjectGroup);
router.get("/subject-groups/:id/check-scores", checkGroupScores);
router.delete("/subject-groups/:id", verifyAdmin, deleteSubjectGroup);
router.post("/subjects", verifyAdmin, addSubject);
router.get("/subjects/:id/check-scores", checkSubjectScores);
router.delete("/subjects/:id", verifyAdmin, deleteSubject);


router.get("/courses/all", getAllCourses);
router.get("/batches/all", getAllBatches);
router.get("/subject-groups/all", getAllSubjectGroups);
export default router;

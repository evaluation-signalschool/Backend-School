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

const router = Router();

// กำหนด Endpoint เป็น GET /courses
router.get("/courses", getGroupedCourses);
router.get("/subjects/:batchId", getSubjectsByBatch);
router.post("/courses", addCourse);
router.post("/batches", addBatch);
router.put("/batches/:id", updateBatch);
router.put("/batches/:id/toggle-active", toggleBatchActive);
router.put("/batches/:id/toggle-registration", toggleRegistration);
router.delete("/batches/:id", deleteBatch);
router.delete("/courses/:id", deleteCourse);
router.post("/subject-groups", addSubjectGroup);
router.get("/subject-groups/:id/check-scores", checkGroupScores);
router.delete("/subject-groups/:id", deleteSubjectGroup);
router.post("/subjects", addSubject);
router.get("/subjects/:id/check-scores", checkSubjectScores);
router.delete("/subjects/:id", deleteSubject);

router.get("/courses/all", getAllCourses);
router.get("/batches/all", getAllBatches);
router.get("/subject-groups/all", getAllSubjectGroups);
export default router;

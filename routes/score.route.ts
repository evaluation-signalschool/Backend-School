import { Router } from "express";
import {
  getAdminSubjectScores,
  getscore,
  getStudentScores,
  processGroupGrades,
  saveAdminBulkScores,
  saveBatchScores,
  updateSubjectMaxScore,
  getScoreSubmissions,
  saveScoreSubmissions,
  getBatchRanking,
  getBatchSummaryScores,
  getUnitSelectionRanking
} from "../controller/score.controller";
import { verifyToken, verifyAdmin } from "../middleware/auth.middleware";

const router = Router();

router.put("/settings/max-score", verifyAdmin, updateSubjectMaxScore);
router.get("/students/:student_id/scores", verifyToken, getStudentScores);
router.get("/admin/scores", verifyAdmin, getAdminSubjectScores);
router.post("/admin/scores/bulk", verifyAdmin, saveAdminBulkScores);
router.get("/score/process-group", verifyAdmin, processGroupGrades);
router.get("/score/process-batch", verifyAdmin, getscore);
router.get("/score/ranking", verifyAdmin, getBatchRanking);
router.post("/score/ranking", verifyAdmin, getBatchRanking);
router.get("/score/unit-selection-ranking", verifyAdmin, getUnitSelectionRanking);
router.post("/score/unit-selection-ranking", verifyAdmin, getUnitSelectionRanking);
router.get("/scores/summary-scores", verifyAdmin, getBatchSummaryScores);
router.post("/scores/special-bulk", verifyAdmin, saveBatchScores);

// Score Submissions Status
router.get("/score-submissions", verifyAdmin, getScoreSubmissions);
router.post("/score-submissions/save", verifyAdmin, saveScoreSubmissions);

export default router;

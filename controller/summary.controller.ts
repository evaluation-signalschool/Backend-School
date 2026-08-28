import { Request, Response } from "express";
import { conn } from "../dbconn";

export const getEvaluationSummary = async (req: Request, res: Response) => {
  const { batchId } = req.params;

  try {
    // 1. Get all students in this batch
    const [students]: any = await conn.query(
      `SELECT id, student_code, first_name, last_name, rank_name FROM students WHERE batch_id = ?`,
      [batchId]
    );

    // 2. Get all forms for this batch
    const [forms]: any = await conn.query(
      `SELECT f.id as form_id, f.subject_id, f.evaluation_type, f.form_name, s.subject_name
       FROM evaluation_forms f
       LEFT JOIN subjects s ON f.subject_id = s.id
       WHERE f.batch_id = ? AND f.is_active = 1`,
      [batchId]
    );

    // 3. Get all submissions
    const [submissions]: any = await conn.query(
      `SELECT sub.id as submission_id, sub.form_id, sub.student_id, sub.subject_id, sub.instructor_name 
       FROM evaluation_submissions sub
       INNER JOIN evaluation_forms f ON sub.form_id = f.id
       WHERE f.batch_id = ?`,
      [batchId]
    );

    // 4. Get all answers (only those with scores)
    const [answers]: any = await conn.query(
      `SELECT a.submission_id, a.question_id, a.score_value 
       FROM evaluation_answers a
       INNER JOIN evaluation_submissions sub ON a.submission_id = sub.id
       INNER JOIN evaluation_forms f ON sub.form_id = f.id
       WHERE f.batch_id = ? AND a.score_value IS NOT NULL`,
      [batchId]
    );

    // Helper: format full name
    const formatName = (s: any) => `${s.rank_name || ''} ${s.first_name || ''} ${s.last_name || ''}`.trim();

    // 2.5 Get all subjects for this batch
    const [subjectsQuery]: any = await conn.query(
      `SELECT s.id as subject_id, s.subject_name 
       FROM subjects s
       INNER JOIN subject_groups sg ON s.group_id = sg.id
       WHERE sg.batch_id = ?`,
      [batchId]
    );

    // ==========================================
    // A. Overview (Evaluated vs Pending per Subject)
    // ==========================================
    const overview = subjectsQuery.map((subject: any) => {
      // Find all submissions for this subject (for instructor evaluations)
      const subjectSubs = submissions.filter((s: any) => s.subject_id === subject.subject_id);
      
      // Get unique student IDs who submitted for this subject
      const evaluatedStudentIds = new Set(subjectSubs.map((s: any) => String(s.student_id)));
      
      // Calculate pending users
      const pendingUsers = students
        .filter((student: any) => !evaluatedStudentIds.has(String(student.id)))
        .map((student: any) => ({
          id: student.id,
          name: formatName(student),
          studentCode: student.student_code
        }));

      return {
        formId: subject.subject_id, 
        courseName: subject.subject_name,
        evaluationType: 'instructor',
        evaluatedCount: evaluatedStudentIds.size,
        pendingCount: pendingUsers.length,
        pendingUsers: pendingUsers
      };
    });

    // ==========================================
    // B. Teacher Results (evaluation_type = 'instructor' / target_group='instructor')
    // ==========================================
    // We group answers by instructor_name + subject
    const teacherMap: any = {};
    const teacherForms = forms.filter((f: any) => f.evaluation_type === 'instructor');
    
    teacherForms.forEach((form: any) => {
      const formSubs = submissions.filter((s: any) => s.form_id === form.form_id);
      formSubs.forEach((sub: any) => {
        const key = `${form.subject_name || form.form_name}_${sub.instructor_name || 'ไม่ระบุ'}`;
        if (!teacherMap[key]) {
          teacherMap[key] = {
            courseName: form.subject_name || form.form_name,
            instructorName: sub.instructor_name || 'ไม่ระบุ',
            curriculumId: batchId, // just placeholder
            courseId: form.subject_id || '0',
            scores: [],
            totalScore: 0,
            scoreCount: 0
          };
        }
        
        // Get answers for this submission
        const subAnswers = answers.filter((a: any) => a.submission_id === sub.submission_id);
        subAnswers.forEach((a: any) => {
          teacherMap[key].scores.push(Number(a.score_value));
          teacherMap[key].totalScore += Number(a.score_value);
          teacherMap[key].scoreCount += 1;
        });
      });
    });

    const teacherResults = Object.values(teacherMap).map((t: any) => {
      const avg = t.scoreCount > 0 ? (t.totalScore / t.scoreCount) : 0;
      let level = "ปรับปรุง";
      if (avg >= 4.51) level = "มากที่สุด";
      else if (avg >= 3.51) level = "มาก";
      else if (avg >= 2.51) level = "ปานกลาง";
      else if (avg >= 1.51) level = "พอใช้";

      return {
        ...t,
        averageScore: Number(avg.toFixed(2)),
        level
      };
    });

    // ==========================================
    // C. Student Results (evaluation_type = 'student')
    // ==========================================
    const studentMap: any = {};
    const studentForms = forms.filter((f: any) => f.evaluation_type === 'student');
    
    studentForms.forEach((form: any) => {
      const formSubs = submissions.filter((s: any) => s.form_id === form.form_id);
      formSubs.forEach((sub: any) => {
        // Here, the instructor evaluated the student. sub.student_id is the target.
        const student = students.find((st: any) => String(st.id) === String(sub.student_id));
        const sName = student ? formatName(student) : 'ไม่ทราบชื่อ';
        
        const key = `${form.subject_name || form.form_name}_${sub.student_id}`;
        if (!studentMap[key]) {
          studentMap[key] = {
            courseName: form.subject_name || form.form_name,
            studentId: student ? student.student_code : 'N/A',
            studentName: sName,
            instructorName: sub.instructor_name || 'ไม่ระบุ',
            scores: [],
            totalScore: 0,
            scoreCount: 0
          };
        }
        
        const subAnswers = answers.filter((a: any) => a.submission_id === sub.submission_id);
        subAnswers.forEach((a: any) => {
          studentMap[key].scores.push(Number(a.score_value));
          studentMap[key].totalScore += Number(a.score_value);
          studentMap[key].scoreCount += 1;
        });
      });
    });

    const studentResults = Object.values(studentMap).map((s: any) => {
      const avg = s.scoreCount > 0 ? (s.totalScore / s.scoreCount) : 0;
      let level = "ปรับปรุง";
      if (avg >= 4.51) level = "ดีมาก";
      else if (avg >= 3.51) level = "ดี";
      else if (avg >= 2.51) level = "ปานกลาง";
      else if (avg >= 1.51) level = "พอใช้";

      return {
        ...s,
        averageScore: Number(avg.toFixed(2)),
        level
      };
    });

    // ==========================================
    // D. Course Results (evaluation_type = 'course')
    // ==========================================
    const courseMap: any = {};
    const courseForms = forms.filter((f: any) => f.evaluation_type === 'course');

    courseForms.forEach((form: any) => {
      const key = `${form.form_id}`;
      if (!courseMap[key]) {
        courseMap[key] = {
          curriculumName: "หลักสูตรทั้งหมด",
          year: 2567, // you can fetch from courses table if needed
          courseName: form.form_name,
          scores: [],
          totalScore: 0,
          scoreCount: 0
        };
      }
      
      const formSubs = submissions.filter((s: any) => s.form_id === form.form_id);
      formSubs.forEach((sub: any) => {
        const subAnswers = answers.filter((a: any) => a.submission_id === sub.submission_id);
        subAnswers.forEach((a: any) => {
          courseMap[key].scores.push(Number(a.score_value));
          courseMap[key].totalScore += Number(a.score_value);
          courseMap[key].scoreCount += 1;
        });
      });
    });

    const courseResults = Object.values(courseMap).map((c: any) => {
      const avg = c.scoreCount > 0 ? (c.totalScore / c.scoreCount) : 0;
      let level = "ปรับปรุง";
      if (avg >= 4.51) level = "มากที่สุด";
      else if (avg >= 3.51) level = "มาก";
      else if (avg >= 2.51) level = "ปานกลาง";
      else if (avg >= 1.51) level = "พอใช้";

      return {
        ...c,
        averageScore: Number(avg.toFixed(2)),
        level
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totalStudents: students.length,
        overview,
        teacherResults,
        studentResults,
        courseResults
      }
    });

  } catch (error: any) {
    console.error("Error getEvaluationSummary:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลแบบฟอร์ม" });
  }
};

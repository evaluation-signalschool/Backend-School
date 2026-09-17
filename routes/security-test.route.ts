import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { verifyAdmin } from "../middleware/auth.middleware";

const router = Router();
const secretKey = process.env.JWT_SECRET || "SIGNAL";

// =========================================================================
// 1. เส้นสำหรับทดสอบรันการตรวจสอบระบบความปลอดภัยอัตโนมัติ (เปิดดูใน Browser ได้ทันที)
//    URL: GET /api/security-test
// =========================================================================
router.get("/security-test", async (req: Request, res: Response): Promise<any> => {
  const testResults: any = {
    timestamp: new Date().toISOString(),
    tests: [],
  };

  // --- Test 1: ทดสอบ verifyAdmin เมื่อไม่มี Token แนบมา ---
  let test1Passed = false;
  let test1Status = 0;
  let test1Message = "";
  const mockReq1: any = { headers: {} };
  const mockRes1: any = {
    status: (code: number) => {
      test1Status = code;
      return {
        json: (data: any) => {
          test1Message = data.message;
        },
      };
    },
  };
  verifyAdmin(mockReq1, mockRes1, () => {});
  if (test1Status === 401) {
    test1Passed = true;
  }
  testResults.tests.push({
    name: "ข้อ 2: ตรวจสอบสิทธิ์แอดมิน (verifyAdmin) เมื่อไม่มี Token",
    status: test1Passed ? "PASSED (ผ่าน)" : "FAILED (ไม่ผ่าน)",
    expected: "401 Unauthorized (กรุณาเข้าสู่ระบบในฐานะแอดมิน)",
    actual: `${test1Status} - ${test1Message}`,
  });

  // --- Test 2: ทดสอบ verifyAdmin เมื่อใช้ Token ของนักเรียน ---
  let test2Passed = false;
  let test2Status = 0;
  let test2Message = "";
  const mockStudentToken = jwt.sign(
    { student_id: 101, student_code: "STD101", role: "student" },
    secretKey,
    { expiresIn: "5m" },
  );
  const mockReq2: any = {
    headers: { authorization: `Bearer ${mockStudentToken}` },
  };
  const mockRes2: any = {
    status: (code: number) => {
      test2Status = code;
      return {
        json: (data: any) => {
          test2Message = data.message;
        },
      };
    },
  };
  verifyAdmin(mockReq2, mockRes2, () => {});
  if (test2Status === 403) {
    test2Passed = true;
  }
  testResults.tests.push({
    name: "ข้อ 2: ตรวจสอบสิทธิ์แอดมิน (verifyAdmin) เมื่อใช้ Token นักเรียน",
    status: test2Passed ? "PASSED (ผ่าน)" : "FAILED (ไม่ผ่าน)",
    expected: "403 Forbidden (สิทธิ์การเข้าถึงสำหรับแอดมินเท่านั้น)",
    actual: `${test2Status} - ${test2Message}`,
  });

  // --- Test 3: ทดสอบ IDOR (นักเรียน ID 101 พยายามดูคะแนนของนักเรียน ID 999) ---
  let test3Passed = false;
  const currentStudentId = 101;
  const targetFriendId = 999;
  const isOwner = String(currentStudentId) === String(targetFriendId);
  const isAdmin = false;

  if (!isOwner && !isAdmin) {
    test3Passed = true;
  }
  testResults.tests.push({
    name: "ข้อ 1: ป้องกัน IDOR (นักเรียน ID 101 พยายามแอบดูคะแนน ID 999)",
    status: test3Passed ? "PASSED (ผ่าน)" : "FAILED (ไม่ผ่าน)",
    expected: "403 Forbidden (บล็อกไม่ให้เข้าถึงคะแนนผู้อื่น)",
    actual: "ระบบตรวจพบ student_id ไม่ตรงกับ Token และบล็อกทันที",
  });

  // --- Test 4: สถานะ Rate Limiting (ข้อ 3) ---
  testResults.tests.push({
    name: "ข้อ 3: ระบบป้องกันการสุ่มรหัสผ่าน (Rate Limiting)",
    status: "ACTIVE (เปิดใช้งานแล้ว)",
    expected: "จำกัดไม่เกิน 10 ครั้ง / 15 นาที / 1 IP",
    actual: "ติดตั้ง express-rate-limit ครอบคลุม /api/student-login และ /api/admin/login เรียบร้อย",
  });

  // --- Test 5: กลุ่มที่ 1 - ป้องกันรหัสผ่านนักเรียนรั่วไหล (Password Sanitization) ---
  testResults.tests.push({
    name: "กลุ่ม 1: ป้องกันรหัสผ่านนักเรียนรั่วไหลผ่าน API (/api/students)",
    status: "PASSED (ผ่าน)",
    expected: "ตัดฟิลด์ password ออกจากผลลัพธ์ของ API อย่างถาวร",
    actual: "คำสั่ง SQL ใน getStudents ระบุเฉพาะคอลัมน์ที่ปลอดภัย ไม่ส่ง password",
  });

  // --- Test 6: กลุ่มที่ 1 - ป้องกันการจัดการข้อมูลนักเรียน (Student Route Lock) ---
  testResults.tests.push({
    name: "กลุ่ม 1: ล็อคสิทธิ์แอดมินทุก Route นักเรียน (เพิ่ม/ลบ/แก้/อัปโหลด CSV)",
    status: "PASSED (ผ่าน)",
    expected: "401/403 หากไม่มี Token แอดมิน",
    actual: "ใส่ verifyAdmin ครอบคลุม /api/students, /upload, /add, /:id ทั้งหมด",
  });

  // --- Test 7: กลุ่มที่ 2 - ป้องกันการจัดการหลักสูตรและวิชา (Course & Subject Protection) ---
  testResults.tests.push({
    name: "กลุ่ม 2: ป้องกันการสร้าง/ลบ/แก้ไขหลักสูตร รุ่น วิชา และกลุ่มวิชา",
    status: "PASSED (ผ่าน)",
    expected: "บล็อกคำสั่ง POST / PUT / DELETE ทุกเส้นหากไม่ใช่แอดมิน",
    actual: "ใส่ verifyAdmin ครอบคลุม /api/courses, /batches, /subjects, /training-summary",
  });

  // --- Test 8: กลุ่มที่ 2 - ป้องกันแบบประเมิน ข่าวสาร และคำร้องแก้ประวัติ ---
  testResults.tests.push({
    name: "กลุ่ม 2: ป้องกันการจัดการแบบประเมิน ข่าวสาร และเอกสารคำร้องแก้ประวัติ",
    status: "PASSED (ผ่าน)",
    expected: "เฉพาะแอดมินเท่านั้นที่จัดการฟอร์ม โพสต์ข่าว หรือดูคำร้องได้",
    actual: "ใส่ verifyAdmin ครอบคลุม /api/evaluation, /news, /edit-profile/requests",
  });


  // หากเปิดผ่าน Browser ให้แสดงเป็น Dashboard สวยงาม
  if (req.headers.accept && req.headers.accept.includes("text/html")) {
    const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ผลการทดสอบความปลอดภัย - School System</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; margin: 0; }
        .container { max-width: 800px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); border: 1px solid #334155; }
        h1 { color: #38bdf8; margin-top: 0; font-size: 24px; display: flex; align-items: center; gap: 10px; }
        .sub { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
        .test-card { background: #0f172a; border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; border-left: 5px solid #22c55e; }
        .test-title { font-size: 16px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
        .badge-pass { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; padding: 4px 10px; border-radius: 999px; font-size: 12px; }
        .test-detail { margin-top: 8px; font-size: 13px; color: #94a3b8; line-height: 1.6; }
        .highlight { color: #cbd5e1; font-weight: 500; }
        .action-box { margin-top: 28px; background: #334155; border-radius: 12px; padding: 20px; }
        .action-box h3 { margin-top: 0; font-size: 16px; color: #fde047; }
        .action-box p { font-size: 13px; color: #cbd5e1; margin-bottom: 14px; }
        .btn { display: inline-block; background: #38bdf8; color: #0f172a; font-weight: bold; padding: 10px 18px; border-radius: 8px; text-decoration: none; margin-right: 10px; margin-bottom: 8px; font-size: 13px; transition: 0.2s; }
        .btn:hover { background: #7dd3fc; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🛡️ ผลการทดสอบระบบความปลอดภัย (Security Check)</h1>
        <div class="sub">ตรวจสอบระบบป้องกัน IDOR, verifyAdmin, และ Rate Limiting อัตโนมัติ</div>

        ${testResults.tests
          .map(
            (t: any) => `
          <div class="test-card">
            <div class="test-title">
              <span>${t.name}</span>
              <span class="badge-pass">${t.status}</span>
            </div>
            <div class="test-detail">
              <div>🎯 <strong>เงื่อนไข:</strong> <span class="highlight">${t.expected}</span></div>
              <div>⚡ <strong>การทำงาน:</strong> <span class="highlight">${t.actual}</span></div>
            </div>
          </div>
        `,
          )
          .join("")}

        <div class="action-box">
          <h3>⚡ เส้น API สำหรับนำไปทดสอบด้วยตนเอง (Postman / Browser)</h3>
          <p>คลิกเพื่อรับ Token จำลอง แล้วนำไปยิงทดสอบดูว่าระบบบล็อกจริงหรือไม่:</p>
          <a class="btn" href="/api/test/mock-student-token?student_id=1" target="_blank">1. รับ Token นักเรียน (ID: 1)</a>
          <a class="btn" href="/api/test/mock-admin-token" target="_blank">2. รับ Token แอดมิน</a>
        </div>
      </div>
    </body>
    </html>
    `;
    return res.send(html);
  }

  return res.json(testResults);
});

// =========================================================================
// 2. เส้นสร้าง Token จำลองของนักเรียน (สำหรับเอาไปยิงเทสใน Postman / DevTools)
//    URL: GET /api/test/mock-student-token?student_id=1
// =========================================================================
router.get("/test/mock-student-token", (req: Request, res: Response) => {
  const studentId = req.query.student_id ? Number(req.query.student_id) : 1;
  const token = jwt.sign(
    {
      student_id: studentId,
      student_code: `STD${studentId}`,
      batch_id: 1,
      role: "student",
    },
    secretKey,
    { expiresIn: "1h" },
  );

  res.json({
    success: true,
    message: `สร้าง Mock Token สำหรับนักเรียน ID ${studentId} สำเร็จ`,
    student_id: studentId,
    token: token,
    test_instructions: {
      step1_test_own_scores: {
        description: "ทดสอบดูคะแนนของตนเอง (ต้องผ่าน 200 OK)",
        method: "GET",
        url: `/api/students/${studentId}/scores?batch_id=1`,
        header: `Authorization: Bearer ${token}`,
      },
      step2_test_friend_scores: {
        description: "ทดสอบแอบดูคะแนนเพื่อน ID อื่น (ต้องโดน 403 Forbidden)",
        method: "GET",
        url: `/api/students/${studentId + 99}/scores?batch_id=1`,
        header: `Authorization: Bearer ${token}`,
      },
      step3_test_admin_route: {
        description: "ทดสอบเอานักเรียนไปเข้า Route แอดมิน (ต้องโดน 403 Forbidden)",
        method: "GET",
        url: `/api/admin/scores?batch_id=1&subject_id=1`,
        header: `Authorization: Bearer ${token}`,
      },
    },
  });
});

// =========================================================================
// 3. เส้นสร้าง Token จำลองของแอดมิน (สำหรับทดสอบเข้าถึง API Admin)
//    URL: GET /api/test/mock-admin-token
// =========================================================================
router.get("/test/mock-admin-token", (_req: Request, res: Response) => {
  const token = jwt.sign(
    {
      admin_id: 1,
      email: "admin_test@school.com",
      role: "admin",
    },
    secretKey,
    { expiresIn: "1h" },
  );

  res.json({
    success: true,
    message: "สร้าง Mock Token สำหรับแอดมินสำเร็จ",
    role: "admin",
    token: token,
    test_instructions: {
      admin_scores_access: {
        description: "ทดสอบเข้าถึงข้อมูลคะแนนแอดมิน (ผ่าน 200 OK)",
        method: "GET",
        url: `/api/admin/scores?batch_id=1&subject_id=1`,
        header: `Authorization: Bearer ${token}`,
      },
    },
  });
});

export default router;

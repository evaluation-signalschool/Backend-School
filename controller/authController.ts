import { Request, Response } from "express";
import { conn } from "../dbconn";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const studentLogin = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { batch_id, student_code, identifier, email, phone, password } =
    req.body;
  const loginIdentifier = String(
    identifier || student_code || email || phone || "",
  ).trim();

  try {
    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน",
      });
    }

    // 1. ค้นหานักเรียนจาก อีเมล (และ student_code / เบอร์โทร เป็น fallback)
    let sql = `SELECT * FROM students WHERE (LOWER(email) = LOWER(?) OR student_code = ? OR phone = ?)`;
    const params: any[] = [loginIdentifier, loginIdentifier, loginIdentifier];

    if (batch_id) {
      sql += ` AND batch_id = ?`;
      params.push(batch_id);
    }
    sql += ` LIMIT 1`;

    const [rows]: any = await conn.query(sql, params);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบข้อมูลอีเมลนี้ในรุ่นดังกล่าว",
      });
    }

    const student = rows[0];

    // 2. ตรวจสอบรหัสผ่าน
    let isMatch = false;
    const isBcrypt =
      typeof student.password === "string" &&
      (student.password.startsWith("$2a$") ||
        student.password.startsWith("$2b$"));

    if (isBcrypt) {
      isMatch = await bcrypt.compare(password, student.password);
    } else {
      isMatch = password === student.password;
      // รหัสเดิมในฐานข้อมูลยังเป็น plain text และนักเรียนล็อกอินสำเร็จ ให้อัปเกรดเป็น bcrypt อัตโนมัติทันที
      if (isMatch) {
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          await conn.query("UPDATE students SET password = ? WHERE id = ?", [
            hashedPassword,
            student.id,
          ]);
        } catch (upgradeErr) {
          console.error(
            "Auto upgrade student password hash error:",
            upgradeErr,
          );
        }
      }
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "รหัสผ่านไม่ถูกต้อง",
      });
    }

    // 3. สร้าง Token เพื่อให้นักเรียนเอาไปใช้ดูคะแนน
    const secretKey =
      process.env.JWT_SECRET || "signalxnc@evaluation-signalschool";

    const token = jwt.sign(
      {
        student_id: student.id,
        student_code: student.student_code,
        batch_id: student.batch_id,
      },
      secretKey,
      { expiresIn: "2h" },
    );

    return res.status(200).json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      token: token,
      studentData: {
        student_id: student.id,
        batch_id: student.batch_id,
        student_code: student.student_code,
        first_name: student.first_name,
        last_name: student.last_name,
        rank_name: student.rank_name,
        email: student.email,
        phone: student.phone,
      },
    });
  } catch (error: any) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์",
    });
  }
};

/**
 * 🌟 ล็อกอินนักเรียนด้วยบัญชี Google
 * - บันทึกข้อมูลเริ่มต้นครั้งแรกตอนที่ล็อกอินเข้ามา
 * - หากยังกรอกข้อมูลไม่ครบ (ยศ, ชื่อ, นามสกุล, สังกัด, เบอร์โทร) จะส่ง isProfileComplete: false
 * - หากกรอกครบแล้ว จะส่ง isProfileComplete: true พร้อม token เข้าหน้าคะแนนได้ทันที
 */
export const studentGoogleLogin = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const {
      credential,
      batch_id,
      google_id: rawGoogleId,
      email: rawEmail,
      name: rawName,
      picture: rawPicture,
    } = req.body;

    let googleId = rawGoogleId || "";
    let email = (rawEmail || "").trim();
    let name = (rawName || "").trim();
    let picture = rawPicture || "";

    // 1. ถ้าส่ง Google ID Token (credential) มา ให้พยายาม verify ด้วย google-auth-library หรือ decode
    if (credential && typeof credential === "string") {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID || undefined,
        });
        const payload = ticket.getPayload();
        if (payload) {
          googleId = payload.sub || googleId;
          email = payload.email || email;
          name = payload.name || name;
          picture = payload.picture || picture;
        }
      } catch (verifyErr) {
        // Fallback: decode JWT payload โดยตรง (กรณี client ID ยังไม่ได้ตั้งค่าใน .env)
        try {
          const parts = credential.split(".");
          if (parts.length === 3) {
            const decoded = JSON.parse(
              Buffer.from(parts[1], "base64").toString("utf-8"),
            );
            googleId = decoded.sub || googleId;
            email = decoded.email || email;
            name = decoded.name || name;
            picture = decoded.picture || picture;
          }
        } catch (decodeErr) {
          console.warn("Could not decode Google credential:", decodeErr);
        }
      }
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบข้อมูลอีเมลจาก Google กรุณาลองใหม่อีกครั้ง",
      });
    }

    // 2. ตรวจสอบ batch_id
    let batchId = Number(batch_id) || 0;
    if (!batchId) {
      // ค้นหาว่านักเรียนอีเมลนี้เคยลงทะเบียนในรุ่นไหนหรือไม่
      const [existingEnrollments]: any = await conn.query(
        `SELECT batch_id FROM students WHERE (LOWER(email) = LOWER(?) OR (google_id = ? AND google_id != '')) ORDER BY id DESC LIMIT 1`,
        [email, googleId || ""],
      );
      if (existingEnrollments.length > 0) {
        batchId = Number(existingEnrollments[0].batch_id);
      } else {
        return res.status(400).json({
          success: false,
          needsBatchSelection: true,
          message: "กรุณาเลือกรุ่น/หลักสูตรที่ต้องการเข้าสู่ระบบ",
        });
      }
    }

    // 3. ค้นหานักเรียนในรุ่นนี้ โดยค้นจาก google_id หรือ email
    const [rows]: any = await conn.query(
      `SELECT s.*, cb.batch_name, c.course_name, cb.course_id 
       FROM students s
       LEFT JOIN course_batches cb ON s.batch_id = cb.id
       LEFT JOIN courses c ON cb.course_id = c.id
       WHERE s.batch_id = ? AND (((s.google_id = ? AND s.google_id != '') OR LOWER(s.email) = LOWER(?)))
       LIMIT 1`,
      [batchId, googleId, email],
    );

    let student: any = null;
    let isProfileComplete = false;

    if (rows.length === 0) {
      //  ครั้งแรกที่ล็อกอินเข้ามาในรุ่นนี้: ยังไม่บันทึก (INSERT) ลงฐานข้อมูลเด็ดขาด!
      // เพื่อป้องกันไม่ให้เกิดแถวข้อมูลว่างค้างในดาต้าเบส หากผู้เรียนกดยกเลิก กดกลับ หรือปิดหน้าเว็บ
      // ข้อมูลจะถูกบันทึกลงฐานข้อมูลจริง เมื่อผู้เรียนกดยืนยันข้อมูลในหน้ากรอกข้อมูล (studentCompleteProfile) เท่านั้น
      const parts = name.split(/\s+/).filter(Boolean);
      let firstName = name || email.split("@")[0];
      let lastName = "";
      if (parts.length >= 2) {
        lastName = parts.pop() || "";
        firstName = parts.join(" ");
      }

      // ดึงข้อมูลรุ่นและหลักสูตรเพื่อนำไปแสดงผลที่หน้าฟอร์ม
      const [batchRows]: any = await conn.query(
        `SELECT cb.id as batch_id, cb.batch_name, cb.course_id, c.course_name 
         FROM course_batches cb
         LEFT JOIN courses c ON cb.course_id = c.id
         WHERE cb.id = ?`,
        [batchId],
      );
      const batchInfo = batchRows[0] || {};

      return res.status(200).json({
        success: true,
        message: "กรุณากรอกข้อมูลส่วนตัวเพื่อยืนยันตัวตน",
        isProfileComplete: false,
        isNewStudent: true,
        studentData: {
          student_id: 0,
          batch_id: batchId,
          student_code: "",
          first_name: firstName,
          last_name: lastName,
          rank_name: "",
          affiliation: "",
          email: email,
          google_id: googleId,
          phone: "",
          picture: picture,
          course_name: batchInfo.course_name || "",
          batch_name: batchInfo.batch_name || "",
          course_id: batchInfo.course_id || null,
          profile_completed: 0,
        },
      });
    } else {
      student = rows[0];

      // อัปเดต google_id หรือ picture ถ้ายังไม่มี
      const updates: string[] = [];
      const updateParams: any[] = [];
      if (!student.google_id && googleId) {
        updates.push("google_id = ?");
        updateParams.push(googleId);
        student.google_id = googleId;
      }
      if (picture && (!student.picture || student.picture !== picture)) {
        updates.push("picture = ?");
        updateParams.push(picture);
        student.picture = picture;
      }
      if (updates.length > 0) {
        updateParams.push(student.id);
        await conn.query(
          `UPDATE students SET ${updates.join(", ")} WHERE id = ?`,
          updateParams,
        );
      }

      // ตรวจสอบว่ากรอกข้อมูลครบแล้วหรือยัง
      isProfileComplete = Boolean(
        student.profile_completed === 1 ||
        (student.rank_name &&
          student.rank_name.trim() !== "" &&
          student.first_name &&
          student.first_name.trim() !== "" &&
          student.affiliation &&
          student.affiliation.trim() !== "" &&
          student.phone &&
          student.phone.trim() !== "" &&
          student.email &&
          student.email.trim() !== ""),
      );

      // ถ้าข้อมูลครบแล้ว แต่ profile_completed ยังเป็น 0 ให้เซ็ตเป็น 1
      if (isProfileComplete && student.profile_completed !== 1) {
        await conn.query(
          "UPDATE students SET profile_completed = 1 WHERE id = ?",
          [student.id],
        );
        student.profile_completed = 1;
      }

      // ถ้ายังไม่ครบถ้วน (เช่น ข้อมูลไม่สมบูรณ์ หรือเป็นข้อมูลเก่าที่ยังไม่ได้ยืนยัน)
      if (!isProfileComplete) {
        return res.status(200).json({
          success: true,
          message: "กรุณากรอกข้อมูลส่วนตัวเพื่อยืนยันตัวตน",
          isProfileComplete: false,
          isNewStudent: false,
          studentData: {
            student_id: student.id,
            batch_id: student.batch_id,
            student_code: student.student_code || "",
            first_name: student.first_name,
            last_name: student.last_name,
            rank_name: student.rank_name || "",
            affiliation: student.affiliation || "",
            email: student.email,
            google_id: student.google_id || googleId,
            phone: student.phone || "",
            picture: student.picture || picture,
            course_name: student.course_name || "",
            batch_name: student.batch_name || "",
            course_id: student.course_id,
            profile_completed: 0,
          },
        });
      }
    }

    // สร้าง JWT Token เพื่อให้นักเรียนนำไปใช้เข้าดูคะแนน (เฉพาะกรณีที่กรอกข้อมูลครบถ้วนแล้วเท่านั้น)
    const secretKey =
      process.env.JWT_SECRET || "signalxnc@evaluation-signalschool";
    const token = jwt.sign(
      {
        student_id: student.id,
        student_code: student.student_code,
        batch_id: student.batch_id,
        email: student.email,
      },
      secretKey,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      message: "เข้าสู่ระบบด้วย Google สำเร็จ",
      isProfileComplete: true,
      token,
      studentData: {
        student_id: student.id,
        batch_id: student.batch_id,
        student_code: student.student_code,
        first_name: student.first_name,
        last_name: student.last_name,
        rank_name: student.rank_name || "",
        affiliation: student.affiliation || "",
        email: student.email,
        phone: student.phone || "",
        picture: student.picture || picture,
        course_name: student.course_name || "",
        batch_name: student.batch_name || "",
        course_id: student.course_id,
        profile_completed: student.profile_completed || 1,
      },
    });
  } catch (error: any) {
    console.error("Student Google Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google",
    });
  }
};

/**
 * 🌟 กรอกข้อมูลนักเรียนให้ครบถ้วนหลังจากล็อกอินผ่าน Google ครั้งแรก
 */
export const studentCompleteProfile = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const {
      student_id,
      batch_id,
      rank_name,
      first_name,
      last_name,
      affiliation,
      phone,
      email,
      google_id,
      picture,
    } = req.body;

    // ตรวจสอบความถูกต้องของยศ: ห้ามมีตัวเลข หรือเครื่องหมาย @
    if (
      !rank_name ||
      /[0-9\u0E50-\u0E59]/.test(rank_name) ||
      rank_name.includes("@")
    ) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุชื่อยศเต็ม (ห้ามใส่ตัวเลขหรือเครื่องหมาย @)",
      });
    }

    // ตรวจสอบชื่อและนามสกุล: ห้ามมีตัวเลข หรือสัญลักษณ์ @
    if (
      !first_name ||
      /[0-9\u0E50-\u0E59]/.test(first_name) ||
      first_name.includes("@") ||
      (last_name &&
        (/[0-9\u0E50-\u0E59]/.test(last_name) || last_name.includes("@")))
    ) {
      return res.status(400).json({
        success: false,
        message: "ชื่อและนามสกุลต้องไม่มีตัวเลขหรือสัญลักษณ์พิเศษ",
      });
    }

    if (!affiliation || !affiliation.trim()) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุหน่วยต้นสังกัด",
      });
    }

    const cleanedPhone = String(phone || "").replace(/[^0-9]/g, "");
    if (!cleanedPhone || cleanedPhone.length < 9 || cleanedPhone.length > 10) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุเบอร์โทรศัพท์ที่ถูกต้อง (9-10 หลัก)",
      });
    }

    let finalStudentId = Number(student_id) || 0;

    if (finalStudentId > 0) {
      // ตรวจสอบว่ามีแถวในตาราง students หรือไม่
      const [existingRows]: any = await conn.query(
        "SELECT id FROM students WHERE id = ?",
        [finalStudentId],
      );

      if (existingRows.length > 0) {
        // อัปเดตข้อมูลผู้เรียน และทำเครื่องหมาย profile_completed = 1
        await conn.query(
          `UPDATE students 
           SET rank_name = ?, first_name = ?, last_name = ?, affiliation = ?, phone = ?, profile_completed = 1,
               picture = COALESCE(NULLIF(picture, ''), ?),
               google_id = COALESCE(NULLIF(google_id, ''), ?)
           WHERE id = ?`,
          [
            rank_name.trim(),
            first_name.trim(),
            (last_name || "").trim(),
            affiliation.trim(),
            cleanedPhone,
            picture || "",
            google_id || "",
            finalStudentId,
          ],
        );
      } else {
        finalStudentId = 0;
      }
    }

    if (finalStudentId === 0) {
      //  บันทึก (INSERT) ลงฐานข้อมูลจริงเมื่อกดยืนยันข้อมูลในหน้านี้
      const finalBatchId = Number(batch_id) || 0;
      const cleanEmail = (email || "").trim();

      if (!finalBatchId) {
        return res.status(400).json({
          success: false,
          message: "ไม่พบข้อมูลรุ่น/หลักสูตร (batch_id)",
        });
      }

      if (!cleanEmail) {
        return res.status(400).json({
          success: false,
          message: "ไม่พบข้อมูลอีเมล",
        });
      }

      // ตรวจสอบอีกครั้งว่ามีผู้ใช้นี้อยู่แล้วในรุ่นหรือไม่ เพื่อไม่ให้เกิดแถวซ้ำ
      const [duplicateCheck]: any = await conn.query(
        `SELECT id FROM students WHERE batch_id = ? AND (((google_id = ? AND google_id != '') OR LOWER(email) = LOWER(?))) LIMIT 1`,
        [finalBatchId, google_id || "", cleanEmail],
      );

      if (duplicateCheck.length > 0) {
        finalStudentId = duplicateCheck[0].id;
        await conn.query(
          `UPDATE students 
           SET rank_name = ?, first_name = ?, last_name = ?, affiliation = ?, phone = ?, profile_completed = 1,
               picture = COALESCE(NULLIF(picture, ''), ?),
               google_id = COALESCE(NULLIF(google_id, ''), ?)
           WHERE id = ?`,
          [
            rank_name.trim(),
            first_name.trim(),
            (last_name || "").trim(),
            affiliation.trim(),
            cleanedPhone,
            picture || "",
            google_id || "",
            finalStudentId,
          ],
        );
      } else {
        // คำนวณรหัสนักเรียน (student_code) อัตโนมัติในรุ่นนี้
        const [countResult]: any = await conn.query(
          "SELECT COUNT(*) as count FROM students WHERE batch_id = ?",
          [finalBatchId],
        );
        const studentCode = (Number(countResult[0]?.count || 0) + 1).toString();

        const [insertRes]: any = await conn.query(
          `INSERT INTO students 
           (batch_id, student_code, password, rank_name, first_name, last_name, affiliation, email, google_id, phone, profile_completed, picture) 
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [
            finalBatchId,
            studentCode,
            rank_name.trim(),
            first_name.trim(),
            (last_name || "").trim(),
            affiliation.trim(),
            cleanEmail,
            google_id || "",
            cleanedPhone,
            picture || "",
          ],
        );
        finalStudentId = insertRes.insertId;
      }
    }

    // ดึงข้อมูลล่าสุด
    const [rows]: any = await conn.query(
      `SELECT s.*, cb.batch_name, c.course_name, cb.course_id 
       FROM students s
       LEFT JOIN course_batches cb ON s.batch_id = cb.id
       LEFT JOIN courses c ON cb.course_id = c.id
       WHERE s.id = ?`,
      [finalStudentId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลผู้เรียน",
      });
    }

    const student = rows[0];

    const secretKey =
      process.env.JWT_SECRET || "signalxnc@evaluation-signalschool";
    const token = jwt.sign(
      {
        student_id: student.id,
        student_code: student.student_code,
        batch_id: student.batch_id,
        email: student.email,
      },
      secretKey,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      message: "บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว",
      token,
      isProfileComplete: true,
      studentData: {
        student_id: student.id,
        batch_id: student.batch_id,
        student_code: student.student_code,
        first_name: student.first_name,
        last_name: student.last_name,
        rank_name: student.rank_name,
        affiliation: student.affiliation,
        email: student.email,
        phone: student.phone,
        picture: student.picture,
        course_name: student.course_name || "",
        batch_name: student.batch_name || "",
        course_id: student.course_id,
        profile_completed: 1,
      },
    });
  } catch (error: any) {
    console.error("Student Complete Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการบันทึกข้อมูลส่วนตัว",
    });
  }
};

/**
 *  ยกเลิกการกรอกข้อมูล Google และลบข้อมูลชั่วคราวที่ไม่สมบูรณ์ออกจากฐานข้อมูล
 */
export const studentCancelGoogleLogin = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { student_id } = req.body;
    const id = Number(student_id);
    if (id > 0) {
      // ลบเฉพาะรายการที่ profile_completed = 0 (ยังกรอกข้อมูลไม่สมบูรณ์ หรือยกเลิก) เพื่อไม่ให้เปลืองพื้นที่ DB
      await conn.query(
        "DELETE FROM students WHERE id = ? AND profile_completed = 0",
        [id],
      );
    }
    return res.status(200).json({
      success: true,
      message: "ยกเลิกเรียบร้อย",
    });
  } catch (error: any) {
    console.error("Student Cancel Google Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการยกเลิก",
    });
  }
};

import { logAdminActivity } from "../utils/activityLogger";
export const adminLogin = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { username, email, password, rememberMe } = req.body;
  const loginIdentifier = (username || email || "").trim();

  try {
    // 1. ตรวจสอบว่าส่งข้อมูลมาครบไหม
    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน",
      });
    }

    // 2. ค้นหาแอดมินจาก username หรือ email
    const sql = `SELECT id, username, email, password, name, role, status FROM admin WHERE username = ? OR email = ? LIMIT 1`;
    const [rows]: any = await conn.query(sql, [
      loginIdentifier,
      loginIdentifier,
    ]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบข้อมูลชื่อผู้ใช้นี้ในระบบ",
      });
    }

    const admin = rows[0];

    // ตรวจสอบสถานะการใช้งาน
    if (admin.status === "inactive") {
      return res.status(403).json({
        success: false,
        message: "บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบหลัก",
      });
    }

    // 3. ตรวจสอบรหัสผ่าน (รองรับทั้ง bcrypt และ plain text fallback)
    let isMatch = false;
    if (
      typeof admin.password === "string" &&
      (admin.password.startsWith("$2a$") || admin.password.startsWith("$2b$"))
    ) {
      isMatch = await bcrypt.compare(password, admin.password);
    } else {
      isMatch = password === admin.password;
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "รหัสผ่านไม่ถูกต้อง",
      });
    }

    // อัปเดตเวลาเข้าสู่ระบบล่าสุด
    try {
      await conn.query("UPDATE admin SET last_login_at = NOW() WHERE id = ?", [
        admin.id,
      ]);
    } catch (e) {
      console.error("Failed to update last_login_at:", e);
    }

    // 4. สร้าง Token ให้แอดมินเอาไปใช้จัดการระบบ
    const secretKey =
      process.env.JWT_SECRET || "signalxnc@evaluation-signalschool";

    const adminUsername = admin.username || "admin";
    const adminRole = admin.role || "admin";
    const adminName = admin.name || "ผู้ดูแลระบบ";

    // หากผู้ใช้เลือกจดจำการเข้าสู่ระบบ (Remember Me) ให้ Token มีอายุ 30 วัน ถ้าไม่เลือกจะหมดอายุ/รีเซ็ตใน 1 วัน
    const isRemember = Boolean(
      rememberMe === true ||
      rememberMe === "true" ||
      rememberMe === 1 ||
      rememberMe === "1",
    );
    const expiresIn = isRemember ? "30d" : "1d";

    const token = jwt.sign(
      {
        admin_id: admin.id,
        username: adminUsername,
        name: adminName,
        role: adminRole,
        status: admin.status || "active",
      },
      secretKey,
      { expiresIn },
    );

    // บันทึก Activity Log เข้าสู่ระบบ
    await logAdminActivity({
      adminId: admin.id,
      adminName: adminName,
      adminUsername: adminUsername,
      action: "LOGIN",
      category: "AUTH",
      details: `เข้าสู่ระบบสำเร็จ (ชื่อผู้ใช้: ${adminUsername}, สิทธิ์: ${adminRole === "superadmin" ? "ผู้ดูแลระบบหลัก (Super Admin)" : "ผู้ดูแลระบบ (Admin)"}${isRemember ? ", จดจำการเข้าสู่ระบบ 30 วัน" : ", รีเซ็ตทุก 1 วัน"})`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "แอดมินเข้าสู่ระบบสำเร็จ",
      token: token,
      rememberMe: isRemember,
      expiresIn: expiresIn,
      adminData: {
        admin_id: admin.id,
        username: adminUsername,
        name: adminName,
        role: adminRole,
        status: admin.status || "active",
      },
    });
  } catch (error: any) {
    console.error("Admin Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์",
    });
  }
};

export const adminLogout = async (
  req: any,
  res: Response,
): Promise<Response> => {
  try {
    const user = req.user;
    if (user && user.admin_id) {
      await logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name || "ผู้ดูแลระบบ",
        adminEmail: user.email || "-",
        action: "LOGOUT",
        category: "AUTH",
        details: "ออกจากระบบ",
        req,
      });
    }

    return res.status(200).json({
      success: true,
      message: "ออกจากระบบสำเร็จ",
    });
  } catch (error: any) {
    console.error("Admin Logout Error:", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์",
    });
  }
};

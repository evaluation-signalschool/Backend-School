import { Request, Response } from "express";
import fs from "fs";
import csv from "csv-parser";
import "multer";
import { conn } from "../dbconn";
import { AuthRequest } from "../middleware/auth.middleware";
import { logAdminActivity } from "../utils/activityLogger";

export const uploadStudent = async (
  req: Request,
  res: Response,
): Promise<Response | void> => {
  const batch_id: string = req.body.batch_id;
  const file: Express.Multer.File | undefined = req.file;

  // เช็คว่ามีไฟล์และรุ่นส่งมาหรือไม่
  if (!file || !batch_id) {
    return res
      .status(400)
      .json({ message: "กรุณาเลือกรุ่นและอัปโหลดไฟล์ CSV" });
  }

  const result: any[] = []; // แก้ไขจุดที่พิมพ์ผิดและวงเล็บเกิน

  fs.createReadStream(file.path)
    // 1. เพิ่มตั้งค่า mapHeaders เพื่อทำความสะอาดอักขระซ่อนเร้น (BOM) หรือช่องว่างที่ติดมากับชื่อคอลัมน์
    .pipe(
      csv({
        mapHeaders: ({ header }) => header.trim(),
      }),
    )
    .on("data", (data: any) => result.push(data))
    .on("end", async () => {
      const connection = await conn.getConnection();
      try {
        await connection.beginTransaction();

        for (let row of result) {
          // 2. ดักจับแถวว่าง หรือ แถวหัวกระดาษ
          // ถ้าคอลัมน์ 'ลำดับ' ไม่มีข้อมูล ให้ข้าม (continue) ไปทำรอบถัดไปทันที
          if (!row["ลำดับ"] || String(row["ลำดับ"]).trim() === "") {
            continue;
          }

          const student_code: string = row["ลำดับ"];
          const password: string = row["รหัสผ่าน"] || "1234";
          const affiliation: string = row["สังกัด"] || "";
          
          // ดึงอีเมลและเบอร์โทรศัพท์จาก CSV (รองรับชื่อคอลัมน์หลายแบบ)
          const email: string = row["อีเมล"] || row["Email"] || row["email"] || "";
          const phone: string = row["เบอร์โทรศัพท์"] || row["เบอร์โทร"] || row["Phone"] || row["phone"] || "";

          // แกะ ยศ ชื่อ สกุล
          const fullName: string = row["ยศ - ชื่อ - สกุล"] || "";
          const parts: string[] = fullName
            .split(" ")
            .filter((p: string) => p.trim() !== "");

          let rank_name: string = "",
            first_name: string = "",
            last_name: string = "";

          if (parts.length >= 3) {
            rank_name = parts[0];
            first_name = parts[1];
            last_name = parts.slice(2).join(" ");
          } else if (parts.length === 2) {
            first_name = parts[0];
            last_name = parts[1];
          }

          const query = `
                        INSERT INTO students 
                        (batch_id, student_code, password, rank_name, first_name, last_name, affiliation, email, phone) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

          await connection.execute(query, [
            batch_id,
            student_code,
            password,
            rank_name,
            first_name,
            last_name,
            affiliation,
            email,
            phone
          ]);
        }

        await connection.commit();

        const user = (req as AuthRequest).user;
        if (user?.admin_id) {
          logAdminActivity({
            adminId: user.admin_id,
            adminName: user.name,
            adminEmail: user.email,
            action: "CREATE_STUDENT",
            category: "STUDENT",
            details: `นำเข้าข้อมูลนักเรียนจากไฟล์ CSV จำนวน ${result.length} คน (รุ่น ID: ${batch_id})`,
            req,
          });
        }

        res.status(200).json({ message: "อัปโหลดข้อมูลสำเร็จ" });
      } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปโหลดข้อมูล" });
      } finally {
        connection.release();
        // เพิ่ม Optional Chaining (?) ป้องกัน TypeScript ฟ้อง Error ว่า file อาจเป็น undefined
        if (file?.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    });
};

export const getStudents = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const batch_id = req.query.batch_id; // รับค่า batch_id ที่ Frontend ส่งมา

  let connection;
  try {
    connection = await conn.getConnection();

    // ไม่เลือกฟิลด์ password เพื่อป้องกันรหัสผ่านรั่วไหล
    let query = `SELECT id, batch_id, student_code, rank_name, first_name, last_name, affiliation, email, phone FROM students`;
    let params: any[] = [];


    // ถ้ามีการเลือกรุ่นมา ให้กรองเฉพาะนักเรียนในรุ่นนั้น
    if (batch_id) {
      query += ` WHERE batch_id = ?`;
      params.push(batch_id);
    }
    
    query += ` ORDER BY CAST(student_code AS UNSIGNED) ASC, id ASC`;

    const [rows] = await connection.execute(query, params);
    return res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลนักเรียน" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const addStudent = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  // รับข้อมูลจากฟอร์มกรอกทีละคน (อ้างอิงฟิลด์จาก UI)
  const {
    batch_id, // จำเป็นต้องส่งมาจาก Frontend ด้วยเพื่อระบุรุ่น
    rank_name,
    first_name,
    last_name,
    student_code,
    password,
    affiliation,
    email,
    phone,
  } = req.body;

  // ตรวจสอบว่ามีการส่งข้อมูลที่จำเป็นมาครบหรือไม่
  if (!batch_id || !first_name) {
    return res.status(400).json({
      message: "กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (รุ่น, ชื่อ)",
    });
  }

  let connection;
  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();

    let finalStudentCode = student_code;
    if (!finalStudentCode) {
      const [countResult]: any = await connection.execute(
        'SELECT COUNT(*) as count FROM students WHERE batch_id = ?',
        [batch_id]
      );
      finalStudentCode = (countResult[0].count + 1).toString();
    }

    const query = `
      INSERT INTO students 
      (batch_id, student_code, password, rank_name, first_name, last_name, affiliation, email, phone) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // หากไม่ได้กรอกรหัสผ่าน ให้ตั้งค่าเริ่มต้นเป็น "1234" ตามที่เคยทำในอัปโหลด CSV
    const defaultPassword = password || "1234";

    await connection.execute(query, [
      batch_id,
      finalStudentCode,
      defaultPassword,
      rank_name || "",
      first_name,
      last_name || "",
      affiliation || "",
      email || "",
      phone || "",
    ]);

    await connection.commit();

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "CREATE_STUDENT",
        category: "STUDENT",
        details: `เพิ่มข้อมูลนักเรียน: รหัส ${finalStudentCode} ${rank_name || ""} ${first_name} ${last_name || ""} (รุ่น ID: ${batch_id})`,
        req,
      });
    }

    return res.status(201).json({ message: "เพิ่มข้อมูลนักเรียนสำเร็จ" });
  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error(error);

    // ดักจับกรณีรหัสประจำตัวนักเรียนซ้ำ (Duplicate Entry) ในฐานข้อมูล
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "รหัสประจำตัวนักเรียนนี้มีอยู่ในระบบแล้ว" });
    }

    return res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการเพิ่มข้อมูลนักเรียน" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
export const updateStudent = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { id } = req.params; // รับ ID จาก URL Parameter (เช่น /students/1)
  const {
    rank_name,
    first_name,
    last_name,
    student_code,
    password,
    affiliation,
    email,
    phone,
  } = req.body;

  if (!id) {
    return res
      .status(400)
      .json({ message: "กรุณาระบุ ID ของนักเรียนที่ต้องการแก้ไข" });
  }

  let connection;
  try {
    connection = await conn.getConnection();

    const query = `
      UPDATE students 
      SET 
        rank_name = ?, 
        first_name = ?, 
        last_name = ?, 
        student_code = ?, 
        password = ?, 
        affiliation = ?,
        email = ?,
        phone = ?
      WHERE id = ?
    `;

    const [result]: any = await connection.execute(query, [
      rank_name || "",
      first_name,
      last_name || "",
      student_code,
      password,
      affiliation || "",
      email || "",
      phone || "",
      id,
    ]);

    // เช็คว่ามีข้อมูลถูกอัปเดตจริงๆ หรือไม่
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "ไม่พบข้อมูลนักเรียนที่ต้องการแก้ไข" });
    }

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "UPDATE_STUDENT",
        category: "STUDENT",
        details: `แก้ไขข้อมูลนักเรียน ID ${id}: รหัส ${student_code} ${rank_name || ""} ${first_name} ${last_name || ""}`,
        req,
      });
    }

    return res.status(200).json({ message: "อัปเดตข้อมูลนักเรียนสำเร็จ" });
  } catch (error: any) {
    console.error(error);

    // ดัก Error กรณีแก้รหัสนักเรียนไปซ้ำกับคนอื่น
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "รหัสประจำตัวนักเรียนนี้มีซ้ำอยู่ในระบบแล้ว" });
    }

    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
export const deleteStudent = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { id } = req.params; // รับ ID จาก URL Parameter

  if (!id) {
    return res
      .status(400)
      .json({ message: "กรุณาระบุ ID ของนักเรียนที่ต้องการลบ" });
  }

  let connection;
  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();

    // ดึง batch_id และข้อมูลนักเรียนก่อนที่จะลบ
    const [studentRows]: any = await connection.execute(
      'SELECT batch_id, student_code, rank_name, first_name, last_name FROM students WHERE id = ?', 
      [id]
    );
    if (studentRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบข้อมูลนักเรียนที่ต้องการลบ" });
    }
    const studentInfo = studentRows[0];
    const batch_id = studentInfo.batch_id;

    // ลบนักเรียน
    await connection.execute(`DELETE FROM students WHERE id = ?`, [id]);

    // จัดเรียงเลขที่ใหม่ให้กับนักเรียนที่เหลือในรุ่นนี้
    const [remainingStudents]: any = await connection.execute(
      `SELECT id FROM students WHERE batch_id = ? ORDER BY CAST(student_code AS UNSIGNED) ASC, id ASC`,
      [batch_id]
    );

    for (let i = 0; i < remainingStudents.length; i++) {
      const newCode = (i + 1).toString();
      await connection.execute(`UPDATE students SET student_code = ? WHERE id = ?`, [newCode, remainingStudents[i].id]);
    }

    await connection.commit();

    const user = (req as AuthRequest).user;
    if (user?.admin_id) {
      logAdminActivity({
        adminId: user.admin_id,
        adminName: user.name,
        adminEmail: user.email,
        action: "DELETE_STUDENT",
        category: "STUDENT",
        details: `ลบข้อมูลนักเรียน ID ${id}: รหัส ${studentInfo.student_code} ${studentInfo.rank_name || ""} ${studentInfo.first_name} ${studentInfo.last_name || ""} (รุ่น ID: ${batch_id})`,
        req,
      });
    }

    return res.status(200).json({ message: "ลบและจัดเรียงเลขที่ใหม่สำเร็จ" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const resequenceStudents = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { batch_id } = req.params;

  if (!batch_id) {
    return res.status(400).json({ message: "กรุณาระบุ Batch ID" });
  }

  let connection;
  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();

    // ดึงข้อมูลนักเรียนทั้งหมดในรุ่น เรียงตามเลขที่ปัจจุบัน
    const selectQuery = `
      SELECT id, student_code 
      FROM students 
      WHERE batch_id = ? 
      ORDER BY CAST(student_code AS UNSIGNED) ASC, id ASC
    `;
    const [students]: any = await connection.execute(selectQuery, [batch_id]);

    // อัปเดตเลขที่ใหม่ให้เรียงกัน
    for (let i = 0; i < students.length; i++) {
      const newCode = (i + 1).toString();
      const updateQuery = `UPDATE students SET student_code = ? WHERE id = ?`;
      await connection.execute(updateQuery, [newCode, students[i].id]);
    }

    await connection.commit();
    return res.status(200).json({ message: "จัดเรียงเลขที่ใหม่สำเร็จ" });
  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ message: "เกิดข้อผิดพลาดในการจัดเรียงเลขที่" });
  } finally {
    if (connection) connection.release();
  }
};

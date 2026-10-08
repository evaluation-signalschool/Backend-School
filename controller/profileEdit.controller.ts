import { Request, Response } from "express";
import { conn } from "../dbconn";
import fs from "fs";
import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";
import { AuthRequest } from "../middleware/auth.middleware";
import { logAdminActivity } from "../utils/activityLogger";
import { uploadFileToGoogleDrive, isGoogleDriveConfigured } from "../services/googleDrive.service";

// อัปโหลดไฟล์ไปเก็บที่ Cloudinary
const uploadToCloudinary = (buffer: Buffer): Promise<any> => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "profile_edits", resource_type: "auto" },
            (error, result) => {
                if (result) resolve(result);
                else reject(error);
            }
        );
        streamifier.createReadStream(buffer).pipe(uploadStream);
    });
};

// 1. นักเรียนส่งคำขอแก้ไขโปรไฟล์
export const submitEditRequest = async (req: Request, res: Response): Promise<Response | void> => {
    const { student_id, new_rank, new_first_name, new_last_name, drive_url } = req.body;
    const file = req.file;

    if (!student_id) {
        return res.status(400).json({ message: "ไม่พบรหัสนักเรียน" });
    }

    const trimmedRank = (new_rank || '').trim();
    const trimmedFirstName = (new_first_name || '').trim();
    const trimmedLastName = (new_last_name || '').trim();

    // เช็คว่ากรอกชื่อและนามสกุลครบไหม
    if (!trimmedFirstName || !trimmedLastName) {
        return res.status(400).json({ message: "กรุณากรอกชื่อ-นามสกุล" });
    }

    // ห้ามมีตัวเลขในยศ ชื่อ หรือนามสกุล
    const hasNumber = /[0-9\u0E50-\u0E59]/;
    if (trimmedRank && hasNumber.test(trimmedRank)) {
        return res.status(400).json({ message: "ยศต้องเป็นตัวอักษรเท่านั้น ห้ามใส่ตัวเลข" });
    }
    if (hasNumber.test(trimmedFirstName) || hasNumber.test(trimmedLastName)) {
        return res.status(400).json({ message: "ชื่อ-นามสกุลต้องเป็นตัวอักษรเท่านั้น ห้ามใส่ตัวเลข" });
    }

    // ยศห้ามมีอักขระพิเศษ (ยอมให้มีจุด วงเล็บ ขีด)
    const rankSpecialCharRegex = /[^a-zA-Z\u0E01-\u0E3A\u0E40-\u0E4E\s.()\-]/;
    if (trimmedRank && rankSpecialCharRegex.test(trimmedRank)) {
        return res.status(400).json({ message: "ยศต้องไม่มีอักขระพิเศษ" });
    }

    // ชื่อและนามสกุลห้ามมีอักขระพิเศษ
    const nameSpecialCharRegex = /[^a-zA-Z\u0E01-\u0E3A\u0E40-\u0E4E\s]/;
    if (nameSpecialCharRegex.test(trimmedFirstName) || nameSpecialCharRegex.test(trimmedLastName)) {
        return res.status(400).json({ message: "ชื่อ-นามสกุลต้องไม่มีอักขระพิเศษ" });
    }
    
    let connection;
    try {
        connection = await conn.getConnection();
        
        // เช็คว่าเคยส่งคำขอค้างไว้หรืออนุมัติไปแล้วไหม
        const [existing]: any = await connection.execute(
            `SELECT id, status FROM profile_edit_requests WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
            [student_id]
        );
        
        if (existing.length > 0 && (existing[0].status === 'pending' || existing[0].status === 'approved')) {
            return res.status(400).json({ 
                message: "คุณเคยส่งคำขอไปแล้ว หรือคำขอเดิมได้รับการอนุมัติแล้ว" 
            });
        }
        
        // ดึงข้อมูลเดิมของนักเรียน
        const [studentRes]: any = await connection.execute(
            `SELECT rank_name, first_name, last_name FROM students WHERE id = ?`,
            [student_id]
        );
        
        if (studentRes.length === 0) {
            return res.status(404).json({ message: "ไม่พบข้อมูลนักเรียน" });
        }
        
        const student = studentRes[0];

        // ถ้าเปลี่ยนยศต้องแนบเอกสารหลักฐานด้วย
        const hasEvidence = Boolean(file || (drive_url && drive_url.trim() !== ''));
        if (student.rank_name && trimmedRank && student.rank_name.trim() !== trimmedRank && !hasEvidence) {
            return res.status(400).json({ message: "กรุณาแนบไฟล์เอกสารยืนยันการเลื่อนยศ" });
        }
        
        // บันทึกคำขอลงฐานข้อมูล
        const query = `
            INSERT INTO profile_edit_requests 
            (student_id, original_rank, original_first_name, original_last_name, 
             new_rank, new_first_name, new_last_name, document_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `;
        
        let documentData = null;
        if (file) {
            if (isGoogleDriveConfigured()) {
                try {
                    const driveRes = await uploadFileToGoogleDrive(file.buffer, file.originalname, file.mimetype);
                    documentData = JSON.stringify({
                        provider: "google_drive",
                        url: driveRes.webViewLink,
                        file_id: driveRes.fileId,
                        name: driveRes.name
                    });
                } catch (gErr) {
                    console.error("[GoogleDrive] Upload to Google Drive failed, fallback to Cloudinary:", gErr);
                    const uploadResult = await uploadToCloudinary(file.buffer);
                    documentData = JSON.stringify({
                        provider: "cloudinary",
                        url: uploadResult.secure_url,
                        public_id: uploadResult.public_id
                    });
                }
            } else {
                const uploadResult = await uploadToCloudinary(file.buffer);
                documentData = JSON.stringify({
                    provider: "cloudinary",
                    url: uploadResult.secure_url,
                    public_id: uploadResult.public_id
                });
            }
        } else if (drive_url && drive_url.trim() !== '') {
            documentData = JSON.stringify({
                provider: "google_drive",
                url: drive_url.trim(),
                name: "เอกสารแนบ (Google Drive)"
            });
        }
        
        await connection.execute(query, [
            student_id, 
            student.rank_name || '', 
            student.first_name || '', 
            student.last_name || '',
            new_rank || student.rank_name || '',
            new_first_name || student.first_name || '',
            new_last_name || student.last_name || '',
            documentData
        ]);
        
        res.status(201).json({ message: "ส่งคำขอแก้ไขโปรไฟล์เรียบร้อยแล้ว" });
    } catch (error) {
        console.error("Error submitting profile edit request:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    } finally {
        if (connection) connection.release();
    }
};

// 2. นักเรียนเช็คสถานะคำขอของตัวเอง
export const checkEditStatus = async (req: Request, res: Response): Promise<Response> => {
    const { studentId } = req.params;
    
    let connection;
    try {
        connection = await conn.getConnection();
        const [rows]: any = await connection.execute(
            `SELECT id, status, new_rank, new_first_name, new_last_name, created_at 
             FROM profile_edit_requests 
             WHERE student_id = ? 
             ORDER BY id DESC LIMIT 1`,
            [studentId]
        );
        
        if (rows.length === 0) {
            return res.status(200).json({ hasRequest: false });
        }
        
        return res.status(200).json({ 
            hasRequest: true, 
            request: rows[0] 
        });
    } catch (error) {
        console.error("Error checking edit status:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    } finally {
        if (connection) connection.release();
    }
};

// 3. แอดมินดูรายการคำขอทั้งหมด
export const getAllRequests = async (req: Request, res: Response): Promise<Response> => {
    let connection;
    try {
        connection = await conn.getConnection();
        const [rows]: any = await connection.execute(`
            SELECT r.*, s.student_code, s.batch_id, cb.batch_name, c.course_name 
            FROM profile_edit_requests r
            JOIN students s ON r.student_id = s.id
            LEFT JOIN course_batches cb ON s.batch_id = cb.id
            LEFT JOIN courses c ON cb.course_id = c.id
            ORDER BY 
                CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
                r.created_at DESC
        `);
        return res.status(200).json(rows);
    } catch (error) {
        console.error("Error fetching all requests:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    } finally {
        if (connection) connection.release();
    }
};

// 4. แอดมินอนุมัติหรือปฏิเสธคำขอ
export const updateRequestStatus = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const { status } = req.body; // 'approved' หรือ 'rejected'
    
    if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ message: "สถานะไม่ถูกต้อง" });
    }
    
    let connection;
    try {
        connection = await conn.getConnection();
        await connection.beginTransaction();
        
        // ดึงข้อมูลคำขอ
        const [reqRows]: any = await connection.execute(
            `SELECT * FROM profile_edit_requests WHERE id = ?`,
            [id]
        );
        
        if (reqRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "ไม่พบคำขอ" });
        }
        
        const request = reqRows[0];
        
        if (request.status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ message: "คำขอนี้ถูกดำเนินการไปแล้ว" });
        }
        
        // อัปเดตสถานะคำขอ
        await connection.execute(
            `UPDATE profile_edit_requests SET status = ? WHERE id = ?`,
            [status, id]
        );
        
        // ถ้าอนุมัติ ให้อัปเดตข้อมูลจริงของนักเรียน
        if (status === 'approved') {
            await connection.execute(
                `UPDATE students SET rank_name = ?, first_name = ?, last_name = ? WHERE id = ?`,
                [request.new_rank, request.new_first_name, request.new_last_name, request.student_id]
            );
        }
        
        // เก็บเอกสารหลักฐานไว้ใน Google Drive / Cloud เพื่อให้แอดมินสามารถเปิดดูย้อนหลังได้ตลอด
        await connection.commit();

        // บันทึกประวัติการทำงานของแอดมิน
        const user = (req as AuthRequest).user;
        if (user?.admin_id) {
            logAdminActivity({
                adminId: user.admin_id,
                adminName: user.name,
                adminEmail: user.email,
                action: status === 'approved' ? 'APPROVE_PROFILE' : 'REJECT_PROFILE',
                category: 'PROFILE',
                details: `${status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}คำขอแก้ไขข้อมูลนักเรียน รหัสคำขอ ID ${id} (นักเรียน ID: ${request.student_id}, ข้อมูลใหม่: ${request.new_rank || ''} ${request.new_first_name} ${request.new_last_name || ''})`,
                req,
            });
        }

        return res.status(200).json({ message: status === 'approved' ? 'อนุมัติคำขอเรียบร้อยแล้ว' : 'ปฏิเสธคำขอเรียบร้อยแล้ว' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error updating request status:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    } finally {
        if (connection) connection.release();
    }
};

// 5. แอดมินลบคำขอทิ้ง
export const deleteRequest = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    
    let connection;
    try {
        connection = await conn.getConnection();
        
        await connection.execute(
            `DELETE FROM profile_edit_requests WHERE id = ?`,
            [id]
        );
        
        return res.status(200).json({ message: "ลบคำขอเรียบร้อยแล้ว" });
    } catch (error) {
        console.error("Error deleting request:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    } finally {
        if (connection) connection.release();
    }
};

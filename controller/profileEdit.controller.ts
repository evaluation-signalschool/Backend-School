import { Request, Response } from "express";
import { conn } from "../dbconn";
import fs from "fs";

// 1. POST - Student submits profile edit request
export const submitEditRequest = async (req: Request, res: Response): Promise<Response | void> => {
    const { student_id, new_rank, new_first_name, new_last_name } = req.body;
    const file = req.file;

    if (!student_id) {
        return res.status(400).json({ message: "Student ID is required." });
    }
    
    let connection;
    try {
        connection = await conn.getConnection();
        
        // Check if there is an existing pending or approved request
        const [existing]: any = await connection.execute(
            `SELECT id, status FROM profile_edit_requests WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
            [student_id]
        );
        
        if (existing.length > 0 && (existing[0].status === 'pending' || existing[0].status === 'approved')) {
            if (file?.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            return res.status(400).json({ 
                message: "You have already submitted a request or your previous request was approved." 
            });
        }
        
        // Get original data
        const [studentRes]: any = await connection.execute(
            `SELECT rank_name, first_name, last_name FROM students WHERE id = ?`,
            [student_id]
        );
        
        if (studentRes.length === 0) {
            return res.status(404).json({ message: "Student not found." });
        }
        
        const student = studentRes[0];
        
        // Insert new request
        const query = `
            INSERT INTO profile_edit_requests 
            (student_id, original_rank, original_first_name, original_last_name, 
             new_rank, new_first_name, new_last_name, document_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `;
        
        await connection.execute(query, [
            student_id, 
            student.rank_name || '', 
            student.first_name || '', 
            student.last_name || '',
            new_rank || student.rank_name || '',
            new_first_name || student.first_name || '',
            new_last_name || student.last_name || '',
            file ? file.filename : null
        ]);
        
        res.status(201).json({ message: "Profile edit request submitted successfully." });
    } catch (error) {
        console.error("Error submitting profile edit request:", error);
        if (file?.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
        res.status(500).json({ message: "Internal server error" });
    } finally {
        if (connection) connection.release();
    }
};

// 2. GET - Student checks their request status
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
        return res.status(500).json({ message: "Internal server error" });
    } finally {
        if (connection) connection.release();
    }
};

// 3. GET - Admin gets all requests
export const getAllRequests = async (req: Request, res: Response): Promise<Response> => {
    let connection;
    try {
        connection = await conn.getConnection();
        const [rows]: any = await connection.execute(`
            SELECT r.*, s.student_code, s.batch_id 
            FROM profile_edit_requests r
            JOIN students s ON r.student_id = s.id
            ORDER BY r.created_at DESC
        `);
        return res.status(200).json(rows);
    } catch (error) {
        console.error("Error fetching all requests:", error);
        return res.status(500).json({ message: "Internal server error" });
    } finally {
        if (connection) connection.release();
    }
};

// 4. PUT - Admin approves or rejects request
export const updateRequestStatus = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'
    
    if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ message: "Invalid status." });
    }
    
    let connection;
    try {
        connection = await conn.getConnection();
        await connection.beginTransaction();
        
        // Get the request
        const [reqRows]: any = await connection.execute(
            `SELECT * FROM profile_edit_requests WHERE id = ?`,
            [id]
        );
        
        if (reqRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Request not found." });
        }
        
        const request = reqRows[0];
        
        if (request.status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ message: "Request is already processed." });
        }
        
        // Update request status
        await connection.execute(
            `UPDATE profile_edit_requests SET status = ? WHERE id = ?`,
            [status, id]
        );
        
        // If approved, update student profile
        if (status === 'approved') {
            await connection.execute(
                `UPDATE students SET rank_name = ?, first_name = ?, last_name = ? WHERE id = ?`,
                [request.new_rank, request.new_first_name, request.new_last_name, request.student_id]
            );
        }
        
        await connection.commit();
        return res.status(200).json({ message: `Request ${status} successfully.` });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error updating request status:", error);
        return res.status(500).json({ message: "Internal server error" });
    } finally {
        if (connection) connection.release();
    }
};

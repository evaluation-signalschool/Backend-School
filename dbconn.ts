import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config(); // โหลดค่าจากไฟล์ .env

export const conn = mysql.createPool({
  host: process.env.DB_HOST as string,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER as string,
  password: process.env.DB_PASSWORD as string,
  database: process.env.DB_NAME as string,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false,
  },
});

export const checkConnection = async () => {
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS news (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        news_date DATE,
        file_url VARCHAR(255),
        file_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS training_summaries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_name VARCHAR(255) NOT NULL,
        cohort_key VARCHAR(100) NOT NULL,
        executive_summary TEXT,
        action_plan TEXT,
        updated_by VARCHAR(100) DEFAULT 'Admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_course_cohort (course_name, cohort_key)
      )
    `);

    try {
      await conn.query(`ALTER TABLE evaluation_forms ADD COLUMN form_description TEXT NULL`);
    } catch (_) {}

    try {
      await conn.query(`ALTER TABLE evaluation_questions ADD COLUMN subject_for INT NULL`);
    } catch (_) {}

    // Multi-Admin & Activity Logs Table Verification
    try {
      await conn.query(`ALTER TABLE admin ADD COLUMN username VARCHAR(255) NULL`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin MODIFY COLUMN email VARCHAR(255) NULL DEFAULT NULL`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin DROP INDEX email`);
    } catch (_) {}
    try {
      await conn.query(`UPDATE admin SET username = 'admin' WHERE id = 1 AND (username IS NULL OR username = '')`);
      await conn.query(`UPDATE admin SET email = NULL WHERE email LIKE '%@school.internal' OR email = 'admin@gmail.com'`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin MODIFY COLUMN username VARCHAR(255) NOT NULL`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin ADD UNIQUE KEY uq_admin_username (username)`);
    } catch (_) {}

    try {
      await conn.query(`ALTER TABLE admin ADD COLUMN name VARCHAR(255) NOT NULL DEFAULT 'ผู้ดูแลระบบ'`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'admin'`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin ADD COLUMN last_login_at TIMESTAMP NULL`);
    } catch (_) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        admin_name VARCHAR(255) NOT NULL,
        admin_username VARCHAR(255) NULL,
        admin_email VARCHAR(255) NULL,
        action VARCHAR(100) NOT NULL,
        action_category VARCHAR(50) NOT NULL,
        details TEXT NOT NULL,
        ip_address VARCHAR(45) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_logs_created_at (created_at),
        INDEX idx_logs_admin_id (admin_id),
        INDEX idx_logs_category (action_category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await conn.query(`ALTER TABLE admin_activity_logs ADD COLUMN admin_username VARCHAR(255) NULL`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE admin_activity_logs MODIFY COLUMN admin_email VARCHAR(255) NULL DEFAULT NULL`);
    } catch (_) {}
    try {
      await conn.query(`UPDATE admin_activity_logs SET admin_username = SUBSTRING_INDEX(admin_username, '@', 1) WHERE admin_username LIKE '%@%'`);
      await conn.query(`UPDATE admin_activity_logs SET admin_email = NULL WHERE admin_email LIKE '%@school.internal' OR admin_email = 'admin@gmail.com'`);
    } catch (_) {}

    try {
      await conn.query(`ALTER TABLE profile_edit_requests DROP FOREIGN KEY profile_edit_requests_ibfk_1`);
    } catch (_) {}
    try {
      await conn.query(`ALTER TABLE profile_edit_requests ADD CONSTRAINT profile_edit_requests_ibfk_1 FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE`);
    } catch (_) {}

    console.log("Required tables checked/created.");
  } catch (error) {
    console.error("Error creating tables:", error);
  }
};

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
    const connection = await conn.getConnection();
    console.log("Database connected successfully.");
    connection.release();
  } catch (error) {
    console.error("Database connection error:", error);
  }
};

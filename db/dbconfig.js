import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: "93.127.195.85",
  user: "xvadmin_akhil",
  password: "!?)cglasF]X?",
  database: "xvadmin_portfolio",
});

export default db;

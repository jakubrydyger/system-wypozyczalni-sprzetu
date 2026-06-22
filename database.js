const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'rental.db');

let db;

async function getDatabase() {
  if (db) return db;
  
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'Dostępny',
      daily_rate REAL NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      equipment_id INTEGER NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'Oczekująca',
      payment_status TEXT DEFAULT 'Nieopłacona',
      total_amount REAL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_read INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const adminExists = db.exec("SELECT COUNT(*) as count FROM users WHERE username = 'admin'");
  if (adminExists[0].values[0][0] === 0) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', 
      ['admin', 'admin@rental.pl', hashedPassword, 'admin']);
    
    const userPassword = bcrypt.hashSync('user123', 10);
    db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', 
      ['user', 'user@rental.pl', userPassword, 'user']);
  }

  const result = db.exec("SELECT COUNT(*) as count FROM equipment");
  if (result[0].values[0][0] === 0) {
    const equipment = [
      ['Laptop Dell Latitude 5540', 'Elektronika', 50.00],
      ['Laptop MacBook Pro 16"', 'Elektronika', 80.00],
      ['Laptop Lenovo ThinkPad X1', 'Elektronika', 55.00],
      ['Laptop HP Spectre x360', 'Elektronika', 60.00],
      ['Projektor Epson EB-X51', 'Elektronika', 80.00],
      ['Projektor BenQ MW560', 'Elektronika', 65.00],
      ['Monitor LG 27" 4K UltraFine', 'Elektronika', 40.00],
      ['Monitor Dell 32" Curved', 'Elektronika', 45.00],
      ['Drukarka HP LaserJet Pro', 'Elektronika', 30.00],
      ['Drukarka 3D Creality Ender', 'Elektronika', 70.00],
      ['Tablet Samsung Galaxy Tab S9', 'Elektronika', 35.00],
      ['Tablet iPad Pro 12.9"', 'Elektronika', 45.00],
      ['Słuchawki Sony WH-1000XM5', 'Elektronika', 25.00],
      ['Słuchawki Apple AirPods Max', 'Elektronika', 30.00],
      ['Konsola PlayStation 5', 'Elektronika', 40.00],
      ['Konsola Xbox Series X', 'Elektronika', 40.00],
      ['Router WiFi 6 Mesh', 'Elektronika', 15.00],
      ['Powerbank 20000mAh', 'Elektronika', 10.00],
      ['Kamera GoPro Hero 11 Black', 'Fotografia', 60.00],
      ['Kamera DJI Osmo Action 4', 'Fotografia', 55.00],
      ['Aparat Canon EOS R6 Mark II', 'Fotografia', 120.00],
      ['Aparat Sony A7 IV', 'Fotografia', 130.00],
      ['Aparat Nikon Z6 III', 'Fotografia', 110.00],
      ['Stabilizator DJI Ronin RS 3', 'Fotografia', 70.00],
      ['Oświetlenie studyjne LED 3-punktowe', 'Fotografia', 45.00],
      ['Statyw Manfrotto 290 Xtra', 'Fotografia', 15.00],
      ['Obiektyw Canon 24-70mm f/2.8', 'Fotografia', 50.00],
      ['Dron DJI Mini 4 Pro', 'Fotografia', 90.00],
      ['Lampa błyskowa Godox V1', 'Fotografia', 25.00],
      ['Namiot 4-osobowy Quechua', 'Sport', 30.00],
      ['Namiot 2-osobowy turystyczny', 'Sport', 20.00],
      ['Rower górski Trek Marlin 7', 'Sport', 40.00],
      ['Rower elektryczny Giant Explore', 'Sport', 75.00],
      ['Rower szosowy Specialized', 'Sport', 55.00],
      ['Kajak dmuchany Intex Explorer', 'Sport', 55.00],
      ['Narty Head Shape V8 + kijki', 'Sport', 45.00],
      ['Deska surfingowa 7ft', 'Sport', 50.00],
      ['Deska snowboardowa Burton', 'Sport', 40.00],
      ['Rolki K2 FIT 80', 'Sport', 25.00],
      ['Hulajnoga elektryczna Xiaomi', 'Sport', 35.00],
      ['Piłka nożna profesjonalna', 'Sport', 5.00],
      ['Mikrofon Shure SM58', 'Audio', 20.00],
      ['Mikrofon Rode NT1-A', 'Audio', 30.00],
      ['Głośnik JBL PartyBox 310', 'Audio', 65.00],
      ['Głośnik Marshall Stanmore II', 'Audio', 50.00],
      ['Mikser Behringer X32', 'Audio', 90.00],
      ['Wzmacniacz gitarowy Marshall DSL40', 'Audio', 55.00],
      ['Gitara elektryczna Fender Stratocaster', 'Audio', 60.00],
      ['Klawiatura MIDI Arturia KeyLab', 'Audio', 40.00],
      ['Słuchawki studyjne Beyerdynamic', 'Audio', 25.00],
      ['Interfejs audio Focusrite Scarlett', 'Audio', 20.00],
      ['Wiertarka Bosch GSB 18V', 'Narzędzia', 25.00],
      ['Szlifierka kątowa Makita', 'Narzędzia', 30.00],
      ['Myjka ciśnieniowa Karcher K5', 'Narzędzia', 45.00],
      ['Drabina aluminiowa 6m', 'Narzędzia', 20.00],
      ['Zestaw narzędzi 100el. Profi', 'Narzędzia', 35.00],
      ['Spawarka inwertorowa 200A', 'Narzędzia', 60.00],
      ['Wkrętarka akumulatorowa DeWalt', 'Narzędzia', 20.00],
      ['Piła tarczowa Bosch', 'Narzędzia', 35.00],
      ['Szlifierka oscylacyjna', 'Narzędzia', 15.00],
      ['Miernik laserowy Bosch', 'Narzędzia', 25.00],
      ['Agregat prądotwórczy 2kW', 'Narzędzia', 80.00],
      ['Odkurzacz przemysłowy Karcher', 'Narzędzia', 40.00]
    ];
    
    const stmt = db.prepare('INSERT INTO equipment (name, category, daily_rate) VALUES (?, ?, ?)');
    equipment.forEach(item => {
      stmt.run(item);
    });
    stmt.free();
  }
  
  saveDatabase();
  
  return db;
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  return { changes: db.getRowsModified() };
}

function get(sql, params = []) {
  const result = db.exec(sql, params);
  if (result.length > 0 && result[0].values.length > 0) {
    const columns = result[0].columns;
    const values = result[0].values[0];
    const row = {};
    columns.forEach((col, index) => {
      row[col] = values[index];
    });
    return row;
  }
  return null;
}

function all(sql, params = []) {
  const result = db.exec(sql, params);
  if (result.length > 0) {
    const columns = result[0].columns;
    return result[0].values.map(values => {
      const row = {};
      columns.forEach((col, index) => {
        row[col] = values[index];
      });
      return row;
    });
  }
  return [];
}

module.exports = {
  getDatabase,
  saveDatabase,
  run,
  get,
  all
};
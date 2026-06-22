const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'rental-secret-key',
  resave: false,
  saveUninitialized: false
}));

let db;
async function initDatabase() {
  const database = require('./database');
  db = await database.getDatabase();
  
  app.locals.db = {
    run: database.run,
    get: database.get,
    all: database.all
  };
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/equipment');
  }
  next();
};

function getNotificationCount(userId) {
  const count = app.locals.db.get(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return count ? count.count : 0;
}

app.use((req, res, next) => {
  if (req.session.user) {
    res.locals.notificationCount = getNotificationCount(req.session.user.id);
  }
  next();
});

app.get('/', requireAuth, (req, res) => {
  res.redirect('/equipment');
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
  
  if (!passwordRegex.test(password)) {
    return res.render('register', { 
      error: 'Hasło musi mieć minimum 8 znaków, zawierać dużą i małą literę, cyfrę oraz znak specjalny' 
    });
  }
  
  try {
    const existingUser = app.locals.db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    
    if (existingUser) {
      return res.render('register', { error: 'Użytkownik lub email już istnieje' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    app.locals.db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hashedPassword]);
    
    res.render('login', { error: null, success: 'Rejestracja udana! Możesz się teraz zalogować.' });
  } catch (error) {
    res.render('register', { error: 'Wystąpił błąd podczas rejestracji' });
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null, success: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = app.locals.db.get('SELECT * FROM users WHERE username = ?', [username]);
  
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };
    res.redirect('/equipment');
  } else {
    res.render('login', { error: 'Nieprawidłowe dane logowania', success: null });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/equipment', requireAuth, (req, res) => {
  const equipment = app.locals.db.all('SELECT * FROM equipment ORDER BY id');
  res.render('equipment', { 
    equipment, 
    user: req.session.user,
    success: req.query.success,
    error: req.query.error
  });
});

app.post('/reserve', requireAuth, (req, res) => {
  const { equipment_id, start_date, end_date } = req.body;
  const userId = req.session.user.id;
  
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  
  if (daysDiff > 30) {
    return res.redirect('/equipment?error=Maksymalny okres wypożyczenia to 30 dni');
  }
  
  if (daysDiff < 1) {
    return res.redirect('/equipment?error=Data zakończenia musi być późniejsza niż data rozpoczęcia');
  }
  
  const equipmentStatus = app.locals.db.get('SELECT status FROM equipment WHERE id = ?', [equipment_id]);
  if (equipmentStatus.status !== 'Dostępny') {
    return res.redirect('/equipment?error=Sprzęt nie jest dostępny');
  }
  
  const conflicts = app.locals.db.get(`
    SELECT COUNT(*) as count FROM reservations 
    WHERE equipment_id = ? 
    AND status IN ('Wypożyczony', 'Oczekująca', 'Zarezerwowany')
    AND ((start_date <= ? AND end_date >= ?) 
    OR (start_date <= ? AND end_date >= ?)
    OR (start_date >= ? AND end_date <= ?))
  `, [equipment_id, end_date, start_date, start_date, end_date, start_date, end_date]);
  
  if (conflicts && conflicts.count > 0) {
    return res.redirect('/equipment?error=Sprzęt niedostępny w tym terminie');
  }
  
  const equipment = app.locals.db.get('SELECT * FROM equipment WHERE id = ?', [equipment_id]);
  const totalAmount = daysDiff * equipment.daily_rate;
  
  app.locals.db.run(`
    INSERT INTO reservations (user_id, equipment_id, start_date, end_date, total_amount) 
    VALUES (?, ?, ?, ?, ?)
  `, [userId, equipment_id, start_date, end_date, totalAmount]);
  
  app.locals.db.run('UPDATE equipment SET status = ? WHERE id = ?', ['Zarezerwowany', equipment_id]);
  
  app.locals.db.run('INSERT INTO notifications (user_id, message) VALUES (?, ?)', 
    [userId, `Zarezerwowano sprzęt: ${equipment.name}. Kwota: ${totalAmount} PLN. Termin zwrotu: ${end_date}`]);
  
  res.redirect('/equipment?success=Rezerwacja utworzona pomyślnie');
});

app.get('/my-reservations', requireAuth, (req, res) => {
  const reservations = app.locals.db.all(`
    SELECT r.*, e.name as equipment_name 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.user_id = ?
    ORDER BY r.start_date DESC
  `, [req.session.user.id]);
  
  res.render('my-reservations', { 
    reservations, 
    user: req.session.user 
  });
});

app.post('/return/:id', requireAuth, (req, res) => {
  const reservationId = req.params.id;
  
  const reservation = app.locals.db.get('SELECT r.*, e.name as equipment_name FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?', [reservationId]);
  
  if (reservation && reservation.user_id === req.session.user.id) {
    const today = new Date().toISOString().split('T')[0];
    
    app.locals.db.run('UPDATE reservations SET end_date = ? WHERE id = ?', [today, reservationId]);
    app.locals.db.run('UPDATE reservations SET status = ? WHERE id = ?', ['Zwrócony', reservationId]);
    app.locals.db.run('UPDATE equipment SET status = ? WHERE id = ?', ['Dostępny', reservation.equipment_id]);
    
    app.locals.db.run('INSERT INTO notifications (user_id, message) VALUES (?, ?)', 
      [req.session.user.id, `Sprzęt ${reservation.equipment_name} został zwrócony`]);
    
    res.redirect('/my-reservations');
  }
});

app.get('/reports', requireAuth, (req, res) => {
  const reports = app.locals.db.all(`
    SELECT r.*, e.name as equipment_name, u.username 
    FROM reports r
    JOIN equipment e ON r.equipment_id = e.id
    JOIN users u ON r.created_by = u.id
    ORDER BY r.created_at DESC
  `);
  
  res.render('reports', { reports, user: req.session.user });
});

app.post('/reports', requireAuth, (req, res) => {
  const { equipment_id, description } = req.body;
  
  app.locals.db.run('INSERT INTO reports (equipment_id, description, created_by) VALUES (?, ?, ?)', 
    [equipment_id, description, req.session.user.id]);
  
  app.locals.db.run('UPDATE equipment SET status = ? WHERE id = ?', ['W serwisie', equipment_id]);
  
  res.redirect('/reports');
});

app.get('/notifications', requireAuth, (req, res) => {
  const notifications = app.locals.db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [req.session.user.id]
  );
  
  res.json(notifications);
});

app.post('/notifications/read/:id', requireAuth, (req, res) => {
  app.locals.db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', 
    [req.params.id, req.session.user.id]);
  res.json({ success: true });
});

app.post('/notifications/read-all', requireAuth, (req, res) => {
  app.locals.db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', 
    [req.session.user.id]);
  res.json({ success: true });
});

app.post('/payment/:reservationId', requireAuth, (req, res) => {
  const reservationId = req.params.reservationId;
  
  const reservation = app.locals.db.get('SELECT r.*, e.name as equipment_name FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?', [reservationId]);
  
  app.locals.db.run('UPDATE reservations SET payment_status = ? WHERE id = ?', ['Opłacona', reservationId]);
  app.locals.db.run('UPDATE reservations SET status = ? WHERE id = ?', ['Wypożyczony', reservationId]);
  app.locals.db.run('UPDATE equipment SET status = ? WHERE id = (SELECT equipment_id FROM reservations WHERE id = ?)', ['Wypożyczony', reservationId]);
  
  app.locals.db.run('INSERT INTO notifications (user_id, message) VALUES (?, ?)', 
    [req.session.user.id, `Płatność za ${reservation.equipment_name} zakończona. Termin zwrotu: ${reservation.end_date}`]);
  
  res.json({ success: true, message: 'Płatność zakończona' });
});

// Automatyczne sprawdzanie terminów
app.use((req, res, next) => {
  if (req.session.user) {
    const activeReservations = app.locals.db.all(`
      SELECT r.*, e.name as equipment_name FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.user_id = ? AND r.status = 'Wypożyczony'
    `, [req.session.user.id]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    activeReservations.forEach(res => {
      const endDate = new Date(res.end_date);
      endDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
      
      if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
        const message = `UWAGA: termin zwrotu ${res.equipment_name} za ${daysLeft} dni (${res.end_date})!`;
        
        const existingNotification = app.locals.db.get(
          `SELECT COUNT(*) as count FROM notifications 
           WHERE user_id = ? AND message = ? AND date(created_at) = date('now')`,
          [req.session.user.id, message]
        );
        
        if (!existingNotification || existingNotification.count === 0) {
          app.locals.db.run('INSERT INTO notifications (user_id, message) VALUES (?, ?)', 
            [req.session.user.id, message]);
        }
      }
    });
  }
  next();
});

app.get('/admin', requireAdmin, (req, res) => {
  const equipment = app.locals.db.all('SELECT * FROM equipment ORDER BY id');
  const reservations = app.locals.db.all(`
    SELECT r.*, e.name as equipment_name, u.username 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    JOIN users u ON r.user_id = u.id
    ORDER BY r.start_date DESC
  `);
  const users = app.locals.db.all('SELECT id, username, email, role FROM users ORDER BY id');
  
  res.render('admin', { 
    equipment, 
    reservations, 
    users,
    user: req.session.user,
    success: req.query.success,
    error: req.query.error
  });
});

app.post('/admin/restore-equipment/:id', requireAdmin, (req, res) => {
  const equipmentId = req.params.id;
  app.locals.db.run('UPDATE equipment SET status = ? WHERE id = ?', ['Dostępny', equipmentId]);
  res.redirect('/admin?success=Sprzęt przywrócony do dostępności');
});

app.post('/admin/update-price/:id', requireAdmin, (req, res) => {
  const equipmentId = req.params.id;
  const { price } = req.body;
  app.locals.db.run('UPDATE equipment SET daily_rate = ? WHERE id = ?', [price, equipmentId]);
  res.redirect('/admin?success=Cena zaktualizowana');
});

app.post('/admin/cancel-reservation/:id', requireAdmin, (req, res) => {
  const reservationId = req.params.id;
  const reservation = app.locals.db.get('SELECT r.*, e.name as equipment_name FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?', [reservationId]);
  
  if (reservation) {
    app.locals.db.run('UPDATE reservations SET status = ? WHERE id = ?', ['Anulowana', reservationId]);
    app.locals.db.run('UPDATE equipment SET status = ? WHERE id = ?', ['Dostępny', reservation.equipment_id]);
    
    app.locals.db.run('INSERT INTO notifications (user_id, message) VALUES (?, ?)', 
      [reservation.user_id, `Rezerwacja ${reservation.equipment_name} została anulowana przez administratora`]);
    
    res.redirect('/admin?success=Rezerwacja anulowana');
  } else {
    res.redirect('/admin?error=Nie znaleziono rezerwacji');
  }
});

app.post('/admin/delete-user/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;
  if (userId != req.session.user.id) {
    app.locals.db.run('DELETE FROM users WHERE id = ?', [userId]);
    res.redirect('/admin?success=Użytkownik usunięty');
  } else {
    res.redirect('/admin?error=Nie możesz usunąć swojego konta');
  }
});

const PORT = 3000;

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error('Błąd inicjalizacji bazy danych:', error);
});
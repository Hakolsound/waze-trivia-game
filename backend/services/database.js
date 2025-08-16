const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

class Database {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DB_PATH || path.join(__dirname, '../database/trivia.db');
  }

  async initialize() {
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          throw new Error(`Database connection failed: ${err.message}`);
        }
        console.log('Connected to SQLite database');
      });

      await this.createTables();
      await this.seedDefaultData();
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  async createTables() {
    // Safely add played_questions column to existing tables if it doesn't exist
    try {
      const tableInfo = await this.all("PRAGMA table_info(games)");
      const hasPlayedQuestions = tableInfo.some(column => column.name === 'played_questions');
      
      if (!hasPlayedQuestions) {
        await this.run('ALTER TABLE games ADD COLUMN played_questions TEXT DEFAULT "[]"');
        console.log('Added played_questions column to existing games table');
      } else {
        console.log('played_questions column already exists, skipping migration');
      }
    } catch (e) {
      console.log('Migration check error (likely first run):', e.message);
    }

    const tables = [
      `CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'setup',
        current_question_index INTEGER DEFAULT 0,
        played_questions TEXT DEFAULT '[]',
        logo_url TEXT,
        logo_position TEXT DEFAULT 'top-right',
        logo_size TEXT DEFAULT 'medium',
        primary_color TEXT DEFAULT '#667eea',
        secondary_color TEXT DEFAULT '#764ba2',
        accent_color TEXT DEFAULT '#FFD700',
        background_style TEXT DEFAULT 'gradient',
        font_family TEXT DEFAULT 'Segoe UI',
        default_question_time INTEGER DEFAULT 30,
        max_groups INTEGER DEFAULT 8,
        show_timer BOOLEAN DEFAULT 1,
        show_scores BOOLEAN DEFAULT 1,
        auto_advance BOOLEAN DEFAULT 0,
        game_description TEXT DEFAULT '',
        time_based_scoring BOOLEAN DEFAULT 0,
        virtual_buzzers_enabled BOOLEAN DEFAULT 0,
        buzzer_offline_threshold INTEGER DEFAULT 120,
        allow_negative_scores BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        game_id TEXT,
        name TEXT NOT NULL,
        color TEXT,
        score INTEGER DEFAULT 0,
        position INTEGER,
        buzzer_id TEXT,
        FOREIGN KEY (game_id) REFERENCES games (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        game_id TEXT,
        text TEXT NOT NULL,
        media_url TEXT,
        correct_answer TEXT,
        time_limit INTEGER DEFAULT 30,
        points INTEGER DEFAULT 100,
        question_order INTEGER,
        FOREIGN KEY (game_id) REFERENCES games (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS buzzer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT,
        question_id TEXT,
        group_id TEXT,
        timestamp INTEGER,
        delta_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games (id),
        FOREIGN KEY (question_id) REFERENCES questions (id),
        FOREIGN KEY (group_id) REFERENCES groups (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS game_settings (
        id TEXT PRIMARY KEY,
        game_id TEXT,
        setting_key TEXT NOT NULL,
        setting_value TEXT,
        FOREIGN KEY (game_id) REFERENCES games (id)
      )`
    ];

    for (const table of tables) {
      await this.run(table);
    }
    
    // Add time_based_scoring column to existing games if it doesn't exist
    try {
      await this.run('ALTER TABLE games ADD COLUMN time_based_scoring BOOLEAN DEFAULT 0');
    } catch (error) {
      // Column probably already exists, which is fine
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding time_based_scoring column:', error.message);
      }
    }
    
    // Add virtual buzzer columns to existing games if they don't exist
    try {
      await this.run('ALTER TABLE games ADD COLUMN virtual_buzzers_enabled BOOLEAN DEFAULT 0');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding virtual_buzzers_enabled column:', error.message);
      }
    }
    
    try {
      await this.run('ALTER TABLE games ADD COLUMN buzzer_offline_threshold INTEGER DEFAULT 120');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding buzzer_offline_threshold column:', error.message);
      }
    }
    
    // Add allow_negative_scores column to existing games if it doesn't exist
    try {
      await this.run('ALTER TABLE games ADD COLUMN allow_negative_scores BOOLEAN DEFAULT 0');
    } catch (error) {
      if (!error.message.includes('duplicate column name')) {
        console.error('Error adding allow_negative_scores column:', error.message);
      }
    }
    
    // Add branding columns to existing games if they don't exist
    const brandingColumns = [
      ['primary_color', 'TEXT DEFAULT \'#667eea\''],
      ['secondary_color', 'TEXT DEFAULT \'#764ba2\''],
      ['accent_color', 'TEXT DEFAULT \'#FFD700\''],
      ['background_style', 'TEXT DEFAULT \'gradient\''],
      ['font_family', 'TEXT DEFAULT \'Segoe UI\'']
    ];
    
    for (const [columnName, columnDef] of brandingColumns) {
      try {
        await this.run(`ALTER TABLE games ADD COLUMN ${columnName} ${columnDef}`);
      } catch (error) {
        if (!error.message.includes('duplicate column name')) {
          console.error(`Error adding ${columnName} column:`, error.message);
        }
      }
    }
  }

  async seedDefaultData() {
    const gameExists = await this.get('SELECT COUNT(*) as count FROM games');
    if (gameExists.count === 0) {
      const { v4: uuidv4 } = require('uuid');
      const gameId = uuidv4();
      
      await this.run(
        'INSERT INTO games (id, name, status) VALUES (?, ?, ?)',
        [gameId, 'Sample Trivia Game', 'setup']
      );

      const sampleGroups = [
        { name: 'Team Red', color: '#FF6B6B' },
        { name: 'Team Blue', color: '#4ECDC4' },
        { name: 'Team Green', color: '#45B7D1' },
        { name: 'Team Yellow', color: '#96CEB4' }
      ];

      for (let i = 0; i < sampleGroups.length; i++) {
        const groupId = uuidv4();
        await this.run(
          'INSERT INTO groups (id, game_id, name, color, position, buzzer_id) VALUES (?, ?, ?, ?, ?, ?)',
          [groupId, gameId, sampleGroups[i].name, sampleGroups[i].color, i + 1, `buzzer_${i + 1}`]
        );
      }

      const sampleQuestions = [
        { text: 'What is the capital of France?', answer: 'Paris', points: 100 },
        { text: 'Which planet is closest to the Sun?', answer: 'Mercury', points: 150 },
        { text: 'What year did the first iPhone release?', answer: '2007', points: 200 }
      ];

      for (let i = 0; i < sampleQuestions.length; i++) {
        const questionId = uuidv4();
        await this.run(
          'INSERT INTO questions (id, game_id, text, correct_answer, points, question_order) VALUES (?, ?, ?, ?, ?, ?)',
          [questionId, gameId, sampleQuestions[i].text, sampleQuestions[i].answer, sampleQuestions[i].points, i + 1]
        );
      }
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  isConnected() {
    return this.db !== null;
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) console.error('Error closing database:', err);
          else console.log('Database connection closed');
          resolve();
        });
      });
    }
  }
}

module.exports = Database;
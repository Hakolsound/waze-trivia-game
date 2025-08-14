const { v4: uuidv4 } = require('uuid');

class GameService {
  constructor(database, io) {
    this.db = database;
    this.io = io;
    this.activeGames = new Map();
  }

  async createGame(gameData) {
    const gameId = uuidv4();
    await this.db.run(
      'INSERT INTO games (id, name, status) VALUES (?, ?, ?)',
      [gameId, gameData.name, 'setup']
    );

    if (gameData.groups) {
      for (let i = 0; i < gameData.groups.length; i++) {
        const groupId = uuidv4();
        const group = gameData.groups[i];
        await this.db.run(
          'INSERT INTO groups (id, game_id, name, color, position, buzzer_id) VALUES (?, ?, ?, ?, ?, ?)',
          [groupId, gameId, group.name, group.color, i + 1, group.buzzer_id || `buzzer_${i + 1}`]
        );
      }
    }

    if (gameData.questions) {
      for (let i = 0; i < gameData.questions.length; i++) {
        const questionId = uuidv4();
        const question = gameData.questions[i];
        await this.db.run(
          'INSERT INTO questions (id, game_id, text, correct_answer, time_limit, points, question_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [questionId, gameId, question.text, question.correct_answer, question.time_limit || 30, question.points || 100, i + 1]
        );
      }
    }

    return this.getGame(gameId);
  }

  async getGame(gameId) {
    const game = await this.db.get('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) throw new Error('Game not found');

    const groups = await this.db.all('SELECT * FROM groups WHERE game_id = ? ORDER BY position', [gameId]);
    const questions = await this.db.all('SELECT * FROM questions WHERE game_id = ? ORDER BY question_order', [gameId]);

    return { ...game, groups, questions };
  }

  async getAllGames() {
    return await this.db.all('SELECT * FROM games ORDER BY created_at DESC');
  }

  async updateGameStatus(gameId, status) {
    await this.db.run(
      'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, gameId]
    );

    this.io.to(`game-${gameId}`).emit('game-status', { gameId, status });
    return this.getGame(gameId);
  }

  async startQuestion(gameId, questionIndex) {
    const game = await this.getGame(gameId);
    if (questionIndex >= game.questions.length) {
      throw new Error('Question index out of bounds');
    }

    await this.db.run(
      'UPDATE games SET current_question_index = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [questionIndex, 'question_active', gameId]
    );

    const currentQuestion = game.questions[questionIndex];
    this.activeGames.set(gameId, {
      questionId: currentQuestion.id,
      startTime: Date.now(),
      buzzerOrder: [],
      timeLimit: currentQuestion.time_limit * 1000
    });

    this.io.to(`game-${gameId}`).emit('question-start', {
      gameId,
      question: currentQuestion,
      questionIndex,
      startTime: Date.now()
    });

    this.io.to('control-panel').emit('buzzers-armed', { gameId, questionId: currentQuestion.id });

    setTimeout(() => {
      this.endQuestion(gameId);
    }, currentQuestion.time_limit * 1000);

    return currentQuestion;
  }

  async endQuestion(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState) return;

    await this.db.run(
      'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['question_ended', gameId]
    );

    this.io.to(`game-${gameId}`).emit('question-end', {
      gameId,
      buzzerOrder: gameState.buzzerOrder
    });

    this.io.to('control-panel').emit('buzzers-disarmed', { gameId });
  }

  async handleBuzzerPress(data) {
    const { gameId, groupId, timestamp, buzzer_id } = data;
    const gameState = this.activeGames.get(gameId);
    
    if (!gameState) return;

    const deltaMs = timestamp - gameState.startTime;
    const buzzerEntry = {
      groupId,
      buzzer_id,
      timestamp,
      deltaMs,
      position: gameState.buzzerOrder.length + 1
    };

    gameState.buzzerOrder.push(buzzerEntry);

    await this.db.run(
      'INSERT INTO buzzer_events (game_id, question_id, group_id, timestamp, delta_ms) VALUES (?, ?, ?, ?, ?)',
      [gameId, gameState.questionId, groupId, timestamp, deltaMs]
    );

    this.io.to(`game-${gameId}`).emit('buzzer-pressed', buzzerEntry);
    this.io.to('control-panel').emit('buzzer-pressed', buzzerEntry);
  }

  async awardPoints(gameId, groupId, points) {
    await this.db.run(
      'UPDATE groups SET score = score + ? WHERE id = ? AND game_id = ?',
      [points, groupId, gameId]
    );

    const group = await this.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    
    this.io.to(`game-${gameId}`).emit('score-update', {
      groupId,
      newScore: group.score,
      pointsAwarded: points
    });

    return group;
  }

  async getGameState(gameId) {
    const game = await this.getGame(gameId);
    const gameState = this.activeGames.get(gameId);
    
    return {
      ...game,
      activeQuestion: gameState ? {
        questionId: gameState.questionId,
        startTime: gameState.startTime,
        buzzerOrder: gameState.buzzerOrder,
        timeRemaining: Math.max(0, gameState.timeLimit - (Date.now() - gameState.startTime))
      } : null
    };
  }

  async resetGame(gameId) {
    await this.db.run(
      'UPDATE games SET status = ?, current_question_index = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['setup', gameId]
    );

    await this.db.run(
      'UPDATE groups SET score = 0 WHERE game_id = ?',
      [gameId]
    );

    await this.db.run(
      'DELETE FROM buzzer_events WHERE game_id = ?',
      [gameId]
    );

    this.activeGames.delete(gameId);

    this.io.to(`game-${gameId}`).emit('game-reset', { gameId });
    
    return this.getGame(gameId);
  }
}

module.exports = GameService;
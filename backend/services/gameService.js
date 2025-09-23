const { v4: uuidv4 } = require('uuid');

class GameService {
  constructor(database, io, esp32Service = null) {
    this.db = database;
    this.io = io;
    this.esp32Service = esp32Service;
    this.activeGames = new Map();
    this.currentGlobalGame = null; // Global current game for all frontend apps
    this.buzzerActivity = new Map(); // Track last activity for each buzzer
    this.onlineBuzzers = new Set(); // Track which buzzer IDs are currently online
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

    // Parse the played_questions JSON array
    let played_questions = [];
    try {
      played_questions = JSON.parse(game.played_questions || '[]');
    } catch (e) {
      played_questions = [];
    }

    return { ...game, groups, questions, played_questions };
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

    // Mark as played immediately when started (like before)
    let playedQuestions = [...game.played_questions];
    if (!playedQuestions.includes(questionIndex)) {
      playedQuestions.push(questionIndex);
    }

    await this.db.run(
      'UPDATE games SET current_question_index = ?, status = ?, played_questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [questionIndex, 'question_active', JSON.stringify(playedQuestions), gameId]
    );

    const currentQuestion = game.questions[questionIndex];
    // Clear any existing timeout for this game
    const existingGameState = this.activeGames.get(gameId);
    if (existingGameState && existingGameState.timeoutId) {
      clearTimeout(existingGameState.timeoutId);
    }

    // Set up the new timeout
    const timeoutId = setTimeout(() => {
      this.endQuestion(gameId);
    }, currentQuestion.time_limit * 1000);

    this.activeGames.set(gameId, {
      questionId: currentQuestion.id,
      startTime: Date.now(),
      buzzerOrder: [],
      timeLimit: currentQuestion.time_limit * 1000,
      timeoutId: timeoutId,
      isPaused: false,
      pausedAt: null,
      totalPausedDuration: 0
    });

    this.io.to(`game-${gameId}`).emit('question-start', {
      gameId,
      question: currentQuestion,
      questionIndex,
      startTime: Date.now()
    });

    // Arm physical buzzers through ESP32 service
    if (this.esp32Service) {
      try {
        await this.esp32Service.armBuzzers(gameId);
        console.log(`Physical buzzers armed for game ${gameId}, question ${currentQuestion.id}`);
      } catch (error) {
        console.error('Failed to arm physical buzzers:', error);
      }
    }

    // Arm buzzers for both host control and all game clients (including virtual buzzers)
    this.io.to('control-panel').emit('buzzers-armed', { gameId, questionId: currentQuestion.id });
    this.io.to(`game-${gameId}`).emit('buzzers-armed', { gameId, questionId: currentQuestion.id });

    // Timeout is now handled above in the activeGames setup

    return currentQuestion;
  }

  pauseQuestion(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState || gameState.isPaused) return;

    // Clear the timeout
    if (gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
      gameState.timeoutId = null;
    }

    gameState.isPaused = true;
    gameState.pausedAt = Date.now();

    // Emit pause event to all clients
    this.io.to(`game-${gameId}`).emit('timer-paused', {
      gameId,
      pausedAt: gameState.pausedAt,
      timeElapsed: gameState.pausedAt - gameState.startTime - gameState.totalPausedDuration
    });

    console.log(`Question timer paused for game ${gameId}`);
  }

  resumeQuestion(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState || !gameState.isPaused) return;

    // Calculate pause duration and add to total
    const pauseDuration = Date.now() - gameState.pausedAt;
    gameState.totalPausedDuration += pauseDuration;
    gameState.isPaused = false;
    gameState.pausedAt = null;

    // Calculate remaining time and set new timeout
    const effectiveElapsed = Date.now() - gameState.startTime - gameState.totalPausedDuration;
    const remainingTime = Math.max(0, gameState.timeLimit - effectiveElapsed);

    if (remainingTime > 0) {
      gameState.timeoutId = setTimeout(() => {
        this.endQuestion(gameId);
      }, remainingTime);
    } else {
      // Time already expired, end question immediately
      this.endQuestion(gameId);
      return;
    }

    // Emit resume event to all clients
    this.io.to(`game-${gameId}`).emit('timer-resumed', {
      gameId,
      resumedAt: Date.now(),
      timeRemaining: remainingTime,
      totalPausedDuration: gameState.totalPausedDuration
    });

    console.log(`Question timer resumed for game ${gameId}, ${remainingTime}ms remaining`);
  }

  async endQuestion(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState) return;

    // Clear the timeout if it exists
    if (gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
    }

    // Don't modify played_questions here - they're already set when question starts
    await this.db.run(
      'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['question_ended', gameId]
    );

    this.io.to(`game-${gameId}`).emit('question-end', {
      gameId,
      buzzerOrder: gameState.buzzerOrder
    });

    // Disarm physical buzzers through ESP32 service
    if (this.esp32Service) {
      try {
        await this.esp32Service.disarmBuzzers();
        console.log(`Physical buzzers disarmed for game ${gameId}`);
      } catch (error) {
        console.error('Failed to disarm physical buzzers:', error);
      }
    }

    // Disarm buzzers for both host control and all game clients (including virtual buzzers)
    this.io.to('control-panel').emit('buzzers-disarmed', { gameId });
    this.io.to(`game-${gameId}`).emit('buzzers-disarmed', { gameId });

    // Remove the game state to prevent any lingering timers
    this.activeGames.delete(gameId);
  }

  async evaluateAnswer(gameId, isCorrect, buzzerPosition = 0) {

    const gameState = this.activeGames.get(gameId);

    if (!gameState || !gameState.buzzerOrder.length) {
      throw new Error('No active question or buzzer presses found');
    }

    const game = await this.getGame(gameId);
    const currentQuestion = game.questions[game.current_question_index];
    
    if (!currentQuestion) {
      throw new Error('Current question not found');
    }

    // Get the buzzer entry at the specified position
    const buzzerEntry = gameState.buzzerOrder[buzzerPosition];
    if (!buzzerEntry) {
      throw new Error('Buzzer entry not found at position ' + buzzerPosition);
    }

    // Calculate points based on time-based scoring setting
    let pointsToAward;
    if (isCorrect) {
      if (game.time_based_scoring) {
        // Calculate time remaining when buzzer was pressed
        const timeElapsed = buzzerEntry.deltaMs;
        const questionTimeLimit = currentQuestion.time_limit || 30; // Default to 30s if not set
        const totalTime = questionTimeLimit * 1000;
        const timeRemaining = Math.max(0, totalTime - timeElapsed);


        pointsToAward = this.calculateTimeBasedPoints(currentQuestion.points, timeRemaining, totalTime);
      } else {
        pointsToAward = currentQuestion.points;
      }
    } else {
      // Incorrect answers still lose half points regardless of time-based scoring
      pointsToAward = -Math.floor(currentQuestion.points * 0.5);
    }
    
    
    // Award or deduct points
    await this.awardPoints(gameId, buzzerEntry.groupId, pointsToAward);
    
    // Mark this buzzer entry as evaluated
    buzzerEntry.evaluated = true;
    buzzerEntry.isCorrect = isCorrect;
    buzzerEntry.pointsAwarded = pointsToAward;

    // Emit answer evaluation event
    this.io.to(`game-${gameId}`).emit('answer-evaluated', {
      gameId,
      groupId: buzzerEntry.groupId,
      isCorrect,
      pointsAwarded: pointsToAward,
      buzzerPosition,
      nextInLine: gameState.buzzerOrder.length > buzzerPosition + 1 ? gameState.buzzerOrder[buzzerPosition + 1] : null
    });

    this.io.to('control-panel').emit('answer-evaluated', {
      gameId,
      groupId: buzzerEntry.groupId,
      isCorrect,
      pointsAwarded: pointsToAward,
      buzzerPosition,
      remainingBuzzers: gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated),
      questionComplete: isCorrect || gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated).length === 0
    });

    // Handle timer logic based on answer correctness
    if (isCorrect) {
      // Correct answer - end question (this also clears the timer)
      await this.endQuestion(gameId);
      await this.prepareNextQuestion(gameId);
    } else {
      // Incorrect answer - check if there are more teams waiting
      const remainingBuzzers = gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated);
      if (remainingBuzzers.length === 0) {
        // No more teams waiting - resume timer for remaining time
        if (gameState.isPaused) {
          this.resumeQuestion(gameId);
        }
      }
      // If there are more teams waiting, timer stays paused
    }

    return {
      success: true,
      isCorrect,
      pointsAwarded: pointsToAward,
      nextInLine: gameState.buzzerOrder.length > buzzerPosition + 1 && !isCorrect,
      questionComplete: isCorrect || gameState.buzzerOrder.slice(buzzerPosition + 1).filter(b => !b.evaluated).length === 0
    };
  }

  async prepareNextQuestion(gameId) {
    const game = await this.getGame(gameId);
    const nextQuestionIndex = game.current_question_index + 1;
    
    if (nextQuestionIndex < game.questions.length) {
      // Update current question index but don't start yet (host controls when to start)
      await this.db.run(
        'UPDATE games SET current_question_index = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [nextQuestionIndex, 'waiting_for_next', gameId]
      );
      
      this.io.to(`game-${gameId}`).emit('question-prepared', {
        gameId,
        nextQuestionIndex,
        question: game.questions[nextQuestionIndex],
        totalQuestions: game.questions.length
      });
      
      this.io.to('control-panel').emit('question-prepared', {
        gameId,
        nextQuestionIndex,
        question: game.questions[nextQuestionIndex],
        totalQuestions: game.questions.length
      });
    } else {
      // Game completed
      await this.db.run(
        'UPDATE games SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['game_over', gameId]
      );
      
      this.io.to(`game-${gameId}`).emit('game-completed', {
        gameId,
        finalScores: game.groups.sort((a, b) => b.score - a.score)
      });
      
      this.io.to('control-panel').emit('game-completed', {
        gameId,
        finalScores: game.groups.sort((a, b) => b.score - a.score)
      });
      
      // Clear the active game state only when game is completed
      this.activeGames.delete(gameId);
    }
    
    // Don't clear active game state here for normal question preparation
    // Game state should only be cleared when game is completed or question ends
  }

  async getNextInLineBuzzer(gameId) {
    const gameState = this.activeGames.get(gameId);
    if (!gameState || !gameState.buzzerOrder.length) {
      return null;
    }

    // Find the first unevaluated buzzer entry
    const nextBuzzer = gameState.buzzerOrder.find(buzzer => !buzzer.evaluated);
    return nextBuzzer || null;
  }

  async getCurrentQuestionState(gameId) {
    const gameState = this.activeGames.get(gameId);
    const game = await this.getGame(gameId);
    
    if (!gameState) {
      return {
        hasActiveQuestion: false,
        currentQuestion: null,
        buzzerOrder: [],
        nextInLine: null
      };
    }

    const currentQuestion = game.questions[game.current_question_index];
    const nextInLine = this.getNextInLineBuzzer(gameId);
    
    return {
      hasActiveQuestion: true,
      currentQuestion,
      buzzerOrder: gameState.buzzerOrder,
      nextInLine: await nextInLine,
      timeRemaining: Math.max(0, gameState.timeLimit - (Date.now() - gameState.startTime))
    };
  }

  async handleBuzzerPress(data) {
    const { gameId, groupId, timestamp, buzzer_id, buzzerId, deltaMs: providedDeltaMs } = data;
    const gameState = this.activeGames.get(gameId);

    if (!gameState) {
      return;
    }

    // Map buzzer_id to actual database group.id
    // The groupId from ESP32Service is actually the buzzer_id, need to find real group.id
    let actualGroupId = groupId;
    if (buzzer_id || buzzerId) {
      const buzzerIdToLookup = buzzer_id || buzzerId;

      // For virtual buzzers, the buzzer lookup will fail since they're not in the database
      // In that case, the groupId sent is already the correct database group ID
      const groupRecord = await this.db.get(
        'SELECT id FROM groups WHERE game_id = ? AND buzzer_id = ?',
        [gameId, buzzerIdToLookup]
      );

      if (groupRecord) {
        actualGroupId = groupRecord.id;
      } else {
        // For virtual buzzers or if lookup fails, use the provided groupId directly
        actualGroupId = groupId;
      }

      // Debug timing comparison
      if (data.deltaMs !== undefined) {
      }
    }

    // Track buzzer activity for virtual buzzer availability
    const actualBuzzerId = buzzerId || buzzer_id || `physical_${actualGroupId}`;
    this.updateBuzzerActivity(actualBuzzerId, actualGroupId);

    // Always use JavaScript timing for physical buzzers (ESP32 deltaMs is unreliable)
    // Calculate actual elapsed time from when question started
    const deltaMs = timestamp - gameState.startTime;
    const buzzerEntry = {
      groupId: actualGroupId, // Use the mapped group ID from database
      buzzer_id,
      timestamp,
      deltaMs,
      position: gameState.buzzerOrder.length + 1
    };

    gameState.buzzerOrder.push(buzzerEntry);

    // PAUSE TIMER when first team buzzes in
    if (gameState.buzzerOrder.length === 1 && !gameState.isPaused) {
      this.pauseQuestion(gameId);
    }

    await this.db.run(
      'INSERT INTO buzzer_events (game_id, question_id, group_id, timestamp, delta_ms) VALUES (?, ?, ?, ?, ?)',
      [gameId, gameState.questionId, actualGroupId, timestamp, deltaMs]
    );

    this.io.to(`game-${gameId}`).emit('buzzer-pressed', buzzerEntry);
    this.io.to('control-panel').emit('buzzer-pressed', buzzerEntry);
  }

  // Calculate time-based points (decreases linearly from max to 0)
  calculateTimeBasedPoints(originalPoints, timeRemaining, totalTime) {

    if (timeRemaining <= 0) {
      return 0;
    }
    if (timeRemaining >= totalTime) {
      return originalPoints;
    }

    // Linear decrease from original points to 0
    const ratio = timeRemaining / totalTime;
    const calculatedPoints = Math.ceil(originalPoints * ratio);
    return calculatedPoints;
  }

  async awardPoints(gameId, groupId, points) {
    const game = await this.getGame(gameId);
    const allowNegativeScores = Boolean(game.allow_negative_scores);

    // Debug: Check what groups exist for this game
    const allGroups = await this.db.all('SELECT * FROM groups WHERE game_id = ?', [gameId]);

    // Get current score before update
    const currentGroup = await this.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    const currentScore = currentGroup ? currentGroup.score : 0;
    const newScore = currentScore + points;
    
    // Debug logging for negative scores
    
    // If negative scores are not allowed, clamp at 0
    const finalScore = allowNegativeScores ? newScore : Math.max(0, newScore);
    const actualPointsAwarded = finalScore - currentScore;
    
    
    await this.db.run(
      'UPDATE groups SET score = ? WHERE id = ? AND game_id = ?',
      [finalScore, groupId, gameId]
    );

    const updatedGroup = await this.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);

    if (!updatedGroup) {
      throw new Error(`Group with id "${groupId}" not found after score update`);
    }

    this.io.to(`game-${gameId}`).emit('score-update', {
      groupId,
      newScore: updatedGroup.score,
      pointsAwarded: actualPointsAwarded,
      originalPointsAttempted: points,
      cappedAtZero: !allowNegativeScores && newScore < 0
    });

    return updatedGroup;
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
      'UPDATE games SET status = ?, current_question_index = 0, played_questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['setup', JSON.stringify([]), gameId]
    );

    await this.db.run(
      'UPDATE groups SET score = 0 WHERE game_id = ?',
      [gameId]
    );

    await this.db.run(
      'DELETE FROM buzzer_events WHERE game_id = ?',
      [gameId]
    );

    // Clear any running timers before deleting the game state
    const gameState = this.activeGames.get(gameId);
    if (gameState && gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
    }

    this.activeGames.delete(gameId);

    this.io.to(`game-${gameId}`).emit('game-reset', { gameId });
    
    return this.getGame(gameId);
  }

  async resetQuestions(gameId) {
    await this.db.run(
      'UPDATE games SET status = ?, current_question_index = 0, played_questions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['setup', JSON.stringify([]), gameId]
    );

    await this.db.run(
      'DELETE FROM buzzer_events WHERE game_id = ?',
      [gameId]
    );

    // Clear any running timers before deleting the game state
    const gameState = this.activeGames.get(gameId);
    if (gameState && gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
    }
    this.activeGames.delete(gameId);

    this.io.to(`game-${gameId}`).emit('questions-reset', { gameId });
    
    return this.getGame(gameId);
  }

  async setCurrentQuestionIndex(gameId, questionIndex) {
    const game = await this.getGame(gameId);
    if (questionIndex < 0 || questionIndex >= game.questions.length) {
      throw new Error('Question index out of bounds');
    }

    await this.db.run(
      'UPDATE games SET current_question_index = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [questionIndex, 'setup', gameId]
    );

    // Clear any running game state when navigating
    const gameState = this.activeGames.get(gameId);
    if (gameState && gameState.timeoutId) {
      clearTimeout(gameState.timeoutId);
    }
    this.activeGames.delete(gameId);

    this.io.to(`game-${gameId}`).emit('question-navigation', { 
      gameId,
      questionIndex,
      question: game.questions[questionIndex],
      totalQuestions: game.questions.length
    });
    
    return this.getGame(gameId);
  }

  async resetScores(gameId) {
    await this.db.run(
      'UPDATE groups SET score = 0 WHERE game_id = ?',
      [gameId]
    );

    // Get updated game data with reset scores
    const game = await this.getGame(gameId);
    
    // Notify all clients about score reset
    this.io.to(`game-${gameId}`).emit('teams-updated', game.groups);
    this.io.to('control-panel').emit('teams-updated', game.groups);
    
    return game;
  }

  // Branding methods
  async getGameBranding(gameId) {
    const game = await this.db.get('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) throw new Error('Game not found');
    return game;
  }

  async updateGameBranding(gameId, brandingData) {
    const fields = [];
    const values = [];
    
    const allowedFields = [
      'logo_url', 'logo_position', 'logo_size', 'primary_color', 
      'secondary_color', 'accent_color', 'background_style', 'font_family',
      'default_question_time', 'max_groups', 'show_timer', 'show_scores', 
      'auto_advance', 'game_description'
    ];
    
    for (const field of allowedFields) {
      if (brandingData.hasOwnProperty(field)) {
        fields.push(`${field} = ?`);
        values.push(brandingData[field]);
      }
    }
    
    if (fields.length === 0) {
      throw new Error('No valid branding fields provided');
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(gameId);
    
    await this.db.run(
      `UPDATE games SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    
    return this.getGameBranding(gameId);
  }

  async resetGameBranding(gameId) {
    const defaultBranding = {
      logo_url: null,
      logo_position: 'top-right',
      logo_size: 'medium',
      primary_color: '#667eea',
      secondary_color: '#764ba2',
      accent_color: '#FFD700',
      background_style: 'gradient',
      font_family: 'Segoe UI',
      default_question_time: 30,
      max_groups: 8,
      show_timer: 1,
      show_scores: 1,
      auto_advance: 0,
      game_description: ''
    };
    
    return this.updateGameBranding(gameId, defaultBranding);
  }

  // Scoring Settings Methods
  async updateScoringSettings(gameId, settings) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    const updates = [];
    const values = [];
    
    if (settings.hasOwnProperty('timeBasedScoring')) {
      updates.push('time_based_scoring = ?');
      values.push(settings.timeBasedScoring ? 1 : 0);
    }
    
    if (settings.hasOwnProperty('allowNegativeScores')) {
      updates.push('allow_negative_scores = ?');
      values.push(settings.allowNegativeScores ? 1 : 0);
    }
    
    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(gameId);
      
      await this.db.run(
        `UPDATE games SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return this.getGame(gameId);
  }

  async getScoringSettings(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    return {
      timeBasedScoring: Boolean(game.time_based_scoring),
      allowNegativeScores: Boolean(game.allow_negative_scores)
    };
  }

  // Virtual Buzzer Settings Methods
  async updateVirtualBuzzerSettings(gameId, settings) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    await this.db.run(
      'UPDATE games SET virtual_buzzers_enabled = ?, buzzer_offline_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [settings.virtualBuzzersEnabled ? 1 : 0, settings.buzzerOfflineThreshold || 120, gameId]
    );

    return this.getGame(gameId);
  }

  async getVirtualBuzzerSettings(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    return {
      virtualBuzzersEnabled: Boolean(game.virtual_buzzers_enabled),
      buzzerOfflineThreshold: game.buzzer_offline_threshold || 120
    };
  }

  // Buzzer Activity Tracking Methods
  updateBuzzerActivity(buzzerId, groupId) {
    this.buzzerActivity.set(buzzerId, {
      groupId: groupId,
      lastSeen: Date.now(),
      isPhysical: !buzzerId.startsWith('virtual_')
    });
  }

  // Update online buzzer status (called from ESP32 events)
  updateBuzzerOnlineStatus(buzzerId, isOnline) {
    if (isOnline) {
      this.onlineBuzzers.add(buzzerId.toString());
    } else {
      this.onlineBuzzers.delete(buzzerId.toString());
    }
  }

  // Get current online buzzer IDs
  getOnlineBuzzerIds() {
    return Array.from(this.onlineBuzzers);
  }

  async getAvailableTeamsForVirtual(gameId) {
    const game = await this.getGame(gameId);
    if (!game || !game.virtual_buzzers_enabled) {
      return [];
    }

    const onlineBuzzerIds = this.getOnlineBuzzerIds();
    
    return game.groups.filter(team => {
      // Team is available if its buzzer_id is NOT in the online buzzers list
      const teamBuzzerId = team.buzzer_id?.toString();
      const hasOnlinePhysicalBuzzer = teamBuzzerId && onlineBuzzerIds.includes(teamBuzzerId);
      
      return !hasOnlinePhysicalBuzzer;
    });
  }

  // Global Game Management Methods
  async setCurrentGlobalGame(gameId) {
    if (gameId) {
      const game = await this.getGame(gameId);
      this.currentGlobalGame = gameId;
      
      // Notify all connected clients about the new global game
      this.io.emit('global-game-changed', {
        gameId: gameId,
        game: game
      });
      
      return game;
    } else {
      this.currentGlobalGame = null;
      this.io.emit('global-game-changed', {
        gameId: null,
        game: null
      });
      return null;
    }
  }

  getCurrentGlobalGame() {
    return this.currentGlobalGame;
  }

  async getCurrentGlobalGameData() {
    if (!this.currentGlobalGame) {
      return null;
    }
    return await this.getGame(this.currentGlobalGame);
  }

  // This method should be called when a client connects to get the current global game
  async getGlobalGameStatus() {
    if (!this.currentGlobalGame) {
      return { gameId: null, game: null };
    }
    
    const game = await this.getGame(this.currentGlobalGame);
    return { gameId: this.currentGlobalGame, game };
  }

  // Show correct answer on display
  async showCorrectAnswer(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    const currentQuestionIndex = game.current_question_index;
    if (currentQuestionIndex === null || currentQuestionIndex === undefined) {
      throw new Error('No current question available');
    }

    const currentQuestion = game.questions[currentQuestionIndex];
    if (!currentQuestion) {
      throw new Error('Current question not found');
    }

    // Emit socket event to display the correct answer
    this.io.to(`game-${gameId}`).emit('show-correct-answer', {
      gameId,
      questionId: currentQuestion.id,
      correctAnswer: currentQuestion.correct_answer,
      questionText: currentQuestion.text
    });

    return {
      success: true,
      correctAnswer: currentQuestion.correct_answer,
      questionText: currentQuestion.text
    };
  }

  // Hide correct answer on display
  async hideCorrectAnswer(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    // Emit socket event to hide the correct answer
    this.io.to(`game-${gameId}`).emit('hide-correct-answer', {
      gameId
    });

    return {
      success: true,
      message: 'Correct answer hidden'
    };
  }

  // Display font size controls
  async increaseDisplayFontSize(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    // Get current font size or default to 100%
    let currentFontSize = game.display_font_size || 100;
    
    // Increase by 10%, max 200%
    const newFontSize = Math.min(200, currentFontSize + 10);
    
    // Update in database
    await this.db.run(
      'UPDATE games SET display_font_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newFontSize, gameId]
    );

    // Emit socket event to all displays
    this.io.to(`game-${gameId}`).emit('font-size-changed', {
      gameId,
      fontSize: newFontSize
    });

    return {
      success: true,
      fontSize: newFontSize
    };
  }

  async decreaseDisplayFontSize(gameId) {
    const game = await this.getGame(gameId);
    if (!game) throw new Error('Game not found');

    // Get current font size or default to 100%
    let currentFontSize = game.display_font_size || 100;
    
    // Decrease by 10%, min 50%
    const newFontSize = Math.max(50, currentFontSize - 10);
    
    // Update in database
    await this.db.run(
      'UPDATE games SET display_font_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newFontSize, gameId]
    );

    // Emit socket event to all displays
    this.io.to(`game-${gameId}`).emit('font-size-changed', {
      gameId,
      fontSize: newFontSize
    });

    return {
      success: true,
      fontSize: newFontSize
    };
  }
}

module.exports = GameService;
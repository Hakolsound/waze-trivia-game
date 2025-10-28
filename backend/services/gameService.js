const { v4: uuidv4 } = require('uuid');

// Centralized timing utility for consistent timestamps across all components
class TimingService {
  static now() {
    return Date.now();
  }

  static getElapsedTime(startTime) {
    return this.now() - startTime;
  }

  static formatTimestamp(timestamp) {
    return new Date(timestamp).toISOString();
  }

  // High-precision timing for game events (when available)
  static getPreciseTime() {
    // Use performance.now() if available (browser), otherwise Date.now()
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return this.now();
  }
}

class GameService {
  constructor(database, io, esp32Service = null) {
    this.db = database;
    this.io = io;
    this.esp32Service = esp32Service;
    this.activeGames = new Map();
    this.currentGlobalGame = null; // Global current game for all frontend apps
    this.buzzerActivity = new Map(); // Track last activity for each buzzer
    this.onlineBuzzers = new Set(); // Track which buzzer IDs are currently online
    this.timerOperationLock = new Set(); // Prevent concurrent timer operations
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

  async updateGame(gameId, updateData) {
    const game = await this.db.get('SELECT * FROM games WHERE id = ?', [gameId]);
    if (!game) throw new Error('Game not found');

    const allowedFields = ['name', 'description'];
    const updates = [];
    const values = [];

    for (const [field, value] of Object.entries(updateData)) {
      if (allowedFields.includes(field)) {
        updates.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(gameId);
    await this.db.run(
      `UPDATE games SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

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
      global.consoleLogger?.error(`Question index ${questionIndex} out of bounds for game ${gameId}`);
      throw new Error('Question index out of bounds');
    }

    global.consoleLogger?.game(`Starting question ${questionIndex + 1} for game ${gameId}`);

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

    // FORCE clear any existing answered buzzers from previous question
    if (existingGameState && existingGameState.answeredBuzzers && existingGameState.answeredBuzzers.length > 0) {
      console.log(`[START] FORCE clearing previous answered buzzers: [${existingGameState.answeredBuzzers.map(ab => ab.buzzer_id).join(', ')}]`);
    }

    // Set up the new timeout
    const timeoutId = setTimeout(() => {
      this.endQuestion(gameId);
    }, currentQuestion.time_limit * 1000);

    this.activeGames.set(gameId, {
      questionId: currentQuestion.id,
      startTime: TimingService.now(),
      buzzerOrder: [],
      answeredBuzzers: [], // Track buzzers that have already answered THIS question (correctly or incorrectly)
      timeLimit: currentQuestion.time_limit * 1000,
      timeoutId: timeoutId,
      isPaused: false,
      pausedAt: null,
      totalPausedDuration: 0
    });

    console.log(`[START] Question ${questionIndex} started - answered buzzers list reset to empty for new question`);

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
    // Prevent concurrent timer operations
    if (this.timerOperationLock.has(gameId)) {
      console.log(`Timer operation already in progress for game ${gameId}, skipping pause`);
      return;
    }

    this.timerOperationLock.add(gameId);

    try {
      const gameState = this.activeGames.get(gameId);
      if (!gameState || gameState.isPaused) {
        return;
      }

      // Clear the timeout
      if (gameState.timeoutId) {
        clearTimeout(gameState.timeoutId);
        gameState.timeoutId = null;
      }

    gameState.isPaused = true;
    gameState.pausedAt = TimingService.now();

      // Emit pause event to all clients
      this.io.to(`game-${gameId}`).emit('timer-paused', {
        gameId,
        pausedAt: gameState.pausedAt,
        timeElapsed: gameState.pausedAt - gameState.startTime - gameState.totalPausedDuration
      });

      console.log(`Question timer paused for game ${gameId}`);
    } finally {
      this.timerOperationLock.delete(gameId);
    }
  }

  resumeQuestion(gameId) {
    // Prevent concurrent timer operations
    if (this.timerOperationLock.has(gameId)) {
      console.log(`Timer operation already in progress for game ${gameId}, skipping resume`);
      return;
    }

    this.timerOperationLock.add(gameId);

    try {
      const gameState = this.activeGames.get(gameId);
      if (!gameState || !gameState.isPaused) {
        return;
      }

      // Calculate pause duration and add to total
      const pauseDuration = TimingService.now() - gameState.pausedAt;
      gameState.totalPausedDuration += pauseDuration;
      gameState.isPaused = false;
      gameState.pausedAt = null;

      // Calculate remaining time and set new timeout
      const effectiveElapsed = TimingService.now() - gameState.startTime - gameState.totalPausedDuration;
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
        resumedAt: TimingService.now(),
        timeRemaining: remainingTime,
        totalPausedDuration: gameState.totalPausedDuration
      });

      console.log(`Question timer resumed for game ${gameId}, ${remainingTime}ms remaining`);
    } finally {
      this.timerOperationLock.delete(gameId);
    }
  }

  async endQuestion(gameId) {
    global.consoleLogger?.game(`Ending question for game ${gameId}`);

    // Prevent concurrent timer operations
    if (this.timerOperationLock.has(gameId)) {
      global.consoleLogger?.game(`Timer operation already in progress for game ${gameId}, queuing endQuestion`, 'warning');
      // Queue the endQuestion to run after current operation completes
      setImmediate(() => this.endQuestion(gameId));
      return;
    }

    this.timerOperationLock.add(gameId);

    try {
      const gameState = this.activeGames.get(gameId);
      if (!gameState) {
        global.consoleLogger?.warning(`No active game state found for game ${gameId} in endQuestion`);
        return;
      }

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

        // Send end round command to reset all buzzers to their proper state
        await this.esp32Service.endRound(0); // 0 = all devices
      } catch (error) {
        console.error('Failed to disarm physical buzzers:', error);
      }
    }

    // Disarm buzzers for both host control and all game clients (including virtual buzzers)
    this.io.to('control-panel').emit('buzzers-disarmed', { gameId });
    this.io.to(`game-${gameId}`).emit('buzzers-disarmed', { gameId });

    // Remove the game state to prevent any lingering timers
    this.activeGames.delete(gameId);
    } finally {
      this.timerOperationLock.delete(gameId);
    }
  }

  async evaluateAnswer(gameId, isCorrect, buzzerPosition = 0) {
    console.log(`[EVAL] Starting evaluation - gameId: ${gameId}, buzzerPosition: ${buzzerPosition}, isCorrect: ${isCorrect}`);

    const gameState = this.activeGames.get(gameId);

    if (!gameState || !gameState.buzzerOrder.length) {
      throw new Error('No active question or buzzer presses found');
    }

    console.log(`[EVAL] BuzzerOrder: ${JSON.stringify(gameState.buzzerOrder.map(b => ({groupId: b.groupId, position: b.position, evaluated: b.evaluated})))}`);

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

    console.log(`[EVAL] Found buzzer entry at position ${buzzerPosition}: groupId=${buzzerEntry.groupId}, deltaMs=${buzzerEntry.deltaMs}`);

    // Get team name for logging
    const teams = await this.db.all('SELECT id, name FROM groups WHERE game_id = ?', [gameId]);
    const currentTeam = teams.find(t => t.id === buzzerEntry.groupId);
    console.log(`[EVAL] Evaluating team: ${currentTeam?.name || 'Unknown'} (${buzzerEntry.groupId})`);

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
      // Incorrect answers - apply time-based scoring to negative points too
      if (game.time_based_scoring) {
        // Calculate time remaining when buzzer was pressed
        const timeElapsed = buzzerEntry.deltaMs;
        const questionTimeLimit = currentQuestion.time_limit || 30; // Default to 30s if not set
        const totalTime = questionTimeLimit * 1000;
        const timeRemaining = Math.max(0, totalTime - timeElapsed);

        // Calculate time-based points, then make negative and apply half penalty
        const timeBasedPoints = this.calculateTimeBasedPoints(currentQuestion.points, timeRemaining, totalTime);
        pointsToAward = -Math.floor(timeBasedPoints * 0.5);
      } else {
        // Non time-based: lose half of base points
        pointsToAward = -Math.floor(currentQuestion.points * 0.5);
      }
    }
    console.log(`[EVAL] Calculated points: ${pointsToAward} for team ${currentTeam?.name} (${buzzerEntry.groupId})`);

    // Award or deduct points
    console.log(`[EVAL] About to award ${pointsToAward} points to groupId: ${buzzerEntry.groupId}`);
    await this.awardPoints(gameId, buzzerEntry.groupId, pointsToAward);
    
    // Mark this buzzer entry as evaluated
    buzzerEntry.evaluated = true;
    buzzerEntry.isCorrect = isCorrect;
    buzzerEntry.pointsAwarded = pointsToAward;

    // Check for duplicate evaluation first to prevent duplicate feedback commands
    const alreadyAnswered = gameState.answeredBuzzers.some(ab => ab.buzzer_id === buzzerEntry.buzzer_id);
    if (alreadyAnswered) {
      console.log(`[EVAL] WARNING: Buzzer ${buzzerEntry.buzzer_id} already evaluated - ignoring duplicate evaluation call`);
      return {
        success: false,
        isCorrect: false,
        pointsAwarded: 0,
        nextInLine: false,
        questionComplete: false,
        error: 'Buzzer already evaluated'
      };
    }

    // Send LED feedback to the buzzer
    if (this.esp32Service) {
      // Use the actual buzzer device ID from the buzzer press event
      const buzzerDeviceId = parseInt(buzzerEntry.buzzer_id) || buzzerEntry.buzzer_id;
      if (isCorrect) {
        await this.esp32Service.sendCorrectAnswerFeedback(buzzerDeviceId);
      } else {
        await this.esp32Service.sendWrongAnswerFeedback(buzzerDeviceId);
        // Wait briefly to ensure wrong answer feedback reaches and is processed by the buzzer
        // before sending re-arm commands to other buzzers
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Track that this buzzer has answered (correctly or incorrectly)
    const answeredBuzzer = {
      buzzer_id: buzzerEntry.buzzer_id,
      groupId: buzzerEntry.groupId,
      isCorrect: isCorrect,
      timestamp: TimingService.now()
    };
    gameState.answeredBuzzers.push(answeredBuzzer);
    console.log(`[EVAL] Added buzzer ${buzzerEntry.buzzer_id} to answered list (${isCorrect ? 'correct' : 'wrong'})`);

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
      // Correct answer - wait 2 seconds for green LED fade to complete before ending
      console.log(`[EVAL] Correct answer - waiting 2 seconds for LED feedback before ending round`);
      setTimeout(async () => {
        await this.endQuestion(gameId);
        await this.prepareNextQuestion(gameId);
      }, 2000); // 2 second delay to match buzzer green fade duration
    } else {
      // Wrong answer - clear buzzer order and resume timer for fresh attempts
      console.log(`[EVAL] Wrong answer - clearing buzzer order and resuming timer`);
      gameState.buzzerOrder = [];

      // Resume timer for remaining time
      if (gameState.isPaused) {
        this.resumeQuestion(gameId);
      }

      // RE-ARM ONLY BUZZERS that haven't answered yet (exclude buzzers that already answered wrong)
      if (this.esp32Service) {
        // Get all groups for this game to find their buzzer IDs
        const allGroups = await this.db.all('SELECT buzzer_id FROM groups WHERE game_id = ?', [gameId]);
        const allBuzzerIds = allGroups.map(g => g.buzzer_id).filter(id => id); // Remove null/empty buzzer IDs

        // Filter out buzzers that have already answered
        const answeredBuzzerIds = gameState.answeredBuzzers.map(ab => ab.buzzer_id);
        const availableBuzzerIds = allBuzzerIds.filter(buzzerI => !answeredBuzzerIds.includes(buzzerI));

        console.log(`[EVAL] Re-arming only available buzzers after wrong answer:`);
        console.log(`[EVAL] All buzzers: [${allBuzzerIds.join(', ')}]`);
        console.log(`[EVAL] Already answered: [${answeredBuzzerIds.join(', ')}]`);
        console.log(`[EVAL] Available to arm: [${availableBuzzerIds.join(', ')}]`);

        await this.esp32Service.armSpecificBuzzers(gameId, availableBuzzerIds);
      }
    }

    return {
      success: true,
      isCorrect,
      pointsAwarded: pointsToAward,
      nextInLine: false, // No queue system - buzzers re-arm after wrong answers
      questionComplete: isCorrect // Question only complete when answered correctly
    };
  }

  async prepareNextQuestion(gameId) {
    // Clear answered buzzers list to prevent it from carrying over to next question
    const gameState = this.activeGames.get(gameId);
    if (gameState) {
      console.log(`[PREP] Clearing answered buzzers list for next question: was [${gameState.answeredBuzzers.map(ab => ab.buzzer_id).join(', ')}]`);
      gameState.answeredBuzzers = [];
    }

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
      timeRemaining: Math.max(0, gameState.timeLimit - (TimingService.now() - gameState.startTime))
    };
  }

  async handleBuzzerPress(data) {
    const { gameId, groupId, timestamp, buzzer_id, buzzerId, deltaMs: providedDeltaMs } = data;
    const buzzerIdStr = buzzerId || buzzer_id;
    global.consoleLogger?.game(`Buzzer press - gameId: ${gameId}, groupId: ${groupId}, buzzer: ${buzzerIdStr}`);

    const gameState = this.activeGames.get(gameId);
    if (!gameState) {
      global.consoleLogger?.game(`No active game state for game ${gameId}`, 'warning');
      return;
    }

    // Resolve the actual group ID using simplified mapping logic
    const actualGroupId = await this.resolveGroupId(gameId, groupId, buzzer_id || buzzerId);

    if (!actualGroupId) {
      global.consoleLogger?.error(`Could not resolve group ID for buzzer press: gameId=${gameId}, groupId=${groupId}, buzzer=${buzzerIdStr}`);
      return;
    }

    // Track buzzer activity for virtual buzzer availability
    const actualBuzzerId = buzzerId || buzzer_id || `physical_${actualGroupId}`;
    this.updateBuzzerActivity(actualBuzzerId, actualGroupId);

    // Always use JavaScript timing for physical buzzers (ESP32 deltaMs is unreliable)
    // Calculate actual elapsed time from when question started
    const deltaMs = timestamp - gameState.startTime;

    // Get team name for logging
    const teams = await this.db.all('SELECT id, name FROM groups WHERE game_id = ?', [gameId]);
    const team = teams.find(t => t.id === actualGroupId);

    const buzzerEntry = {
      groupId: actualGroupId,
      buzzer_id: buzzer_id || buzzerId,
      timestamp,
      deltaMs,
      position: gameState.buzzerOrder.length + 1
    };

    console.log(`[BUZZ] Adding to buzzer order: ${team?.name || 'Unknown'} (${actualGroupId}) at position ${buzzerEntry.position}, deltaMs: ${deltaMs}`);

    gameState.buzzerOrder.push(buzzerEntry);

    // PAUSE TIMER when first team buzzes in
    if (gameState.buzzerOrder.length === 1 && !gameState.isPaused) {
      this.pauseQuestion(gameId);

      // NOTE: Not disarming buzzers immediately anymore - they should stay armed until evaluation
      // The buzzing buzzer stays in ANSWERING_NOW state, others can still buzz but timer is paused
      console.log(`[BUZZ] Timer paused, buzzer stays armed for evaluation`);
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
    console.log(`[SCORE] awardPoints called - groupId: ${groupId}, points: ${points}`);

    const game = await this.getGame(gameId);
    const allowNegativeScores = Boolean(game.allow_negative_scores);

    // Debug: Check what groups exist for this game
    const allGroups = await this.db.all('SELECT * FROM groups WHERE game_id = ?', [gameId]);

    // Get current score before update
    const currentGroup = await this.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    console.log(`[SCORE] Current group found: ${currentGroup?.name} (${groupId}) with score: ${currentGroup?.score}`);

    const currentScore = currentGroup ? currentGroup.score : 0;
    const newScore = currentScore + points;

    // Debug logging for negative scores

    // If negative scores are not allowed, clamp at 0
    const finalScore = allowNegativeScores ? newScore : Math.max(0, newScore);
    const actualPointsAwarded = finalScore - currentScore;

    console.log(`[SCORE] Updating ${currentGroup?.name}: ${currentScore} + ${points} = ${finalScore}`);

    await this.db.run(
      'UPDATE groups SET score = ? WHERE id = ? AND game_id = ?',
      [finalScore, groupId, gameId]
    );

    const updatedGroup = await this.db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    console.log(`[SCORE] Final result: ${updatedGroup?.name} now has score: ${updatedGroup?.score}`);

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
        timeRemaining: Math.max(0, gameState.timeLimit - (TimingService.now() - gameState.startTime))
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

  // Buzzer ID Resolution Helper
  async resolveGroupId(gameId, providedGroupId, buzzerId) {
    try {
      // Case 1: Virtual buzzers - groupId is already the correct database ID
      if (buzzerId && buzzerId.startsWith('virtual_')) {
        console.log(`[BUZZ] Virtual buzzer detected: ${buzzerId}, using provided groupId: ${providedGroupId}`);
        return providedGroupId;
      }

      // Case 2: Physical buzzers with buzzer_id - look up in database
      if (buzzerId && /^\d+$/.test(buzzerId.toString())) {
        const groupRecord = await this.db.get(
          'SELECT id FROM groups WHERE game_id = ? AND buzzer_id = ?',
          [gameId, buzzerId.toString()]
        );

        if (groupRecord) {
          console.log(`[BUZZ] Physical buzzer ${buzzerId} mapped to group ${groupRecord.id}`);
          return groupRecord.id;
        } else {
          console.warn(`[BUZZ] Physical buzzer ${buzzerId} not found in database for game ${gameId}`);
        }
      }

      // Case 3: Fallback - assume provided groupId is already correct (for legacy support)
      console.log(`[BUZZ] Using provided groupId as fallback: ${providedGroupId}`);
      return providedGroupId;

    } catch (error) {
      console.error(`[BUZZ] Error resolving group ID:`, error);
      return null;
    }
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
      lastSeen: TimingService.now(),
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
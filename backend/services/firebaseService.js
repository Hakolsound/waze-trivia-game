const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');

class FirebaseService {
  constructor() {
    this.app = null;
    this.db = null;
    this.isConnectedFlag = false;
  }

  async initialize() {
    try {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const privateKeyPath = process.env.FIREBASE_PRIVATE_KEY_PATH;

      if (!projectId) {
        console.log('Firebase integration disabled: FIREBASE_PROJECT_ID not configured');
        return;
      }

      let serviceAccount;
      
      if (privateKeyPath && await this.fileExists(privateKeyPath)) {
        const serviceAccountContent = await fs.readFile(privateKeyPath, 'utf8');
        serviceAccount = JSON.parse(serviceAccountContent);
      } else {
        console.log('Firebase integration disabled: Service account key not found');
        return;
      }

      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId,
        databaseURL: `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app/`
      });

      this.db = this.app.database();
      this.isConnectedFlag = true;
      
      console.log('Firebase integration initialized successfully');
      
      await this.setupRealtimeListeners();
      
    } catch (error) {
      console.warn('Firebase initialization failed, continuing without Firebase sync:', error.message);
      this.isConnectedFlag = false;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async setupRealtimeListeners() {
    if (!this.isConnectedFlag) return;

    try {
      const gamesRef = this.db.ref('games');
      
      gamesRef.on('child_changed', (snapshot) => {
        console.log('Firebase game updated:', snapshot.key);
      });
      
      gamesRef.on('child_added', (snapshot) => {
        console.log('Firebase game added:', snapshot.key);
      });
      
    } catch (error) {
      console.error('Error setting up Firebase listeners:', error);
    }
  }

  async syncGameState(gameId, gameState) {
    if (!this.isConnectedFlag) return null;

    try {
      const gameRef = this.db.ref(`games/${gameId}`);
      await gameRef.update({
        ...gameState,
        lastSync: admin.database.ServerValue.TIMESTAMP
      });
      
      return true;
    } catch (error) {
      console.error('Error syncing game state to Firebase:', error);
      return false;
    }
  }

  async syncScoreUpdate(gameId, groupId, newScore, pointsAwarded) {
    if (!this.isConnectedFlag) return null;

    try {
      const scoreRef = this.db.ref(`games/${gameId}/scores/${groupId}`);
      await scoreRef.update({
        score: newScore,
        lastUpdate: admin.database.ServerValue.TIMESTAMP,
        pointsAwarded: pointsAwarded
      });
      
      return true;
    } catch (error) {
      console.error('Error syncing score update to Firebase:', error);
      return false;
    }
  }

  async syncBuzzerEvent(gameId, buzzerEvent) {
    if (!this.isConnectedFlag) return null;

    try {
      const eventsRef = this.db.ref(`games/${gameId}/buzzerEvents`);
      await eventsRef.push({
        ...buzzerEvent,
        timestamp: admin.database.ServerValue.TIMESTAMP
      });
      
      return true;
    } catch (error) {
      console.error('Error syncing buzzer event to Firebase:', error);
      return false;
    }
  }

  async getGameState(gameId) {
    if (!this.isConnectedFlag) return null;

    try {
      const gameRef = this.db.ref(`games/${gameId}`);
      const snapshot = await gameRef.once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting game state from Firebase:', error);
      return null;
    }
  }

  async backupGameResults(gameId, results) {
    if (!this.isConnectedFlag) return null;

    try {
      const backupRef = this.db.ref(`backups/games/${gameId}`);
      await backupRef.set({
        ...results,
        backupTime: admin.database.ServerValue.TIMESTAMP
      });
      
      return true;
    } catch (error) {
      console.error('Error backing up game results to Firebase:', error);
      return false;
    }
  }

  async subscribeToRemoteUpdates(gameId, callback) {
    if (!this.isConnectedFlag) return null;

    try {
      const gameRef = this.db.ref(`games/${gameId}`);
      gameRef.on('value', (snapshot) => {
        callback(snapshot.val());
      });
      
      return () => gameRef.off();
    } catch (error) {
      console.error('Error subscribing to remote updates:', error);
      return null;
    }
  }

  isConnected() {
    return this.isConnectedFlag;
  }

  async close() {
    if (this.app) {
      await this.app.delete();
      console.log('Firebase connection closed');
    }
  }
}

module.exports = FirebaseService;
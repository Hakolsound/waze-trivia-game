/**
 * AudioManager - Handles TTS announcements and sound effects for game display
 */
class AudioManager {
    constructor() {
        this.settings = {
            ttsEnabled: false,
            ttsVoice: 'en-US',
            ttsSpeed: 1.0,
            ttsVolume: 0.8,
            sfxEnabled: false,
            correctSfxUrl: 'random',
            wrongSfxUrl: 'random',
            sfxVolume: 0.7
        };

        this.ttsSupported = 'speechSynthesis' in window;
        this.audioContext = null;
        this.currentUtterance = null;
        this.audioInitialized = false; // Track if user has interacted to enable audio

        // Pre-load sound effects for better performance
        this.sfxCache = new Map();

        // Available sound files for random selection
        this.correctSounds = [
            '/shared/assets/sounds/correct/correct-1.wav',
            '/shared/assets/sounds/correct/correct-2.wav',
            '/shared/assets/sounds/correct/correct-3.wav',
            '/shared/assets/sounds/correct/correct-4.wav'
        ];

        this.wrongSounds = [
            '/shared/assets/sounds/Wrong/wrong-1.wav',
            '/shared/assets/sounds/Wrong/wrong-2.wav',
            '/shared/assets/sounds/Wrong/wrong-3.wav',
            '/shared/assets/sounds/Wrong/wrong-4.wav',
            '/shared/assets/sounds/Wrong/wrong-5.wav'
        ];

        if (!this.ttsSupported) {
            console.warn('[AudioManager] Text-to-Speech not supported in this browser');
        }
    }

    /**
     * Initialize audio on user interaction (required by browser autoplay policies)
     */
    async initializeAudio() {
        if (this.audioInitialized) return true;

        try {
            // Play a silent sound to unlock audio
            const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
            await silentAudio.play();

            // Initialize TTS by speaking a silent utterance
            if (this.ttsSupported) {
                const silentUtterance = new SpeechSynthesisUtterance('');
                silentUtterance.volume = 0;
                window.speechSynthesis.speak(silentUtterance);
            }

            this.audioInitialized = true;
            console.log('[AudioManager] Audio initialized successfully');
            return true;
        } catch (error) {
            console.error('[AudioManager] Failed to initialize audio:', error);
            return false;
        }
    }

    /**
     * Update audio settings from backend/firebase
     */
    updateSettings(newSettings) {
        if (!newSettings) return;

        this.settings = {
            ...this.settings,
            ...newSettings
        };

        console.log('[AudioManager] Settings updated:', this.settings);

        // Pre-load sound effects if enabled
        if (this.settings.sfxEnabled) {
            // If using random, pre-load all sounds
            if (this.settings.correctSfxUrl === 'random') {
                this.correctSounds.forEach(url => this.preloadSfx(url));
            } else {
                this.preloadSfx(this.settings.correctSfxUrl);
            }

            if (this.settings.wrongSfxUrl === 'random') {
                this.wrongSounds.forEach(url => this.preloadSfx(url));
            } else {
                this.preloadSfx(this.settings.wrongSfxUrl);
            }
        }
    }

    /**
     * Pre-load a sound effect for faster playback
     */
    preloadSfx(url) {
        if (!url || this.sfxCache.has(url)) return;

        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = this.settings.sfxVolume;

        // Add to cache
        this.sfxCache.set(url, audio);

        // Handle load errors
        audio.addEventListener('error', () => {
            console.error(`[AudioManager] Failed to load sound: ${url}`);
            this.sfxCache.delete(url);
        });
    }

    /**
     * Announce team name using Text-to-Speech
     */
    announceTeamName(teamName) {
        if (!this.settings.ttsEnabled || !this.ttsSupported || !teamName) {
            return;
        }

        // Create utterance (don't cancel - browser will handle interruption)
        const utterance = new SpeechSynthesisUtterance(teamName);

        // Set voice by name if specified (not default)
        if (this.settings.ttsVoice && this.settings.ttsVoice !== 'default') {
            const voices = window.speechSynthesis.getVoices();
            const voice = voices.find(v => v.name === this.settings.ttsVoice);
            if (voice) {
                utterance.voice = voice;
            }
        }

        utterance.rate = this.settings.ttsSpeed;
        utterance.volume = this.settings.ttsVolume;

        // Store reference to current utterance
        this.currentUtterance = utterance;

        // Handle errors
        utterance.addEventListener('error', (event) => {
            console.error('[AudioManager] TTS error:', event);
        });

        // Speak
        window.speechSynthesis.speak(utterance);
        console.log(`[AudioManager] Announcing team: ${teamName} with voice: ${this.settings.ttsVoice}`);
    }

    /**
     * Get a random sound from an array
     */
    getRandomSound(soundArray) {
        const randomIndex = Math.floor(Math.random() * soundArray.length);
        return soundArray[randomIndex];
    }

    /**
     * Play correct answer sound effect
     */
    playCorrectSfx() {
        let url = this.settings.correctSfxUrl;

        // If random is selected, pick a random correct sound
        if (url === 'random') {
            url = this.getRandomSound(this.correctSounds);
        }

        this.playSfx(url, 'correct');
    }

    /**
     * Play wrong answer sound effect
     */
    playWrongSfx() {
        let url = this.settings.wrongSfxUrl;

        // If random is selected, pick a random wrong sound
        if (url === 'random') {
            url = this.getRandomSound(this.wrongSounds);
        }

        this.playSfx(url, 'wrong');
    }

    /**
     * Play a sound effect
     */
    playSfx(url, type = 'unknown') {
        if (!this.settings.sfxEnabled || !url) {
            return;
        }

        // Try to get from cache first
        let audio = this.sfxCache.get(url);

        if (!audio) {
            // Create new audio if not cached
            audio = new Audio(url);
            audio.volume = this.settings.sfxVolume;
            this.sfxCache.set(url, audio);
        } else {
            // Reset audio to beginning if it was played before
            audio.currentTime = 0;
            audio.volume = this.settings.sfxVolume;
        }

        // Play sound
        audio.play()
            .then(() => {
                console.log(`[AudioManager] Playing ${type} SFX: ${url}`);
            })
            .catch(error => {
                console.error(`[AudioManager] Failed to play ${type} SFX:`, error);
            });
    }

    /**
     * Handle answer evaluation - play SFX and announce team name
     */
    handleAnswerEvaluation(teamName, isCorrect) {
        console.log(`[AudioManager] Handling evaluation: ${teamName}, correct: ${isCorrect}`);

        // Play sound effect first
        if (isCorrect) {
            this.playCorrectSfx();
        } else {
            this.playWrongSfx();
        }

        // Announce team name with slight delay to not overlap with SFX
        if (teamName) {
            setTimeout(() => {
                this.announceTeamName(teamName);
            }, 200);
        }
    }

    /**
     * Stop all audio (TTS and SFX)
     */
    stopAll() {
        // Stop TTS
        if (this.ttsSupported) {
            window.speechSynthesis.cancel();
        }

        // Stop all SFX
        for (const audio of this.sfxCache.values()) {
            audio.pause();
            audio.currentTime = 0;
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.stopAll();
        this.sfxCache.clear();
        this.currentUtterance = null;
    }
}

// Make AudioManager available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioManager;
}

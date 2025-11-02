# Audio Features Implementation

## Overview

Added two audio features to the game display:
1. **Team Name Announcement (TTS)** - Text-to-speech announces the team name when they buzz and get evaluated
2. **Answer Sound Effects (SFX)** - Play sounds for correct/wrong answer evaluations

Both features are configurable via the Admin Dashboard and synced to Firebase for real-time updates across all displays.

## Implementation Summary

### Phase 1: Database & Backend ✅

**Files Modified:**
- [backend/services/firebaseService.js](backend/services/firebaseService.js) - Added `getAudioSettings()` and `saveAudioSettings()` methods
- [backend/services/gameService.js](backend/services/gameService.js) - Added audio settings methods with Firebase sync and Socket.IO broadcast
- [backend/routes/games.js](backend/routes/games.js) - Added GET/PUT endpoints for `/api/games/:id/audio-settings`

**API Endpoints:**
- `GET /api/games/:gameId/audio-settings` - Fetch audio settings
- `PUT /api/games/:gameId/audio-settings` - Save audio settings and broadcast to displays

**Settings Structure:**
```javascript
{
  ttsEnabled: false,
  ttsVoice: 'en-US',
  ttsSpeed: 1.0,
  ttsVolume: 0.8,
  sfxEnabled: false,
  correctSfxUrl: '/assets/sounds/correct-1.mp3',
  wrongSfxUrl: '/assets/sounds/wrong-1.mp3',
  sfxVolume: 0.7
}
```

### Phase 2: Admin Panel UI ✅

**Files Modified:**
- [frontend/admin-config/index.html](frontend/admin-config/index.html#L205-L309) - Added audio settings panel to Settings tab
- [frontend/admin-config/admin.js](frontend/admin-config/admin.js) - Added audio settings UI logic

**Admin Panel Features:**
- **TTS Settings Section:**
  - Enable/disable toggle
  - Voice/accent dropdown (11 languages)
  - Speech speed slider (0.5x - 2.0x)
  - Volume slider (0-100%)
  - Test button to preview voice

- **SFX Settings Section:**
  - Enable/disable toggle
  - Correct answer sound dropdown (4 options)
  - Wrong answer sound dropdown (4 options)
  - Volume slider (0-100%)
  - Test buttons for each sound

**Location:** Admin Config → Settings Tab → Audio Settings

### Phase 3: Game Display Implementation ✅

**Files Created:**
- [frontend/shared/AudioManager.js](frontend/shared/AudioManager.js) - Standalone audio management class

**Files Modified:**
- [frontend/game-display/index.html](frontend/game-display/index.html#L11) - Added AudioManager script
- [frontend/game-display/display.js](frontend/game-display/display.js) - Integrated AudioManager

**AudioManager Features:**
- Web Speech API integration for TTS
- HTML5 Audio API for SFX playback
- Sound effect pre-loading and caching
- Real-time settings updates via Socket.IO
- Error handling for unsupported browsers

**Integration Points:**
- Audio settings loaded when game is selected
- Settings updated in real-time via `audio-settings-updated` socket event
- Audio plays in `handleAnswerResult()` when answer is evaluated
- Team name announced + SFX played simultaneously (with 200ms delay between)

### Phase 4: Sound Assets 📋

**Files Created:**
- [frontend/shared/assets/sounds/README.md](frontend/shared/assets/sounds/README.md) - Instructions for obtaining sound files

**Required Sound Files (not included):**
- `correct-1.mp3` through `correct-4.mp3`
- `wrong-1.mp3` through `wrong-4.mp3`

**Next Steps:**
1. Download 8 sound effect files from free sources (see README.md)
2. Place them in `frontend/shared/assets/sounds/`
3. Test using Admin Config panel

## How It Works

### Flow Diagram

```
Admin Config                  Backend                    Game Display
     |                          |                             |
     | Save Audio Settings      |                             |
     |------------------------->|                             |
     |                          |                             |
     |                   Save to Firebase                     |
     |                   Broadcast via Socket.IO              |
     |                          |----------------------------->|
     |                          |   audio-settings-updated    |
     |                          |                             |
     |                          |                   Update AudioManager
     |                          |                             |
     |                          |                             |
     |                     Answer Evaluated                   |
     |                          |----------------------------->|
     |                          |   answer-evaluated event    |
     |                          |                             |
     |                          |              Get team name from teamNames Map
     |                          |              AudioManager.handleAnswerEvaluation()
     |                          |                 - Play SFX (correct/wrong)
     |                          |                 - Announce team name (TTS)
```

### Code Flow

1. **Admin saves settings:**
   - Admin panel calls `PUT /api/games/:gameId/audio-settings`
   - Backend saves to Firebase
   - Backend emits `audio-settings-updated` to all displays in game room

2. **Display receives settings:**
   - Socket listener catches `audio-settings-updated`
   - Calls `audioManager.updateSettings(settings)`
   - AudioManager pre-loads sound effects

3. **Answer evaluation:**
   - Host evaluates answer (correct/wrong)
   - Backend emits `answer-evaluated` event
   - Display's `handleAnswerResult()` is called
   - Gets team name from `teamNames` Map using `groupId`
   - Calls `audioManager.handleAnswerEvaluation(teamName, isCorrect)`
   - AudioManager plays SFX and announces team name

## Testing Instructions

### 1. Test Admin Panel

```bash
npm run dev
```

1. Open http://localhost:3000/admin-config
2. Select a game
3. Go to Settings → Audio Settings
4. Enable TTS:
   - Check "Enable TTS Announcements"
   - Select a voice (e.g., English US)
   - Adjust speed and volume
   - Click "🔊 Test Voice" - should say "Team Alpha"

5. Enable SFX (after adding sound files):
   - Check "Enable Sound Effects"
   - Select sounds from dropdowns
   - Click "▶️ Test" buttons
   - Should play selected sounds

6. Click "💾 Save Audio Settings"
7. Verify toast message confirms save

### 2. Test Game Display

1. Open http://localhost:3000/display in a separate window/tab
2. Ensure same game is selected
3. Settings should load automatically
4. Start a question and have a team buzz
5. Evaluate answer (correct or wrong)
6. Should hear:
   - Sound effect (correct or wrong)
   - Team name announcement
7. Try changing settings in Admin Config while display is open
8. Settings should update in real-time

### 3. Test Real-Time Sync

1. Open Admin Config in one browser
2. Open Game Display in another browser
3. Change audio settings in Admin Config
4. Save settings
5. Display should update immediately without refresh
6. Verify by evaluating an answer - new settings should apply

## Browser Compatibility

### Text-to-Speech (TTS)
- ✅ Chrome/Edge (best support, multiple voices)
- ✅ Safari (good support)
- ✅ Firefox (limited voice selection)
- ❌ Older browsers (gracefully degrades - no TTS)

### Sound Effects (SFX)
- ✅ All modern browsers support HTML5 Audio
- ✅ MP3 format universally supported

## Configuration

### Available TTS Voices

```javascript
'en-US' - English (US)
'en-GB' - English (UK)
'en-AU' - English (Australia)
'en-IN' - English (India)
'es-ES' - Spanish
'fr-FR' - French
'de-DE' - German
'it-IT' - Italian
'ja-JP' - Japanese
'ko-KR' - Korean
'zh-CN' - Chinese (Mandarin)
```

Note: Actual voice availability depends on the browser and operating system.

### Default Settings

```javascript
{
  ttsEnabled: false,          // TTS disabled by default
  ttsVoice: 'en-US',          // US English
  ttsSpeed: 1.0,              // Normal speed
  ttsVolume: 0.8,             // 80% volume
  sfxEnabled: false,          // SFX disabled by default
  correctSfxUrl: '/assets/sounds/correct-1.mp3',  // Chime
  wrongSfxUrl: '/assets/sounds/wrong-1.mp3',      // Buzzer
  sfxVolume: 0.7              // 70% volume
}
```

## Troubleshooting

### No TTS Voice Heard
1. Check browser console for errors
2. Verify TTS is enabled in Admin Config
3. Try different voice/accent
4. Ensure browser supports Web Speech API
5. Check system/browser volume settings

### No Sound Effects Heard
1. Verify sound files exist in `/frontend/shared/assets/sounds/`
2. Check browser console for 404 errors
3. Verify SFX is enabled in Admin Config
4. Check file paths match dropdown values
5. Test sound files directly in browser

### Settings Not Saving
1. Check Firebase connection status in Admin Config
2. Check browser console for API errors
3. Verify game is selected
4. Check backend logs for Firebase errors

### Real-Time Updates Not Working
1. Verify Socket.IO connection (check browser console)
2. Ensure both Admin Config and Display are on same game
3. Check for socket errors in browser console
4. Restart backend server if needed

## Future Enhancements

Potential improvements for future versions:

1. **Custom Sound Upload:**
   - Allow admins to upload their own sound files
   - Store in Firebase Storage
   - Manage custom sound library

2. **Advanced TTS Options:**
   - Pitch control
   - Pronunciation customization
   - Different phrases (e.g., "Correct answer from [Team Name]!")

3. **Sound Packs:**
   - Pre-configured theme packs (retro, modern, game show, etc.)
   - One-click theme switching

4. **Volume Ducking:**
   - Auto-reduce background music during announcements
   - Fade effects between sounds

5. **Accessibility:**
   - Visual indicators for deaf/hard-of-hearing users
   - Option to disable only TTS or only SFX independently

6. **Analytics:**
   - Track which sounds are most popular
   - A/B testing for sound effectiveness

## Files Modified/Created

### Backend
- ✅ `backend/services/firebaseService.js` - Lines 181-209
- ✅ `backend/services/gameService.js` - Lines 1344-1379
- ✅ `backend/routes/games.js` - Lines 408-427

### Frontend - Admin Config
- ✅ `frontend/admin-config/index.html` - Lines 205-309
- ✅ `frontend/admin-config/admin.js` - Multiple sections

### Frontend - Game Display
- ✅ `frontend/shared/AudioManager.js` - New file (190 lines)
- ✅ `frontend/game-display/index.html` - Line 11
- ✅ `frontend/game-display/display.js` - Lines 31, 237-240, 477-499, 1435-1450

### Documentation
- ✅ `frontend/shared/assets/sounds/README.md` - New file
- ✅ `AUDIO-FEATURES.md` - This file

## Commit Message

```
feat: Add audio features with TTS team name announcements and answer SFX

- Add Firebase audio settings storage and real-time sync
- Create AudioManager class for TTS (Web Speech API) and SFX (HTML5 Audio)
- Add admin panel UI for configuring voices, sounds, and volumes
- Integrate audio feedback into answer evaluation flow
- Support 11 languages for TTS with speed/volume controls
- Support multiple sound effect options for correct/wrong answers
- Add real-time settings updates via Socket.IO
- Include sound asset instructions and documentation

Files changed:
- Backend: firebaseService.js, gameService.js, routes/games.js
- Admin: index.html, admin.js
- Display: index.html, display.js
- New: AudioManager.js, sounds/README.md, AUDIO-FEATURES.md
```

## Support

For questions or issues:
1. Check browser console for errors
2. Review this documentation
3. Test with default settings first
4. Ensure Firebase is connected
5. Verify sound files are present

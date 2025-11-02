# Sound Assets for Audio Features

This directory contains sound effects for the trivia game audio features.

## Required Sound Files

The audio system expects the following sound files:

### Correct Answer Sounds
- `correct-1.mp3` - Chime sound
- `correct-2.mp3` - Bell sound
- `correct-3.mp3` - Success sound
- `correct-4.mp3` - Fanfare sound

### Wrong Answer Sounds
- `wrong-1.mp3` - Buzzer sound
- `wrong-2.mp3` - Error sound
- `wrong-3.mp3` - Fail sound
- `wrong-4.mp3` - Sad Trombone sound

## Where to Get Sound Files

You can obtain free sound effects from:

1. **Freesound.org** - https://freesound.org/
   - Search for "correct answer", "success", "error", "wrong answer"
   - Download as MP3 format
   - License: Look for CC0 or CC-BY licensed sounds

2. **Pixabay** - https://pixabay.com/sound-effects/
   - Large collection of free sound effects
   - No attribution required

3. **Zapsplat** - https://www.zapsplat.com/
   - High-quality sound effects
   - Free with attribution

4. **SoundBible** - http://soundbible.com/
   - Various sound effects
   - Check license for each sound

## File Format

- Format: MP3
- Recommended duration: 0.5 - 3 seconds
- Recommended bitrate: 128kbps or higher
- Ensure files are not too loud (normalize volume)

## Installation

1. Download 8 sound files (4 correct, 4 wrong)
2. Rename them to match the names above
3. Place them in this directory
4. Test using the Admin Config panel under Settings → Audio Settings

## Testing

After adding sound files:
1. Go to Admin Config (`/admin-config`)
2. Navigate to Settings tab → Audio Settings
3. Enable "Enable Sound Effects"
4. Use the "▶️ Test" buttons to preview each sound
5. Adjust volume using the slider

## Notes

- Sound files are cached by the browser for better performance
- If you update a sound file, you may need to hard-refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
- Keep file sizes reasonable (< 200KB per file recommended) for faster loading
- The default selections in the admin panel correspond to these filenames

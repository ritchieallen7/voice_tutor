# Voice Tutor - AI Language Learning Assistant

A conversational voice-based language learning web application powered by OpenAI's Realtime API. Designed to support students learning English through the FlashAcademy platform.

## Features

### 🎙️ Fluid Conversational Experience
- **Continuous conversation flow** - No need to press record for each word
- **Real-time voice interaction** using OpenAI's Realtime API with WebRTC
- **Natural conversation** - The AI tutor engages in flowing dialogue, not rigid repetition

### 📚 Three Practice Modes
1. **Pronunciation** - Focus on speaking words clearly with gentle corrections
2. **Vocabulary** - Test understanding of word meanings and usage in context  
3. **Conversation** - Natural dialogue using learned words

### 🌍 Multi-Language Support
- Instructions can be given in 15+ languages including:
  - Spanish, French, German, Italian, Portuguese
  - Russian, Chinese, Japanese, Korean, Arabic
  - Hindi, Turkish, Polish, Dutch, Swedish

### 📊 Learning Analytics
- **Word management** with timestamp tracking
- **Progress tracking** with mastery levels
- **Practice session history**
- **Interactive dashboard** showing learning trends
- **Streak tracking** to encourage consistent practice

### 💡 Smart Features
- **Context-aware tutoring** - AI observes recently learned words
- **Adaptive difficulty** - Adjusts to student's progress
- **Real-time transcripts** - See what you said and AI responses
- **Session persistence** - Track progress over time

## Getting Started

### Prerequisites
- Node.js 18+ installed
- OpenAI API key with Realtime API access

### Installation

1. Navigate to the project directory:
```bash
cd voice-tutor
```

2. Install dependencies:
```bash
npm install
```

3. The `.env.local` file is already configured with your OpenAI API key

4. Start the development server:
```bash
npm run dev
```

5. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

### Starting a Practice Session
1. Select your **home language** in Settings (for instructions)
2. Choose a **practice mode** (Pronunciation, Vocabulary, or Conversation)
3. Click the **phone icon** to start a conversation
4. Speak naturally - the session continues until you stop it

### Managing Words
1. Go to the **Words** tab
2. Add individual words or use **Bulk Add** to simulate database integration
3. Words are automatically timestamped when added
4. The AI tutor will focus on recently added words

### Viewing Progress
- **Dashboard** tab shows practice statistics and trends
- Track mastery levels, practice counts, and session history
- Monitor your learning streak

## Technical Stack

- **Frontend**: Next.js 15, React 18, TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Voice API**: OpenAI Realtime API (gpt-4o-realtime-preview)
- **Audio**: WebRTC with PCM16 audio streaming
- **Charts**: Recharts for analytics visualization

## Architecture

The app uses a client-server architecture:
- **Client**: Captures audio via WebRTC and streams to OpenAI
- **Server API**: Handles session token generation for secure connection
- **Real-time WebSocket**: Maintains continuous bidirectional audio streaming

## API Routes

- `/api/realtime` - Generates ephemeral tokens for OpenAI Realtime API connection

## Browser Requirements

- Modern browser with WebRTC support (Chrome, Firefox, Safari, Edge)
- Microphone permissions required

## Development

To build for production:
```bash
npm run build
```

To run the production build:
```bash
npm start
```

## Future Enhancements

- Direct integration with FlashAcademy database
- Additional language support
- Offline practice mode
- Mobile app version
- Group practice sessions
- Teacher dashboard for monitoring student progress

## Support

For issues or questions about the Voice Tutor application, please contact the development team.

## License

Proprietary - FlashAcademy

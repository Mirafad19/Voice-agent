# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **AI Voice Agent** - a real-time conversational AI that can speak and listen via voice (not a typical text chatbot). It uses Google Gemini's native audio API for bidirectional voice streaming.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Run development server (tsx server.ts + Vite)
npm run build      # Build for production (Vite + esbuild server)
npm start          # Run production server (node server.js)
npm run lint       # TypeScript type checking
```

## Architecture

### Stack
- **Frontend**: React 19 + TypeScript + Vite
- **AI**: Google Gemini 2.5 Flash Native Audio (real-time voice)
- **Auth/DB**: Firebase (Google Auth + Firestore)
- **Backend**: Express + WebSockets
- **Storage**: Cloudinary (for recording uploads)

### Key Components

| File | Purpose |
|------|---------|
| `components/AgentWidget.tsx` | Main UI - voice/chat interface, handles state machine |
| `services/geminiLiveService.ts` | Core voice service - connects to Gemini Live API, handles audio streaming, interruption detection |
| `components/ConfigurationPanel.tsx` | Admin UI for configuring agent profiles |
| `App.tsx` | Main dashboard - profile management, auth |
| `types.ts` | TypeScript types for AgentProfile, Recording, etc. |

### Data Flow

1. User clicks microphone → `AgentWidget` starts voice mode
2. `GeminiLiveService.connect()` establishes WebSocket to Gemini
3. Microphone audio → PCM encoded → sent to Gemini in real-time
4. Gemini responds with audio → played through speakers
5. Interruption detection stops AI when user speaks

### Special Features

- **Voice Interruption**: Agent stops speaking when user talks (see `SPEECH_DETECTION_THRESHOLD` in geminiLiveService.ts)
- **Multiple Profiles**: Each agent has own voice, knowledge base, greeting
- **Embeddable**: Can be embedded on other sites via iframe
- **Session Recording**: Records conversations with sentiment analysis

## Configuration

- Create `.env.local` with `GEMINI_API_KEY` (or use AI Studio integration)
- Firebase config in `firebase.ts`
- Cloudinary config in profile settings for recording uploads

## Environment Variables

```
GEMINI_API_KEY=your_key_here
```
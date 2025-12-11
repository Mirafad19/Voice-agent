

import { AgentProfile, AgentVoice, AccentColor, WidgetTheme, VoiceProvider } from './types';

const defaultEmailConfig = {
  formspreeEndpoint: '',
};

const defaultFileUploadConfig = {
  cloudinaryCloudName: '',
  cloudinaryUploadPreset: '',
};

export const AZURE_VOICES = [
  { name: 'Nigerian - Ezinne (Female)', value: 'en-NG-EzinneNeural' },
  { name: 'Nigerian - Abeo (Male)', value: 'en-NG-AbeoNeural' },
  { name: 'Kenyan - Asilia (Female)', value: 'en-KE-AsiliaNeural' },
  { name: 'Kenyan - Chilemba (Male)', value: 'en-KE-ChilembaNeural' },
  { name: 'South African - Leah (Female)', value: 'en-ZA-LeahNeural' },
  { name: 'South African - Luke (Male)', value: 'en-ZA-LukeNeural' },
  { name: 'US - Ava (Female)', value: 'en-US-AvaNeural' },
  { name: 'US - Andrew (Male)', value: 'en-US-AndrewNeural' },
  { name: 'UK - Sonia (Female)', value: 'en-GB-SoniaNeural' },
  { name: 'UK - Ryan (Male)', value: 'en-GB-RyanNeural' },
];

export const DEFAULT_PROFILES: AgentProfile[] = [
  {
    id: 'soleluxe-assistant',
    name: 'SoleLuxe Assistant',
    // Voice Instructions (Phonetic focus)
    knowledgeBase: `You are a friendly and enthusiastic customer support agent for SoleLuxe, a premium sneaker brand. 
    - Keep your responses short and conversational.
    - If you say "SoleLuxe", pronounce it as "Soul Lux".`,
    
    // Chat Instructions (Formatting focus)
    chatKnowledgeBase: `You are a friendly customer support agent for SoleLuxe.
    - Use Markdown formatting (bold, italics, lists) to make your answers clear.
    - When listing products, use bullet points.
    - Be enthusiastic and helpful.`,
    
    theme: WidgetTheme.Light,
    voiceProvider: VoiceProvider.Gemini,
    voice: AgentVoice.Zephyr,
    accentColor: AccentColor.Orange,
    calloutMessage: 'Hey! Got a question about our sneakers? Click here to chat!',
    
    // Voice Greeting
    initialGreeting: 'Hello, thanks for calling Soul Lux support. How can I help you today?',
    // Chat Greeting
    initialGreetingText: 'Hello! 👋 Thanks for contacting SoleLuxe support. How can I help you today?',
    
    emailConfig: defaultEmailConfig,
    fileUploadConfig: defaultFileUploadConfig,
  },
];
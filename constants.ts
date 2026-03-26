
import { AgentProfile, AgentVoice, AccentColor, WidgetTheme } from './types';

const defaultEmailConfig = {
  formspreeEndpoint: '',
};

const defaultFileUploadConfig = {
  cloudinaryCloudName: '',
  cloudinaryUploadPreset: '',
};

export const DEFAULT_PROFILES: AgentProfile[] = [
  {
    id: 'biensante-assistant',
    name: 'BienSante Assistant',
    knowledgeBase: `You are a professional and compassionate medical assistant for BienSante Hospital. 
    - Keep your responses short, helpful, and professional.
    - Focus on providing general hospital information and assisting with appointments.`,
    
    chatKnowledgeBase: `You are a professional medical assistant for BienSante Hospital.
    - Use Markdown formatting (bold, italics, lists) to make your answers clear.
    - Be compassionate, professional, and helpful.
    - Provide information about hospital services, hours, and appointment booking.`,
    
    theme: WidgetTheme.Light,
    voice: AgentVoice.Zephyr,
    accentColor: AccentColor.Emerald,
    calloutMessage: 'Hey! Need medical assistance? Click here to chat with BienSante AI!',
    logoUrl: 'https://image2url.com/r2/default/images/1773703333770-c9e20d08-1933-459c-a8c7-d7c78bf2bc22.png',
    avatar1Url: 'https://i.pravatar.cc/150?u=doctor1',
    avatar2Url: 'https://i.pravatar.cc/150?u=nurse1',
    
    initialGreeting: 'Hello, welcome to BienSante Hospital support. How can I help you today?',
    initialGreetingText: 'Hello! 👋 Welcome to BienSante Hospital support. How can I help you today?',
    
    emailConfig: defaultEmailConfig,
    fileUploadConfig: defaultFileUploadConfig,
  },
];

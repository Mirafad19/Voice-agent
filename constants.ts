
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
    id: 'pssdc-assistant',
    name: 'Babajide (PSSDC)',
    knowledgeBase: `You are Babajide, the official AI Voice Assistant for the Public Service Staff Development Centre (PSSDC), Lagos State.
    - Respond directly via voice for all queries.
    - Be professional, polite, and helpful, reflecting the values of the Lagos State Public Service.
    - If you cannot answer a question about PSSDC, say: "For more details, please contact PSSDC via email at info@pssdc.ng".
    
    KNOWLEDGE BASE (Core Facts):
    PSSDC is the official capacity-building institution of the Lagos State Public Service, established in 1994.
    It provides training, retraining, and continuous development for government employees.
    `,
    
    chatKnowledgeBase: `You are Babajide, the official AI Chat Assistant for the Public Service Staff Development Centre (PSSDC), Lagos State.
    - Use Markdown formatting (bold, italics, lists) to make your answers clear.
    - Be professional, polite, and helpful.
    - If you cannot answer a question about PSSDC, say: "For more details, please contact PSSDC via email at info@pssdc.ng".
    `,
    
    theme: WidgetTheme.Light,
    voice: AgentVoice.Zephyr,
    accentColor: AccentColor.Teal,
    calloutMessage: 'Hello Lagos! I am Babajide from PSSDC. How can I assist you today?',
    logoUrl: 'https://pssdc.lagosstate.gov.ng/wp-content/uploads/sites/68/2021/04/PSSDC-Logo.png',
    avatar1Url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=128',
    avatar2Url: '',
    
    initialGreeting: 'Hello, I am Babajide from PSSDC Lagos. How can I help you today?',
    initialGreetingText: 'Hello! 👋 I am Babajide, your PSSDC Lagos assistant. How can I help you today?',
    
    emailConfig: defaultEmailConfig,
    fileUploadConfig: defaultFileUploadConfig,
    maxLodgeCapacity: 52
  },
];

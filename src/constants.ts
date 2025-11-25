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
    id: 'soleluxe-assistant',
    name: 'SoleLuxe Assistant',
    knowledgeBase: `You are a friendly and enthusiastic customer support agent for SoleLuxe, a premium sneaker brand. Your goal is to help customers with their orders, answer questions about products, and provide an excellent shopping experience.
    - Always maintain a positive and upbeat tone.
    - When asked about order status, ask for the order number.`,
    theme: WidgetTheme.Light,
    voice: AgentVoice.Zephyr,
    accentColor: AccentColor.Orange,
    calloutMessage: 'Hey! Got a question about our sneakers? Click here to chat!',
    initialGreeting: 'Hello, thanks for calling SoleLuxe support. How can I help you today?',
    emailConfig: defaultEmailConfig,
    fileUploadConfig: defaultFileUploadConfig,
  },
];

export enum WidgetTheme {
  Light = 'light',
  Dark = 'dark',
}

export enum AgentVoice {
  // Standard Live Voices
  Zephyr = 'Zephyr',
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  
  // Extended Star/Mythology Voices (TTS & Pro Preview)
  Aoede = 'Aoede',
  Callirrhoe = 'Callirrhoe',
  Autonoe = 'Autonoe',
  Enceladus = 'Enceladus',
  Iapetus = 'Iapetus',
  Sol = 'Sol',
  Algieba = 'Algieba',
  Despina = 'Despina',
  Erinome = 'Erinome',
  Algenib = 'Algenib',
  Rasalgethi = 'Rasalgethi',
  Laomedeia = 'Laomedeia',
  Achernar = 'Achernar',
  Alnilam = 'Alnilam',
  Schedar = 'Schedar',
  Gacrux = 'Gacrux',
  Pulcherrima = 'Pulcherrima',
  Achird = 'Achird',
  Zubenelgenubi = 'Zubenelgenubi',
  Vindemiatrix = 'Vindemiatrix',
  Sadachbia = 'Sadachbia',
  Sadaltager = 'Sadaltager',
  Sulafat = 'Sulafat',
}

export enum AccentColor {
  Red = 'red',
  Orange = 'orange',
  Gold = 'gold',
  Cyan = 'cyan',
  Pink = 'pink',
  Lime = 'lime',
  Violet = 'violet',
  Teal = 'teal',
  Emerald = 'emerald',
  Sky = 'sky',
  Rose = 'rose',
  Black = 'black',
}

export interface EmailConfig {
  formspreeEndpoint?: string;
}

export interface FileUploadConfig {
  cloudinaryCloudName: string;
  cloudinaryUploadPreset: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  
  // Voice Settings
  knowledgeBase: string; // Default/Voice Instructions
  initialGreeting?: string; // Voice Greeting
  
  // Chat Settings
  chatKnowledgeBase?: string; // Specific Chat Instructions
  initialGreetingText?: string; // Chat Welcome Message
  
  theme: WidgetTheme;
  voice: AgentVoice;
  accentColor: AccentColor;
  calloutMessage?: string;
  emailConfig?: EmailConfig;
  fileUploadConfig?: FileUploadConfig;
}

export type AgentConfig = Omit<AgentProfile, 'id'>;

export interface Recording {
  id:string;
  name: string;
  blob: Blob;
  url: string;
  mimeType: string;
  transcript?: string; // Added transcript field
  summary?: string;
  sentiment?: 'Positive' | 'Neutral' | 'Negative' | string;
  actionItems?: string[];
  isAnalyzing?: boolean;
}

export enum WidgetState {
  Idle = 'idle',
  Connecting = 'connecting',
  Listening = 'listening',
  Speaking = 'speaking',
  Error = 'error',
  Ended = 'ended',
}

export type ReportingStatus = 'idle' | 'analyzing' | 'sending' | 'sent' | 'failed';

export enum WidgetTheme {
  Light = 'light',
  Dark = 'dark',
}

export enum AgentVoice {
  Zephyr = 'Zephyr',
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
}

export enum AccentColor {
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
  serviceId: string;
  templateId: string;
  publicKey: string;
  recipientEmail: string;
}

export interface FileUploadConfig {
  cloudinaryCloudName: string;
  cloudinaryUploadPreset: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  knowledgeBase: string;
  theme: WidgetTheme;
  voice: AgentVoice;
  accentColor: AccentColor;
  calloutMessage?: string;
  initialGreeting?: string;
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
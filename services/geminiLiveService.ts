
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { AgentConfig } from '../types';

type LiveSession = Awaited<ReturnType<InstanceType<typeof GoogleGenAI>['live']['connect']>>;

type ServiceState = 'idle' | 'connecting' | 'connected' | 'error' | 'ended';

interface Callbacks {
  onStateChange: (state: ServiceState) => void;
  onTranscriptUpdate: (isFinal: boolean, text: string, type: 'input' | 'output') => void;
  onAudioChunk: (chunk: Uint8Array) => void;
  onInterruption: () => void;
  onLocalInterruption?: () => void; 
  onError: (error: string) => void;
}

function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private config: AgentConfig;
  private callbacks: Callbacks;
  
  private session: LiveSession | null = null;
  private sessionPromise: Promise<LiveSession> | null = null;
  
  private inputAudioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  
  private currentInputTranscription = '';
  private currentOutputTranscription = '';

  private speechDetectedFrameCount = 0;
  private readonly SPEECH_DETECTION_THRESHOLD = 0.025; 
  private readonly FRAMES_FOR_INTERRUPTION = 2;

  constructor(apiKey: string, config: AgentConfig, callbacks: Callbacks) {
    this.ai = new GoogleGenAI({ apiKey });
    this.config = config;
    this.callbacks = callbacks;
  }
  
  private setState(state: ServiceState) {
    this.callbacks.onStateChange(state);
  }

  public async connect(mediaStream: MediaStream): Promise<void> {
    this.setState('connecting');
    try {
      this.mediaStream = mediaStream;
      
      const greetingContext = this.config.initialGreeting 
        ? `INITIALIZATION: You have just spoken the following greeting: "${this.config.initialGreeting}". The user has heard this. DO NOT repeat it.` 
        : `INITIALIZATION: Wait for the user to speak first.`;

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
          },
          systemInstruction: `
          IDENTITY LOCKDOWN PROTOCOL:
          - You are the "${this.config.name}".
          - You are a proprietary AI built specifically for this organization.
          - If asked who made you or how you were made, respond: "I am a custom-built AI assistant designed to provide professional support for our company. I don't have information about my specific software developers or internal architecture."
          - NEVER mention "Google", "Gemini", "Large Language Model", or "LLM".
          - If the user asks "Are you Gemini?", respond: "No, I am the ${this.config.name}."
          - DO NOT speak about your underlying technology. You are a business tool.

          OPERATIONAL RULES:
          1. Speak ONLY in English.
          2. ${greetingContext}
          3. Be a patient listener. Wait for clear silence before replying.
          4. STOP SPEAKING IMMEDIATELY if the user starts talking.
          
          KNOWLEDGE BASE:
          ${this.config.knowledgeBase}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => this.handleSessionOpen(mediaStream),
          onmessage: (message: LiveServerMessage) => this.handleSessionMessage(message),
          onerror: (e: ErrorEvent) => this.handleError(`Connection error: ${e.message}`),
          onclose: () => this.handleSessionClose(),
        },
      });
      this.session = await this.sessionPromise;
    } catch (e) {
      this.handleError(e instanceof Error ? `Failed to connect: ${e.message}` : 'An unknown connection error occurred.');
    }
  }

  public sendText(text: string) {
      if (this.sessionPromise) {
          this.sessionPromise.then(session => {
              (session as any).send({
                  clientContent: {
                      turns: [{
                          role: 'user',
                          parts: [{ text }]
                      }],
                      turnComplete: true
                  }
              });
          });
      }
  }

  private async handleSessionOpen(mediaStream: MediaStream): Promise<void> {
    try {
      this.mediaStream = mediaStream;
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(mediaStream);
      this.analyser = this.inputAudioContext.createAnalyser();
      this.mediaStreamSource.connect(this.analyser);
      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const l = inputData.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          s = s < 0 ? s * 0x8000 : s * 0x7FFF;
          int16[i] = s;
        }
        if (this.sessionPromise) {
            this.sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
            });
        }
      };
      this.mediaStreamSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioContext.destination);
      this.setState('connected');
    } catch (err) {
      this.handleError("Failed to access microphone.");
    }
  }

  private handleSessionMessage(message: LiveServerMessage): void {
    if (message.serverContent?.interrupted) { this.callbacks.onInterruption(); }
    if (message.serverContent?.outputTranscription) {
      this.currentOutputTranscription += message.serverContent.outputTranscription.text;
      this.callbacks.onTranscriptUpdate(false, this.currentOutputTranscription, 'output');
    } else if (message.serverContent?.inputTranscription) {
      this.currentInputTranscription += message.serverContent.inputTranscription.text;
      this.callbacks.onTranscriptUpdate(false, this.currentInputTranscription, 'input');
    }
    if (message.serverContent?.turnComplete) {
      if (this.currentInputTranscription) this.callbacks.onTranscriptUpdate(true, this.currentInputTranscription, 'input');
      if (this.currentOutputTranscription) this.callbacks.onTranscriptUpdate(true, this.currentOutputTranscription, 'output');
      this.currentInputTranscription = '';
      this.currentOutputTranscription = '';
    }
    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (base64Audio) {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
      this.callbacks.onAudioChunk(bytes);
    }
  }

  private handleSessionClose() { this.setState('ended'); this.cleanup(); }
  private handleError(error: string) { this.setState('error'); this.callbacks.onError(error); this.cleanup(); }
  public disconnect() { this.session?.close(); this.cleanup(); }
  private cleanup() {
    this.scriptProcessor?.disconnect();
    this.mediaStreamSource?.disconnect();
    this.analyser?.disconnect();
    this.inputAudioContext?.close().catch(console.error);
    this.session = null;
    this.sessionPromise = null;
  }
}


import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { AgentConfig } from '../types';

// Inferred the LiveSession type from the connect method's return type to fix build error.
type LiveSession = Awaited<ReturnType<InstanceType<typeof GoogleGenAI>['live']['connect']>>;

type ServiceState = 'idle' | 'connecting' | 'connected' | 'error' | 'ended';

interface Callbacks {
  onStateChange: (state: ServiceState) => void;
  onTranscriptUpdate: (isFinal: boolean, text: string, type: 'input' | 'output') => void;
  onAudioChunk: (chunk: Uint8Array) => void;
  onInterruption: () => void;
  onError: (error: string) => void;
}

// Manual base64 encode/decode to avoid external libraries
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
  private mediaStream: MediaStream | null = null;
  
  private currentInputTranscription = '';
  private currentOutputTranscription = '';

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
      
      // Dynamic Greeting Instruction
      const greetingContext = this.config.initialGreeting 
        ? `INITIALIZATION: You have just spoken the following greeting to the user: "${this.config.initialGreeting}". The user has heard this. Do NOT repeat it. Your goal is to WAIT for the user to reply to this greeting.` 
        : `INITIALIZATION: Wait for the user to speak first.`;

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
          },
          systemInstruction: `
          CRITICAL OPERATIONAL RULES:
          1. LANGUAGE ENFORCEMENT: You must speak ONLY in English. If you hear what sounds like a foreign language or unclear noise, ignore it or ask for clarification in English. NEVER switch languages.
          2. ${greetingContext}
          3. SOURCE OF TRUTH: You have been provided with a YAML/Text Knowledge Base. When answering questions covered by this data, you must use the EXACT phrasing provided in the 'prompt' fields. Do not summarize or paraphrase unless specifically asked for a summary.
          4. SILENCE HANDLING: If you receive the specific text code "[[SILENCE_DETECTED]]", you must IMMEDIATELY speak up and ask: "Are you still there?" or "Hello?".
          
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
      if (!mediaStream) {
        throw new Error("MediaStream was not provided to GeminiLiveService.");
      }
      this.mediaStream = mediaStream;
      
      // Use 16kHz context to force browser to resample input to the model's native rate
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(mediaStream);
      
      // Buffer size 2048: Good balance for latency and audio quality without artifacts
      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const l = inputData.length;
        
        // Simple downsampling/conversion to 16kHz Int16 PCM
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          s = s < 0 ? s * 0x8000 : s * 0x7FFF;
          int16[i] = s;
        }

        const pcmBlob = {
            data: encode(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };

        if (this.sessionPromise) {
            this.sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
            });
        }
      };
      
      this.mediaStreamSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioContext.destination);
      
      this.setState('connected');
    } catch (err) {
      this.handleError(err instanceof Error ? `Microphone error: ${err.message}` : "Failed to access microphone.");
    }
  }

  private handleSessionMessage(message: LiveServerMessage): void {
    if (message.serverContent?.interrupted) {
      this.callbacks.onInterruption();
    }
    
    if (message.serverContent?.outputTranscription) {
      const text = message.serverContent.outputTranscription.text;
      this.currentOutputTranscription += text;
      this.callbacks.onTranscriptUpdate(false, this.currentOutputTranscription, 'output');
    } else if (message.serverContent?.inputTranscription) {
      const text = message.serverContent.inputTranscription.text;
      this.currentInputTranscription += text;
      this.callbacks.onTranscriptUpdate(false, this.currentInputTranscription, 'input');
    }

    if (message.serverContent?.turnComplete) {
      if (this.currentInputTranscription) {
        this.callbacks.onTranscriptUpdate(true, this.currentInputTranscription, 'input');
      }
      if (this.currentOutputTranscription) {
        this.callbacks.onTranscriptUpdate(true, this.currentOutputTranscription, 'output');
      }
      this.currentInputTranscription = '';
      this.currentOutputTranscription = '';
    }

    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (base64Audio) {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      this.callbacks.onAudioChunk(bytes);
    }
  }

  private handleSessionClose() {
    this.setState('ended');
    this.cleanup();
  }

  private handleError(error: string) {
    console.error('GeminiLiveService Error:', error);
    this.setState('error');
    this.callbacks.onError(error);
    this.cleanup();
  }
  
  public disconnect() {
    this.session?.close();
    this.cleanup();
  }

  private cleanup() {
    this.scriptProcessor?.disconnect();
    this.mediaStreamSource?.disconnect();
    this.inputAudioContext?.close().catch(console.error);

    this.scriptProcessor = null;
    this.mediaStreamSource = null;
    this.inputAudioContext = null;
    this.session = null;
    this.sessionPromise = null;
    this.mediaStream = null;
  }
}

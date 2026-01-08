
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
  onLatencyWarning: (isSlow: boolean) => void;
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

  // Active Latency Monitoring
  private lastUserTurnEndTime = 0;
  private isAwaitingFirstModelChunk = false;

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
        ? `INITIALIZATION: You have just spoken this greeting: "${this.config.initialGreeting}". Do NOT repeat it. WAIT for the user to reply.` 
        : `INITIALIZATION: Wait for the user to speak first.`;

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          // CRITICAL: Disable thinking budget to eliminate the "thinking delay"
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
          },
          systemInstruction: `
          CRITICAL OPERATIONAL RULES:
          1. LANGUAGE: Speak ONLY in English. 
          2. ${greetingContext}
          3. RESPONSIVENESS: Respond naturally and promptly. Be concise and conversational to minimize audio generation time.
          4. INTERRUPTION: If the user starts talking while you are speaking, STOP IMMEDIATELY.
          5. KNOWLEDGE: Use the provided knowledge base accurately.
          6. SILENCE: If you receive "[[SILENCE_DETECTED]]", ask "Are you still there?".
          
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
        throw new Error("MediaStream missing.");
      }
      this.mediaStream = mediaStream;
      
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(mediaStream);
      
      this.analyser = this.inputAudioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.mediaStreamSource.connect(this.analyser);

      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        let rms = 0;
        for (let i = 0; i < inputData.length; i++) rms += inputData[i] * inputData[i];
        rms = Math.sqrt(rms / inputData.length);

        if (rms > this.SPEECH_DETECTION_THRESHOLD) {
            this.speechDetectedFrameCount++;
            if (this.speechDetectedFrameCount >= this.FRAMES_FOR_INTERRUPTION) {
                this.callbacks.onLocalInterruption?.();
            }
        } else {
            this.speechDetectedFrameCount = 0;
        }

        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
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
      this.isAwaitingFirstModelChunk = false;
      this.callbacks.onLatencyWarning(false);
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
        // Start monitoring for response latency
        this.lastUserTurnEndTime = Date.now();
        this.isAwaitingFirstModelChunk = true;
      }
      if (this.currentOutputTranscription) {
        this.callbacks.onTranscriptUpdate(true, this.currentOutputTranscription, 'output');
      }
      this.currentInputTranscription = '';
      this.currentOutputTranscription = '';
    }

    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (base64Audio) {
      // If this is the first audio chunk since the user finished, check latency
      if (this.isAwaitingFirstModelChunk) {
          const latency = Date.now() - this.lastUserTurnEndTime;
          // Threshold set to 2.5 seconds - anything above this is likely network lag
          this.callbacks.onLatencyWarning(latency > 2500);
          this.isAwaitingFirstModelChunk = false;
      }

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
    this.analyser?.disconnect();
    this.inputAudioContext?.close().catch(console.error);

    this.scriptProcessor = null;
    this.mediaStreamSource = null;
    this.analyser = null;
    this.inputAudioContext = null;
    this.session = null;
    this.sessionPromise = null;
    this.mediaStream = null;
  }
}

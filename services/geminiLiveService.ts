
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
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
  onToolProcessing?: (isProcessing: boolean) => void;
}

function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export type Dialect = 'nigerian-english' | 'pidgin' | 'abroad-english';

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private config: AgentConfig;
  private callbacks: Callbacks;
  private dialect: Dialect;
  
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
  private readonly SPEECH_DETECTION_THRESHOLD = 0.01; 
  private readonly FRAMES_FOR_INTERRUPTION = 3; // ~75ms of sustained speech

  constructor(apiKey: string, config: AgentConfig, callbacks: Callbacks, dialect: Dialect = 'abroad-english') {
    this.ai = new GoogleGenAI({ 
      apiKey: apiKey || 'dummy'
    });
    this.config = config;
    this.callbacks = callbacks;
    this.dialect = dialect;
  }
  
  private setState(state: ServiceState) {
    this.callbacks.onStateChange(state);
  }

  public async connect(mediaStream: MediaStream): Promise<void> {
    this.setState('connecting');
    try {
      this.mediaStream = mediaStream;
      
      const greetingContext = this.config.initialGreeting 
        ? `INITIALIZATION: You have just spoken the following greeting to the user: "${this.config.initialGreeting}". The user has heard this. Do NOT repeat it. Your goal is to WAIT for the user to reply to this greeting.` 
        : `INITIALIZATION: Wait for the user to speak first.`;

      const tools: any[] = [];

      const dialectInstruction = this.dialect === 'pidgin'
        ? "LANGUAGE & STYLE: Speak strictly in hardcore Nigerian Pidgin. Be authentic and raw. Use deep Pidgin phrases like 'Wetin de sup?', 'Abeg', 'I de for you'. Avoid sounding formal. Your tone should be friendly and relatable."
        : this.dialect === 'nigerian-english'
        ? "LANGUAGE & STYLE: Use Nigerian Standard English. Be professional, warm, and polite. Do NOT use 'Sir' or 'Ma'. Ensure you sound professional but avoiding being overly repetitive with phrases like 'You're welcome'. Focus on being helpful and direct."
        : "LANGUAGE & STYLE: Use a standard international professional English tone.";

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: (this.dialect === 'pidgin' || this.dialect === 'nigerian-english') ? 'Kore' : this.config.voice 
              } 
            },
          },
          tools,
          systemInstruction: `
          CRITICAL OPERATIONAL RULES:
          1. ${dialectInstruction}
          2. ${greetingContext}
          3. RESPONSIVE PROTOCOL: You are an active, helpful listener. Respond naturally and promptly as soon as the user finishes their thought.
          4. AGGRESSIVE SILENCE: If the user starts talking while you are speaking, STOP IMMEDIATELY. Prioritize the user's voice above your own.
          5. SOURCE OF TRUTH: Use the provided knowledge base accurately for all information.
          6. SILENCE HANDLING: If you receive "[[SILENCE_DETECTED]]", ask "Are you still there?".
          7. INFORMATION RETRIEVAL: If asked for phone numbers or specific details, consult your knowledge base. Do not use external or hardcoded numbers.
          8. TOPIC FOCUS: Keep the conversation focused strictly on the topics provided in your knowledge base. If the user asks for things outside your scope (like lodge booking or hospital appointments, unless specified in the knowledge base), politely decline and redirect them.
          
          Today's date is ${new Date().toISOString().split('T')[0]}.
          
          KNOWLEDGE BASE:
          ${this.config.knowledgeBase}
          
          IDENTITY: You are ${this.config.name}. Act as a helpful and professional representative of this organization. Never ever mention that you are an AI, a large language model, or built by Google. If asked 'What are you?' or 'Who are you?', respond exclusively as the official assistant of ${this.config.name}. Your responses must strictly reflect this identity at all times.`,
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
      
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(mediaStream);
      
      this.analyser = this.inputAudioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.mediaStreamSource.connect(this.analyser);
 
      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);
      
      const frequencyData = new Float32Array(this.analyser.frequencyBinCount);
      const binSize = 16000 / 2048; 
      
      const lowBin = Math.floor(300 / binSize);
      const highBin = Math.floor(3000 / binSize);

      this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const l = inputData.length;
        
        this.analyser?.getFloatFrequencyData(frequencyData);
        
        let speechEnergy = 0;
        for (let i = lowBin; i <= highBin; i++) {
            const linear = Math.pow(10, frequencyData[i] / 20);
            speechEnergy += linear;
        }
        speechEnergy = speechEnergy / (highBin - lowBin + 1);

        if (speechEnergy > this.SPEECH_DETECTION_THRESHOLD) {
            this.speechDetectedFrameCount++;
            if (this.speechDetectedFrameCount === this.FRAMES_FOR_INTERRUPTION) {
                this.callbacks.onLocalInterruption?.();
            }
        } else {
            this.speechDetectedFrameCount = 0;
        }

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
                // Using raw send to ensure we use the 'audio' field instead of deprecated 'media_chunks'
                // Some SDK versions might still be using the deprecated field in sendRealtimeInput
                try {
                    (session as any).send({
                        realtimeInput: {
                            audio: pcmBlob
                        }
                    });
                } catch (e) {
                    // Fallback to sendRealtimeInput if raw send fails
                    session.sendRealtimeInput({ audio: pcmBlob });
                }
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

  private async handleSessionMessage(message: LiveServerMessage): Promise<void> {
    if (message.serverContent?.interrupted) {
      this.callbacks.onInterruption();
    }

    if (message.toolCall) {
        // Not implemented (booking functionality removed)
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

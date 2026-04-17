
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';
import { AgentConfig } from '../types';
import * as bookingService from './bookingService';

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
  private readonly SPEECH_DETECTION_THRESHOLD = 0.01; 
  private readonly FRAMES_FOR_INTERRUPTION = 3; // ~75ms of sustained speech

  constructor(apiKey: string, config: AgentConfig, callbacks: Callbacks) {
    this.ai = new GoogleGenAI({ 
      apiKey: apiKey || 'dummy'
    });
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
        ? `INITIALIZATION: You have just spoken the following greeting to the user: "${this.config.initialGreeting}". The user has heard this. Do NOT repeat it. Your goal is to WAIT for the user to reply to this greeting.` 
        : `INITIALIZATION: Wait for the user to speak first.`;

      const checkAvailabilityTool: FunctionDeclaration = {
        name: 'check_facility_availability',
        description: 'Check if a specific date is available for the facility (Guest Lodge or Hospital).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING, description: 'The date in YYYY-MM-DD format.' }
          },
          required: ['date']
        }
      };
 
      const bookFacilityTool: FunctionDeclaration = {
        name: 'book_facility',
        description: 'Record a booking or appointment request.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            userName: { type: Type.STRING, description: 'The full name of the user.' },
            userPhone: { type: Type.STRING, description: 'The 11-digit phone number of the user.' },
            bookingDate: { type: Type.STRING, description: 'The date in YYYY-MM-DD format.' },
            purpose: { type: Type.STRING, description: 'The purpose of the visit or appointment.' }
          },
          required: ['userName', 'userPhone', 'bookingDate', 'purpose']
        }
      };

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voice } },
          },
          tools: [{ functionDeclarations: [checkAvailabilityTool, bookFacilityTool] }],
          systemInstruction: `
          CRITICAL OPERATIONAL RULES:
          1. LANGUAGE ENFORCEMENT: You must speak ONLY in English. 
          2. ${greetingContext}
          3. RESPONSIVE PROTOCOL: You are an active, helpful listener. Respond naturally and promptly as soon as the user finishes their thought.
          4. AGGRESSIVE SILENCE: If the user starts talking while you are speaking, STOP IMMEDIATELY. Prioritize the user's voice above your own.
          5. SOURCE OF TRUTH: Use the provided knowledge base accurately.
          6. SILENCE HANDLING: If you receive "[[SILENCE_DETECTED]]", ask "Are you still there?".
          7. HOSPITAL CONTACT: If asked for phone numbers, say: "You can reach BienSanté Hospital on **0802 233 3285** or **0902 391 6337**. Would you like me to help you schedule an appointment now?"
          
          🗓️ APPOINTMENT BOOKING FLOW:
          YOU MUST ASK ONLY ONE QUESTION AT A TIME. Wait for the user to answer before moving to the next step.
          
          1. Ask for full name:
          “May I have your full name, please?”
          
          2. Ask for phone number:
          “Please provide your phone number. It should be exactly 11 digits.”
          If wrong length:
          “That number seems incomplete. Kindly provide the full 11-digit phone number.”
          
          3. Ask for preferred date:
          “What date would you prefer for your appointment?”
          
          4. Ask for purpose:
          "What is the reason or purpose for your booking?"
          
          5. Data Collection & Processing:
          When you have the Name, 11-digit Phone, Date, and Purpose, you must FIRST notify the user:
          "Thank you for that information. I'm now processing your request, please give me just a moment while I get everything settled for you..."
          Then immediately call 'book_facility'.
          
          6. Final Confirmation:
          Once the tool returns success, say EXACTLY: “Thank you. Our management team will review availability for that date and contact you shortly to confirm a suitable time and provide further instructions.”
          
          Today's date is ${new Date().toISOString().split('T')[0]}.
          
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
        const toolCalls = message.toolCall.functionCalls;
        console.log('Gemini Tool Calls:', toolCalls);
        if (toolCalls) {
            const responses = await Promise.all(toolCalls.map(async (call) => {
                let result;
                try {
                    if (call.name === 'check_facility_availability') {
                        const { date } = call.args as any;
                        const isAvailable = await bookingService.checkFacilityAvailability(this.config.name, date);
                        result = { isAvailable, message: isAvailable ? "This date is available." : "This date is already fully booked. Suggest another day." };
                    } else if (call.name === 'book_facility') {
                        const { userName, userPhone, bookingDate, purpose } = call.args as any;
                        const bookingId = await bookingService.createBooking({
                            userName,
                            userPhone,
                            bookingDate,
                            purpose,
                            facility: 'Hospital Appointment',
                            agentId: this.config.name
                        });
                        result = { success: true, bookingId, message: `Appointment request recorded for ${bookingDate}. Management will review and confirm.` };
                    }
                } catch (error) {
                    result = { success: false, error: error instanceof Error ? error.message : "Unknown error" };
                }
                return {
                    id: call.id,
                    response: { result }
                };
            }));

            if (this.sessionPromise) {
                this.sessionPromise.then(session => {
                    (session as any).sendToolResponse({ functionResponses: responses });
                });
            }
        }
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


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
            purpose: { type: Type.STRING, description: 'The purpose of the visit or appointment.' },
            facilityName: { type: Type.STRING, description: 'The name of the facility for the booking.' }
          },
          required: ['userName', 'userPhone', 'bookingDate', 'purpose', 'facilityName']
        }
      };

      const dialectInstruction = this.dialect === 'pidgin'
        ? "LANGUAGE & STYLE: Speak strictly in hardcore Nigerian Pidgin. Be authentic and raw. Use deep Pidgin phrases like 'Wetin de sup?', 'Abeg', 'I de for you', 'No be small thing', 'E don cast', 'Gbege', 'Gbas gbos', 'Wahala no dey', 'How far now?', 'Wetin you wan do?', 'Oya, talk your own'. Avoid sounding like a school teacher; sound like a relatable person on the street but keep it helpful."
        : this.dialect === 'nigerian-english'
        ? "LANGUAGE & STYLE: Use Nigerian Standard English. Be professional, warm, and polite. Do NOT use 'Sir' or 'Ma'. Use typical Nigerian professional phrasing like 'You're welcome', 'How may I assist you today?', 'Please hold on while I check that for you'."
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
          tools: [{ functionDeclarations: [checkAvailabilityTool, bookFacilityTool] }],
          systemInstruction: `
          CRITICAL OPERATIONAL RULES:
          1. ${dialectInstruction}
          2. ${greetingContext}
          3. RESPONSIVE PROTOCOL: You are an active, helpful listener. Respond naturally and promptly as soon as the user finishes their thought.
          4. AGGRESSIVE SILENCE: If the user starts talking while you are speaking, STOP IMMEDIATELY. Prioritize the user's voice above your own.
          5. SOURCE OF TRUTH: Use the provided knowledge base accurately for all facility names and contact information.
          6. SILENCE HANDLING: If you receive "[[SILENCE_DETECTED]]", ask "Are you still there?".
          7. INFORMATION RETRIEVAL: If asked for phone numbers or specific details, consult your knowledge base. Do not use external or hardcoded numbers.
          8. BOOKING TERMINATION: If you have just called 'book_facility' and received the tool result, YOUR ABSOLUTE AND FINAL TASK IS TO CONFIRM TO THE USER THAT THEIR DETAILS HAVE BEEN PASSED TO THE MANAGEMENT AND TO SAY GOODBYE IMMEDIATELY. TELL THEM TO LOOK OUT FOR A CALL FROM MANAGEMENT ON THEIR PHONE NUMBER. DO NOT ASK ANY MORE QUESTIONS. Do not pause. Speak your confirmation message now.
          
          🗓️ APPOINTMENT BOOKING FLOW:
          YOU MUST ASK ONLY ONE QUESTION AT A TIME. Wait for the user to answer before moving to the next step.
          
          1. Ask for full name:
          “May I have your full name, please?”
          
          2. Ask for phone number:
          “Please provide your phone number (11-digits). Management will call you on this number to confirm.”
          
          3. Ask for preferred date:
          “What day would you like to visit us?”
          
          4. Ask for purpose:
          "What is the reason or purpose for your booking?"
          
          5. Data Collection & Processing:
          When you have the Name, Phone, Date, and Purpose, you must FIRST notify the user:
          "Thank you. I am passing your details to our management team right now..."
          Then call 'book_facility'. Ensure the facilityName parameter correctly matches the organization relevant to the context.
          
          6. Final Confirmation & Safe Handoff:
          Once the tool returns success, IMMEDIATELY say: “Everything has been passed to our management. Please keep your phone reachable as they will CALL YOU directly on the number you provided to confirm your slot and finalize payment. Thank you for choosing PSSDC and have a wonderful day!”
          DO NOT ASK ANY MORE QUESTIONS. YOU MUST END THE CONVERSATION DEFINITIVELY.
          
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
            this.callbacks.onToolProcessing?.(true);
            const responses = [];
            
            // Sequential processing to prevent parallel race conditions (duplicates)
            for (const call of toolCalls) {
                let result;
                try {
                        if (call.name === 'check_facility_availability') {
                                    const { date } = call.args as any;
                                    const isAvailable = await bookingService.checkFacilityAvailability((this.config as any).id || this.config.name, date);
                                    result = { isAvailable, message: isAvailable ? "This date is available." : "This date is already fully booked. Suggest another day." };
                                } else if (call.name === 'book_facility') {
                                    const { userName, userPhone, bookingDate, purpose, facilityName } = call.args as any;
                                    const bookingId = await bookingService.createBooking({
                                        userName,
                                        userPhone,
                                        bookingDate,
                                        purpose,
                                        facility: facilityName || 'Hospital Appointment',
                                        agentId: (this.config as any).id || this.config.name
                                    });
                                    result = { success: true, bookingId, message: "OK. Appointment recorded successfully. Please confirm to user and say goodbye." };
                                }
                } catch (error) {
                    console.error(`Tool execution error [${call.name}]:`, error);
                    result = { success: false, error: error instanceof Error ? error.message : "Unknown error" };
                }
                responses.push({
                    id: call.id,
                    name: call.name, // Crucial: Gemini expects name in response
                    response: { result }
                });
            }

            if (this.sessionPromise) {
                this.sessionPromise.then(session => {
                    // Using raw tool_response structure for maximum reliability
                    (session as any).send({
                        tool_response: {
                           function_responses: responses
                        }
                    });
                    
                    // Delay setting state to false to ensure UI transition feels natural with the model's new turn
                    setTimeout(() => {
                        this.callbacks.onToolProcessing?.(false);
                    }, 500);
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

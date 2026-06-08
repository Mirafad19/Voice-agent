
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
  onNavigate?: (url: string, pageName: string) => void;
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
  
  // ── CRITICAL FIX: Gates all audio sending until the session is truly ready.
  // Without this flag, onaudioprocess queues hundreds of .then() callbacks
  // during the WebSocket handshake. When the promise finally resolves they all
  // fire at once, flooding the server and causing the "forever connecting" bug.
  private audioStreamingEnabled = false;

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
  private readonly SPEECH_DETECTION_THRESHOLD = 0.008; 
  private readonly FRAMES_FOR_INTERRUPTION = 2; // ~50ms of sustained speech
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private connectTimeoutId: any = null;

  constructor(apiKey: string, config: AgentConfig, callbacks: Callbacks, dialect: Dialect = 'abroad-english') {
    this.ai = new GoogleGenAI({ 
      apiKey: apiKey || 'dummy',
      httpOptions: {
        baseUrl: window.location.origin
      }
    });
    this.config = config;
    this.callbacks = callbacks;
    this.dialect = dialect;
  }
  
  private setState(state: ServiceState) {
    this.callbacks.onStateChange(state);
  }

  public async connect(mediaStream: MediaStream): Promise<void> {
    this.mediaStream = mediaStream;
    await this.internalConnect();
  }

  private async internalConnect(): Promise<void> {
    this.setState('connecting');
    try {
      if (!this.mediaStream) throw new Error("No media stream");
      
      const greetingContext = `INITIALIZATION: When you receive the system trigger "[START_CONVERSATION]", \
immediately begin speaking your initial opening greeting naturally, as if starting a professional phone call. \
Your greeting should reflect your identity, role, and any specific greeting or introduction instructions defined in your KNOWLEDGE BASE. \
Keep the greeting extremely brief, clear, and direct. \
Speak in your designated language dialect: ${this.dialect}. \
After delivering the greeting, stop speaking immediately and wait for the user to respond. Do NOT say anything else until they speak.`;

      const isPssdc = this.config.name?.toLowerCase().includes('oluwole') || 
                      this.config.name?.toLowerCase().includes('pssdc') ||
                      this.config.knowledgeBase?.toLowerCase().includes('pssdc');

      const tools: any[] = [
        {
          functionDeclarations: [
            {
              name: "navigateToUrl",
              description: "Automatically navigates or redirects the user's web browser to an official page, section, or announcement of the website. Call this whenever the user expresses clear interest in seeing, visiting, opening, or reading a page, post, or section.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  url: {
                    type: Type.STRING,
                    description: "The exact official URL from the provided list to redirect the user to."
                  },
                  pageName: {
                    type: Type.STRING,
                    description: "The human-readable name of the webpage or article (e.g. 'LMS Portal', 'Contact Us Page', 'Lagos State News')."
                  }
                },
                required: ["url", "pageName"]
              }
            }
          ]
        }
      ];

      const navInstruction = isPssdc ? `
          NAVIGATION CAPABILITIES (CRITICAL RULE):
          You have custom powers to automatically navigate the user's browser to any section, page, or article on the official PSSDC website when they ask for it.
          Whenever a user specifies a target category, news topic, page, or says something like "take me to training materials", "show me the LMS", "open the contact page", "go to events", or "read the school retirement ceremony article", you MUST call the "navigateToUrl" tool immediately with the exact official URL from the list below.

          Before calling the tool, say a brief polite confirmation (e.g., "Sure, let me take you to the learning management system portal right away" or "Alright, opening the sports news page now").

          Use the following exact URLs based on their request:
          - Homepage: https://pssdc.ng
          - Events: https://pssdc.ng/category/pssdc-news/events
          - General News: https://pssdc.ng/category/general-news
          - Health & Lifestyle: https://pssdc.ng/category/health-lifestyle
          - Lagos State News: https://pssdc.ng/category/lagos-state
          - Learning & Development News: https://pssdc.ng/category/pssdc-news/learning-development
          - Politics News: https://pssdc.ng/category/politics
          - Sports News: https://pssdc.ng/category/sports
          - Tech News: https://pssdc.ng/category/tech
          - Leadership/DG Profile/Board: https://pssdc.ng/leadership
          - LMS Portal/E-Learning Access: https://pssdc.ng/lms
          - Training Materials/Slides/Downloads: https://pssdc.ng/training-materials
          - Management Consultancy Services: https://pssdc.ng/management-consultancy
          - Frequently Asked Questions (FAQ): https://pssdc.ng/faq
          - Facility Hire/Lodge/Accommodation: https://pssdc.ng/facility-hire
          - Contact Us page: https://pssdc.ng/contact
          - Services List: https://pssdc.ng/services
          - Learning & Development Courses: https://pssdc.ng/learning-and-development
          - Research & Publications: https://pssdc.ng/research-and-publications
          - LMS Courses list: https://pssdc.ng/courses-lms
          - About Us/History/Vision: https://pssdc.ng/about
          - Latest News Index: https://pssdc.ng/latest-news

          For specific news announcements & blog posts:
          - PSSDC collaboration for enhanced service delivery: https://pssdc.ng/pssdc-seeks-collaboration-for-enhanced-service-delivery
          - Financial accountability as fundamental pillars of good governance: https://pssdc.ng/financial-accountability-and-transparency-are-fundamental-pillars-of-good-governance-dg-pssdc
          - Emotional intelligence training: https://pssdc.ng/pssdc-trains-public-servants-on-emotional-intelligence
          - Continuous assessment in learning approach: https://pssdc.ng/continuous-assessment-a-dynamic-approach-to-learning-dg
          - Working to get results training: https://pssdc.ng/pssdc-trains-public-servants-on-working-to-get-results
          - Retirement ceremony dedicated service celebration: https://pssdc.ng/pssdc-celebrates-dedicated-service-at-retirement-ceremony
          - Eco-Learn Nigeria project launch: https://pssdc.ng/pssdc-launches-eco-learn-nigeria-project-in-collaboration-with-key-stakeholders
          - LGA Certificate Course graduation of 135 participants: https://pssdc.ng/pssdc-graduates-135-participants-in-local-government-administration-certificate-course
          - LGA Entrance Exam info: https://pssdc.ng/pssdc-conducts-entrance-examination-for-y2024-certificate-course-in-local-government-administration
          - Duke and Duchess of Sussex reception in Lagos: https://pssdc.ng/gov-sanwo-olu-and-first-lady-dr-ibijoke-receive-duke-and-duchess-of-sussex
          - Do not invest in fraudulent businesses: https://pssdc.ng/do-not-invest-in-fraudulent-businesses-hos
          - Gov Sanwo-Olu pledges training investment: https://pssdc.ng/sanwo-olu-pledges-to-invest-in-workers-training
          - Finidi George appointed Super Eagles coach: https://pssdc.ng/finidi-george-appointed-as-new-coach-of-the-super-eagles
          - Ramadan Lecture (5th Annual): https://pssdc.ng/pssdc-muslim-community-holds-5th-annual-ramadan-lecture
          - Train the trainers Kemrose collaboration: https://pssdc.ng/pssdc-collaborates-with-kemrose-to-train-trainers
          - Evidence-based public policy: https://pssdc.ng/ensure-evidence-based-public-policy-dg-pssdc
          - Training of 3000 public servants on digital literacy: https://pssdc.ng/lasg-trains-3000-public-servants-on-digital-literacy
          - Landmark year of 2024 review: https://pssdc.ng/2024-a-landmark-year-for-pssdc-dg-adio-moses
          - Christmas Carol theme: https://pssdc.ng/pssdc-hosts-joyous-2023-christmas-carol-with-the-theme-appreciating-the-king
          - LNSA wins HOS cup: https://pssdc.ng/lnsa-wins-2nd-hos-cup-in-3-years
          - Sports Commission collaboration with PSSDC: https://pssdc.ng/pssdc-welcomes-lagos-state-sports-commission-for-collaborative-sports-initiative
          - Vibranium Valley visit: https://pssdc.ng/pssdc-visits-vibranium-valley
          - Induction of Director-General into IARSA: https://pssdc.ng/dg-pssdc-inducted-as-a-fellow-of-iarsa
          - Training of 5000 youth on tech up-skills with Learntor: https://pssdc.ng/pssdc-learntor-to-train-5000-youths-on-tech-up-skills
          - Agile training for LASG executive officials: https://pssdc.ng/pssdc-learntor-hold-agile-training-for-lasg-executive-officials
          - Agile Leadership in digital governance: https://pssdc.ng/navigating-the-future-agile-leadership-in-digital-governance
          - Mrs. Obiwumi Temitope wins SpeakHers 2023 Speakathon: https://pssdc.ng/pssdc-faculty-member-mrs-obiwumi-temitope-emerges-as-a-winner-in-speakhers-2023-speakathon-speech-competition
          - Conflict in the workplace tactics: https://pssdc.ng/conflict-in-the-workplace-top-tactics-every-young-adult-should-know
          - Happy Teachers Day: https://pssdc.ng/happy-teachers-day
          - Teachers urged to hope for better future: https://pssdc.ng/lasg-urges-teachers-to-hope-for-better-future
          - Extra virgin olive oil disease protection: https://pssdc.ng/how-extra-virgin-olive-oil-protects-against-disease-risk-factors
          - Independence Day statement: https://pssdc.ng/independence-day-nigeria-will-be-great-again-akpabio-abbas-makinde-sanwo-olu-tell-nigerians
          - Judicial officers welfare: https://pssdc.ng/we-are-committed-to-judicial-officers-welfare-sanwo-olu
          - Apple type-C connector news: https://pssdc.ng/apple-bows-to-eu-unveils-iphone-with-usb-c-charger
          - Government ID verification on X: https://pssdc.ng/x-introduces-government-id-based-verification-for-paid-users
          - Leandro Trossard strike news: https://pssdc.ng/leandro-trossard-strike-gives-gunners-points-after-gabriel-martinellis-disallowed-goal
          - Collaboration as faculty of success: https://pssdc.ng/collaboration-a-faculty-of-success
          - Noise and education perspective: https://pssdc.ng/noise-and-education-a-perspective
          - Public Service Staff induction course details: https://pssdc.ng/lagos-state-government-the-public-service-staff-induction-course
          - CPS social media team visibility: https://pssdc.ng/lagos-state-governors-cps-trained-the-pssdc-social-media-team-on-managing-social-media-for-better-visibility-in-the-21st-century
          - Courtesy visit to Netherlands consulate: https://pssdc.ng/dg-pssdc-paid-a-courtesy-visit-to-netherlands-consulate-in-lagos
          - CSR Impact story (TechUp Boys): https://pssdc.ng/pssdc-csr-impact-story-techup-boys-initiative-transforming-young-lives-in-education-district-i
      ` : '';

      const dialectInstruction = this.dialect === 'pidgin'
        ? "LANGUAGE & STYLE: Speak strictly in hardcore Nigerian Pidgin. Be authentic and raw. Use deep Pidgin phrases like 'Wetin de sup?', 'Abeg', 'I de for you'. Avoid sounding formal. Your tone should be friendly and relatable."
        : this.dialect === 'nigerian-english'
        ? "LANGUAGE & STYLE: Use Nigerian Standard English. Be professional, warm, and polite. Do NOT use 'Sir' or 'Ma'. Ensure you sound professional but avoiding being overly repetitive with phrases like 'You're welcome'. Focus on being helpful and direct."
        : "LANGUAGE & STYLE: Use a standard international professional English tone.";

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.0-flash-live-001',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: 'Charon'
              } 
            },
          },
          tools,
          systemInstruction: `
          CRITICAL OPERATIONAL RULES:
          1. ${dialectInstruction}
          2. ${greetingContext}
          3. RESPONSIVE PROTOCOL: You are an active, helpful listener. Respond naturally and promptly as soon as the user finishes their thought.
          4. AGGRESSIVE SILENCE: If you hear even a single sound from the user while you are speaking, YOU MUST SHUT UP IMMEDIATELY. Do not finish your sentence. Prioritize the user's voice above your own.
          5. SOURCE OF TRUTH: Use the provided knowledge base accurately for all information.
          6. DATA GATHERING FLOW: If you need to collect multiple pieces of information (e.g., for a booking or registration), ASK ONLY ONE QUESTION AT A TIME. Wait for the user's response before asking the next question. Do not dump multiple questions in one turn.
          7. THOROUGHNESS: Be detailed and comprehensive. If the information is in your knowledge base, provide the FULL answer. Do not give short or lazy responses. 
          8. SILENCE HANDLING: If you receive "[[SILENCE_DETECTED]]", ask "Are you still there?".
          9. INFORMATION RETRIEVAL: If asked for phone numbers or specific details, consult your knowledge base. Do not use external or hardcoded numbers.
          10. TOPIC FOCUS: Keep the conversation focused strictly on the topics provided in your knowledge base. If the user asks for things outside your scope (like lodge booking or hospital appointments, unless specified in the knowledge base), politely decline and redirect them.
          
          Today's date is ${new Date().toISOString().split('T')[0]}.
          
          KNOWLEDGE BASE:
          ${this.config.knowledgeBase}
          
          IDENTITY: You are ${this.config.name}. If your name is "Oluwole", act as the official virtual assistant for the Public Service Staff Development Centre (PSSDC), Lagos. 
          
          CRITICAL BEHAVIOR:
          - Never mention being an AI or LLM.
          - If the information exists in your knowledge base, you MUST provide the complete, detailed answer. Do not summarize or shorten information unless specifically asked to be brief. 
          - Be conversational but professional. If you are asked about the "guest lodge" or "training programmes", give a full overview based on the knowledge base.
          - For data gathering (like bookings), ask exactly one question at a time and wait for the user to finish.
          
          ${navInstruction}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
              this.reconnectAttempts = 0;
              this.handleSessionOpen(this.mediaStream!);
          },
          onmessage: (message: LiveServerMessage) => this.handleSessionMessage(message),
          onerror: (e: ErrorEvent) => this.handleNetworkError(e),
          onclose: () => this.handleSessionClose(),
        },
      });
      this.session = await this.sessionPromise;
    } catch (e) {
        this.handleNetworkError(e);
    }
  }

  private handleNetworkError(e: any) {
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        console.warn(`Attempting reconnection ${this.reconnectAttempts}...`);
        setTimeout(() => this.internalConnect(), 2000);
    } else {
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

        // ── GATE: Only stream audio to Gemini after audioStreamingEnabled ──
        //
        // CRITICAL: Without this gate, every onaudioprocess call (every ~128ms)
        // queues a sessionPromise.then() callback while the WebSocket is still
        // handshaking. When the promise resolves, ALL those callbacks fire at
        // once, flooding the Gemini server with hundreds of stale audio chunks.
        // The server rejects or drops the connection, causing "forever connecting".
        if (!this.audioStreamingEnabled || !this.sessionPromise) return;

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

        if (this.session) {
            // Using raw send to ensure we use the 'audio' field instead of deprecated 'media_chunks'
            try {
                (this.session as any).send({
                    realtimeInput: {
                        audio: pcmBlob
                    }
                });
            } catch (e) {
                // Fallback to sendRealtimeInput if raw send fails
                try {
                    this.session.sendRealtimeInput({ audio: pcmBlob });
                } catch (err) {
                    // Fail-safe fallback to sessionPromise if needed
                    this.sessionPromise?.then((session) => {
                        session.sendRealtimeInput({ audio: pcmBlob });
                    });
                }
            }
        } else if (this.sessionPromise) {
            this.sessionPromise.then((session) => {
                try {
                    (session as any).send({
                        realtimeInput: {
                            audio: pcmBlob
                        }
                    });
                } catch (e) {
                    session.sendRealtimeInput({ audio: pcmBlob });
                }
            });
        }
      };
      
      // Connect the audio pipeline RIGHT NOW so mic audio flows to Gemini
      // immediately. This prevents any cold start/idle delays.
      if (this.mediaStreamSource && this.scriptProcessor && this.inputAudioContext) {
        try {
          this.mediaStreamSource.connect(this.scriptProcessor);
          this.scriptProcessor.connect(this.inputAudioContext.destination);
        } catch (e) {
          console.error("Failed to connect audio process:", e);
        }
      }

      // 500ms stabilisation buffer — just enough time for the WebSocket
      // handshake to fully settle before we start driving the conversation.
      this.connectTimeoutId = setTimeout(() => {
        if (!this.mediaStreamSource || !this.scriptProcessor || !this.inputAudioContext) return;

        // Enable audio streaming NOW so cleanly synchronized frames flow to Gemini
        this.audioStreamingEnabled = true;

        // Mark the connection as ready. AgentWidget will show "Listening..."
        // but this is only momentary — greeting audio arrives within ~1s.
        this.setState('connected');

        // Immediately fire the greeting trigger to start the conversation automatically
        this.sessionPromise?.then(session => {
          try {
            (session as any).send({
              clientContent: {
                turns: [{ role: 'user', parts: [{ text: '[START_CONVERSATION]' }] }],
                turnComplete: true
              }
            });
          } catch (triggerError) {
            console.error("Failed to send greeting trigger:", triggerError);
            // Non-fatal: fallback to calling sendText directly
            this.sendText('[START_CONVERSATION]');
          }
        });
      }, 500); // ← 500ms vs the original 8000ms
    } catch (err) {
      this.handleError(err instanceof Error ? `Microphone error: ${err.message}` : "Failed to access microphone.");
    }
  }

  private async handleSessionMessage(message: LiveServerMessage): Promise<void> {
    if (message.serverContent?.interrupted) {
      this.callbacks.onInterruption();
    }

    if (message.toolCall) {
      const functionCalls = (message.toolCall as any).functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === 'navigateToUrl') {
          const url = call.args.url;
          const pageName = call.args.pageName;
          
          if (url && typeof url === 'string') {
            this.callbacks.onNavigate?.(url, pageName || 'Page');
          }
          
          // Send response back immediately to keep Gemini session in a healthy state
          if (this.sessionPromise) {
            this.sessionPromise.then(session => {
              try {
                (session as any).send({
                  toolResponse: {
                    functionResponses: [
                      {
                        response: { output: { success: true, message: `Redirecting to ${pageName}` } },
                        id: call.id
                      }
                    ]
                  }
                });
              } catch (err) {
                console.error("Error sending tool response:", err);
              }
            });
          }
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
    this.audioStreamingEnabled = false; // ← reset gate on every cleanup
    if (this.connectTimeoutId) {
        clearTimeout(this.connectTimeoutId);
        this.connectTimeoutId = null;
    }
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


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentProfile, AgentConfig, WidgetTheme, WidgetState, Recording, ReportingStatus, Booking } from '../types';
import { GeminiLiveService } from '../services/geminiLiveService';
import { RecordingService } from '../services/recordingService';
import { Spinner } from './ui/Spinner';
import { GoogleGenAI, Type, Modality, Chat, FunctionDeclaration } from '@google/genai';
import { blobToBase64 } from '../utils';
import { decodePcmChunk } from '../utils/audio';
import * as bookingService from '../services/bookingService';

interface AgentWidgetProps {
  agentProfile: AgentProfile | AgentConfig;
  apiKey: string;
  isWidgetMode: boolean;
  onSessionEnd?: (recording: Recording) => void;
}

interface Message {
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
}

type Dialect = 'nigerian-english' | 'pidgin' | 'abroad-english';
type ViewState = 'home' | 'voice' | 'chat' | 'status' | 'dialect';

async function getCloudinaryShareableLink(cloudName: string, uploadPreset: string, recording: Omit<Recording, 'id' | 'url'>): Promise<string> {
    if (!recording.blob || recording.blob.size === 0) return 'N/A (Text Chat)';
    
    const formData = new FormData();
    formData.append('file', recording.blob);
    formData.append('upload_preset', uploadPreset);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Cloudinary upload failed: ${errorData.error.message}`);
    }

    const result = await response.json();
    return result.secure_url;
}

const WaveformIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
        <rect x="8" y="6" width="2" height="12" rx="1" fillOpacity="0.8" />
        <rect x="12" y="3" width="2" height="18" rx="1" />
        <rect x="16" y="6" width="2" height="12" rx="1" fillOpacity="0.8" />
        <rect x="20" y="10" width="2" height="4" rx="1" fillOpacity="0.5" />
    </svg>
);

const FabIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 13.5V12a8 8 0 1116 0v1.5" />
        <path d="M4 12a2 2 0 00-2 2v3a2 2 0 002 2h1" />
        <path d="M20 12a2 2 0 012 2v3a2 2 0 01-2 2h-1" />
        <path d="M9 12h.01" />
        <path d="M15 12h.01" />
        <path d="M9.5 16a3.5 3.5 0 005 0" />
        <path d="M5 14v1a2 2 0 002 2h2" />
    </svg>
);

const MicrophoneIcon = ({state}: {state: WidgetState}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-8 w-8 transition-colors duration-300 ${state === WidgetState.Idle ? 'text-white' : 'text-white'}`} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <path d="M8 21l8 0" />
        <path d="M12 17l0 4" />
    </svg>
);

const SendIcon = ({className = "h-5 w-5"}) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
  </svg>
);

const ChevronLeftIcon = ({className = "h-6 w-6 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
    </svg>
);

const ChevronDownIcon = ({className = "h-6 w-6 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
    </svg>
);

const XIcon = ({className = "h-6 w-6"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const LiveBadge = () => (
    <div className="flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full border border-white/30 shadow-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
        </span>
        <span className="text-[10px] font-black text-white uppercase tracking-widest">Live</span>
    </div>
);

const NetworkWarning = () => (
  <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none p-4">
    <div className="bg-amber-600 text-white text-[12px] font-black uppercase tracking-tight px-3 py-2 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] flex flex-col items-center gap-1 border-2 border-amber-400 backdrop-blur-md animate-pulse text-center leading-none">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span className="whitespace-nowrap">Network Not Stable</span>
    </div>
  </div>
);

const OfflineBanner = () => (
    <div className="bg-red-600 text-white text-[11px] font-black uppercase tracking-[0.2em] py-2 px-4 text-center animate-fade-in flex items-center justify-center gap-3 z-[100] w-full shadow-lg border-b border-red-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.828-2.828m-4.243 4.243a5 5 0 010-7.072m0 0L5.636 5.636M4.243 18.364a9 9 0 010-12.728" />
        </svg>
        Reconnecting... Check Internet
    </div>
);

const ACCENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#fb923c',
  gold: '#facc15',
  cyan: '#22d3ee',
  pink: '#f472b6',
  lime: '#a3e635',
  violet: '#a78bfa',
  black: '#1f2937',
  teal: '#2dd4bf',
  emerald: '#34d399',
  sky: '#38bdf8',
  rose: '#fb7185',
};

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ViewState>('home');
  const [showCallout, setShowCallout] = useState(false);
  const [permissionRequested, setPermissionRequested] = useState(false);
  
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };
  const [voiceReportingStatus, setVoiceReportingStatus] = useState<ReportingStatus>('idle');
  const fullTranscriptRef = useRef('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isNetworkSlow, setIsNetworkSlow] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatTyping, setIsChatTyping] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [selectedDialect, setSelectedDialect] = useState<Dialect | null>(null);
  const [chatDialectRequestPending, setChatDialectRequestPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isToolProcessing, setIsToolProcessing] = useState(false);
  const [statusPhone, setStatusPhone] = useState('');
  const [checkedBookings, setCheckedBookings] = useState<Booking[]>([]);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const recordingServiceRef = useRef<RecordingService | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const shouldEndAfterSpeakingRef = useRef(false);
  const chatSessionRef = useRef<Chat | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  
  const isGreetingProtectedRef = useRef(false);
  const lastInterruptionTimeRef = useRef<number>(0);

  const accentColorClass = agentProfile.accentColor;

  // Monitor network quality
  useEffect(() => {
    if (isWidgetMode) {
      document.documentElement.style.backgroundColor = 'transparent';
      document.body.style.backgroundColor = 'transparent';
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = 'transparent';
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const conn = (navigator as any).connection;
    const checkNetwork = () => {
      if (conn) {
        // High RTT (>600ms) or slow connection types (2g/3g) trigger the warning
        const isSlow = conn.effectiveType === '2g' || 
                       conn.effectiveType === '3g' || 
                       (conn.rtt && conn.rtt > 600) || 
                       (conn.downlink && conn.downlink < 1.0);
        setIsNetworkSlow(isSlow);
      } else {
        // Fallback for Safari/iOS: Measure actual latency of a small fetch
        const start = Date.now();
        fetch('/favicon.ico', { mode: 'no-cors', cache: 'no-store' })
          .then(() => {
            const rtt = Date.now() - start;
            setIsNetworkSlow(rtt > 800);
          })
          .catch(() => {
            // If fetch fails, we might be offline or extremely slow
            if (navigator.onLine) setIsNetworkSlow(true);
          });
      }
    };

    const interval = setInterval(checkNetwork, 10000); // Check every 10s
    checkNetwork();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (conn) conn.removeEventListener('change', checkNetwork);
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, isChatTyping]);

  const analyzeAndSendReport = useCallback(async (recording: Omit<Recording, 'id' | 'url'>) => {
    const { emailConfig, fileUploadConfig } = agentProfile as AgentConfig;

    if (!apiKey || apiKey === 'dummy') {
        console.warn("Skipping report analysis: API Key missing.");
        return;
    }

    const hasUserInteracted = recording.transcript && recording.transcript.includes('User:');

    if (!hasUserInteracted) {
        if (view === 'voice') setVoiceReportingStatus('idle');
        return; 
    }

    if (!emailConfig?.formspreeEndpoint) {
        return;
    }

    if (view === 'voice') setVoiceReportingStatus('analyzing');

    try {
        let audioLink = 'N/A';
        if (recording.blob && recording.blob.size > 0 && fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset) {
            try {
                audioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
            } catch (uploadError) {
                console.error("Audio upload failed:", uploadError);
                audioLink = 'Upload Failed';
            }
        } else if (!recording.blob) {
            audioLink = 'Text Chat Session';
        }

        const ai = new GoogleGenAI({ 
            apiKey: apiKey || 'dummy'
        });
        
        let contents;
        if (recording.transcript) {
            contents = { parts: [
                { text: `Analyze this session transcript. Provide a concise summary, sentiment ('Positive', 'Neutral', 'Negative'), and action items. Return JSON.` },
                { text: `TRANSCRIPT:\n${recording.transcript}` }
            ] };
        } else if (recording.blob) {
            const audioBase64 = await blobToBase64(recording.blob);
            contents = { parts: [
                { text: `Analyze this call audio. Provide a concise summary, sentiment ('Positive', 'Neutral', 'Negative'), and action items. Return JSON.` },
                { inlineData: { mimeType: recording.mimeType, data: audioBase64 } },
            ] };
        } else {
             contents = { parts: [{ text: "This was a short session with no content. Return neutral sentiment." }] };
        }

        let analysis = { summary: 'Analysis unavailable', sentiment: 'Neutral', actionItems: [] };
        
        try {
            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: contents,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT, properties: {
                            summary: { type: Type.STRING },
                            sentiment: { type: Type.STRING },
                            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }, required: ["summary", "sentiment", "actionItems"]
                    }
                },
            });
            if (response.text) {
                analysis = JSON.parse(response.text);
            }
        } catch (geminiError) {
             console.error("Analysis failed, sending raw report:", geminiError);
        }

        const reportData = {
          _subject: `Session Insight Report: ${recording.name}`,
          agent: agentProfile.name,
          sentiment: analysis.sentiment || 'N/A',
          summary: analysis.summary || 'No summary available.',
          actionItems: (analysis.actionItems && analysis.actionItems.length > 0) ? analysis.actionItems.map((item:string) => `- ${item}`).join('\n') : 'None',
          transcript: recording.transcript || 'No transcript available',
          audioLink: audioLink,
        };

        if (view === 'voice') setVoiceReportingStatus('sending');

        await fetch(emailConfig.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(reportData)
        });

        if (view === 'voice') setVoiceReportingStatus('sent');
        
    } catch (error) {
        console.error("Failed to process report:", error);
        if (view === 'voice') setVoiceReportingStatus('failed');
    }
  }, [agentProfile, apiKey, view]);


  const handleSelectDialectInChat = async (dialect: Dialect) => {
    setSelectedDialect(dialect);
    setChatDialectRequestPending(false);
    
    // If there's already a message, we need to initialize the session and respond to it
    if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'user') {
            // We need to initialize chat session first
            const config = agentProfile as AgentConfig;
            const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || 'dummy';
            const ai = new GoogleGenAI({ 
                apiKey: effectiveApiKey
            });
            
            // Re-using logic from initChat but we need it here immediately
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

            const dialectInstruction = dialect === 'pidgin' 
                ? "LANGUAGE & STYLE: Speak strictly in hardcore Nigerian Pidgin. Be authentic and raw. PROUNCIATION HINTS: Use raw Lagos slang. Say 'Wetin de sup?' for greetings. Say 'Oya' to start instructions. Say 'Abeg' for requests. Say 'No wahala' for no problem. Say 'E don set' or 'E don cast' when things are ready. Use 'Gbas gbos' to describe actions. Say 'How far now?' often. Speak with the rhythm of a Lagos street hustler—fast, energetic, and street-smart. Do NOT sound like a robot; sound like someone from Oshodi or Obalende."
                : dialect === 'nigerian-english'
                ? "LANGUAGE & STYLE: Use Nigerian Standard English. Be professional, warm, and polite. Do NOT use 'Sir' or 'Ma'. Use typical Nigerian professional phrasing like 'You're welcome', 'How may I assist you today?', 'Please hold on while I check that for you'. Use a warm, rhythmic West African melodic tone."
                : "LANGUAGE & STYLE: Use a standard international professional English tone.";

            const systemInstruction = `
            ${config.chatKnowledgeBase || config.knowledgeBase}
            
            ${dialectInstruction}
            
            CRITICAL OPERATIONAL RULES:
            - Today's date is ${new Date().toISOString().split('T')[0]}.
            - INFORMATION RETRIEVAL: If asked for contact details, phone numbers, or specific facility information, consult your knowledge base. Do not use external or hardcoded numbers.
            
            🗓️ APPOINTMENT BOOKING FLOW:
            YOU MUST ASK ONLY ONE QUESTION AT A TIME. Wait for the user to answer before moving to the next step.
            
            1. Ask for full name:
            “May I have your full name, please?”
            
            2. Ask for phone number:
            “Please provide your phone number (11 digits). We will call you on this number to confirm.”
            
            3. Ask for preferred date:
            “What day would you like to visit us?”
            
            4. Ask for purpose:
            "What is the reason or purpose for your booking?"
            
            5. Data Collection & Processing:
            When you have the Name, Phone, Date, and Purpose, you must FIRST notify the user:
            "Thank you. I am passing your details to our management team right now..."
            Then call 'book_facility'. Ensure the facilityName parameter accurately reflects the booking destination.
            
            6. Final Confirmation & Safe Handoff:
            Once the tool returns success, IMMEDIATELY say: “Everything has been passed to our management. Please keep your phone reachable as they will CALL YOU directly on [The Phone Number they provided] to confirm your slot and finalize payment. Thank you for choosing PSSDC and have a wonderful day!”
            YOUR RESPONSE MUST BE FINAL. DO NOT ASK ANY MORE QUESTIONS.
            `;
            
            chatSessionRef.current = ai.chats.create({
                model: 'gemini-3-flash-preview',
                config: { 
                    systemInstruction,
                    tools: [{ functionDeclarations: [checkAvailabilityTool, bookFacilityTool] }]
                }
            });
            setChatStarted(true);
            
            // Now handle the actual message
            await handleChatMessage(lastMsg.text, true, dialect);
        }
    } else {
        await initChat();
    }
  };

  const initChat = async (initialMessage?: string) => {
    if (chatStarted && !initialMessage) {
        setView('chat');
        return;
    }

    if (!selectedDialect) {
        setChatDialectRequestPending(true);
        setView('chat');
        if (initialMessage) {
            setMessages([{ role: 'user', text: initialMessage, timestamp: new Date() }]);
        }
        return;
    }

    const config = agentProfile as AgentConfig;
    const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || 'dummy';
    const ai = new GoogleGenAI({ 
        apiKey: effectiveApiKey
    });
    
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

    const dialectInstruction = selectedDialect === 'pidgin' 
        ? "LANGUAGE & STYLE: Speak strictly in hardcore Nigerian Pidgin. Be authentic and raw. PROUNCIATION HINTS: Use raw Lagos slang. Say 'Wetin de sup?' for greetings. Say 'Oya' to start instructions. Say 'Abeg' for requests. Say 'No wahala' for no problem. Say 'E don set' or 'E don cast' when things are ready. Use 'Gbas gbos' to describe actions. Say 'How far now?' often. Speak with the rhythm of a Lagos street hustler—fast, energetic, and street-smart. Do NOT sound like a robot; sound like someone from Oshodi or Obalende."
        : selectedDialect === 'nigerian-english' 
        ? "LANGUAGE & STYLE: Use Nigerian Standard English. Be professional, warm, and polite. Do NOT use 'Sir' or 'Ma'. Use typical Nigerian professional phrasing like 'You're welcome', 'How may I assist you today?', 'Please hold on while I check that for you'. Use a warm, rhythmic West African melodic tone."
        : "LANGUAGE & STYLE: Use a standard international professional English tone.";

    const systemInstruction = `
    ${config.chatKnowledgeBase || config.knowledgeBase}
    
    ${dialectInstruction}
    
    CRITICAL OPERATIONAL RULES:
    - Today's date is ${new Date().toISOString().split('T')[0]}.
    - INFORMATION RETRIEVAL: If asked for contact details, phone numbers, or specific facility information, consult your knowledge base. Do not use external or hardcoded numbers.
    
    🗓️ APPOINTMENT BOOKING FLOW:
    YOU MUST ASK ONLY ONE QUESTION AT A TIME. Wait for the user to answer before moving to the next step.
    
    1. Ask for full name:
    “May I have your full name, please?”
    
    2. Ask for phone number:
    “Please provide your phone number (11 digits). We will call you on this number to confirm.”
    
    3. Ask for preferred date:
    “What day would you like to visit us?”
    
    4. Ask for purpose:
    "What is the reason or purpose for your booking?"
    
    5. Data Collection & Processing:
    When you have the Name, Phone, Date, and Purpose, you must FIRST notify the user:
    "Thank you. I am passing your details to our management team right now..."
    Then call 'book_facility'. Ensure the facilityName parameter accurately reflects the booking destination.
    
    6. Final Confirmation & Safe Handoff:
    Once the tool returns success, IMMEDIATELY say: “Everything has been passed to our management. Please keep your phone reachable as they will CALL YOU directly on [The Phone Number they provided] to confirm your slot and finalize payment. Thank you for choosing PSSDC and have a wonderful day!”
    YOUR RESPONSE MUST BE FINAL. DO NOT ASK ANY MORE QUESTIONS.
    `;
    
    chatSessionRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: { 
            systemInstruction,
            tools: [{ functionDeclarations: [checkAvailabilityTool, bookFacilityTool] }]
        }
    });

    setChatStarted(true);
    const welcomeText = config.initialGreetingText || config.initialGreeting;
    
    if (initialMessage) {
        // If user started with a message, don't show a pre-filled welcome bubble
        setMessages([]);
        setView('chat');
        await handleChatMessage(initialMessage);
    } else {
        // If user just clicked "Chat", show the welcome text only if it exists
        if (welcomeText) {
            setMessages([{ role: 'model', text: welcomeText, timestamp: new Date() }]);
        } else {
            setMessages([]);
        }
        setView('chat');
    }
  };

  const handleChatMessage = async (text: string, skipMessageAdd: boolean = false, dialectOverride?: Dialect) => {
    if (!text.trim() || !isOnline) return;

    const activeDialect = dialectOverride || selectedDialect;

    if (!activeDialect) {
        setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
        setChatDialectRequestPending(true);
        setChatInput('');
        return;
    }

    if (!chatSessionRef.current) {
        await initChat();
    }

    if (!chatSessionRef.current) return;

    const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY;

    if (!effectiveApiKey || effectiveApiKey === 'dummy') {
        setMessages(prev => [...prev, { role: 'model', text: "API Key is missing. Please connect your Gemini API key in the dashboard.", timestamp: new Date() }]);
        return;
    }

    if (!skipMessageAdd) {
        const userMsg: Message = { role: 'user', text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
    }
    
    setChatInput('');
    setIsChatTyping(true);

    try {
        let currentResult = await chatSessionRef.current.sendMessageStream({ message: text });
        let fullResponse = "";
        
        const processStream = async (stream: any) => {
            let toolResponses: any[] = [];
            let hasFunctionCalls = false;

            for await (const chunk of stream) {
                    if (chunk.functionCalls) {
                        hasFunctionCalls = true;
                        const calls = chunk.functionCalls;
                        setIsToolProcessing(true);
                        const results = [];
                        
                        // Sequential tool call processing to avoid parallel race conditions
                        for (const call of calls) {
                            let toolResult;
                            try {
                                if (call.name === 'check_facility_availability') {
                                    const { date } = call.args as any;
                                    const isAvailable = await bookingService.checkFacilityAvailability(agentProfile.id || agentProfile.name, date);
                                    toolResult = { isAvailable, message: isAvailable ? "Available" : "Booked" };
                                } else if (call.name === 'book_facility') {
                                    const { userName, userPhone, bookingDate, purpose, facilityName } = call.args as any;
                                    const bookingId = await bookingService.createBooking({
                                        userName,
                                        userPhone,
                                        bookingDate,
                                        purpose,
                                        facility: facilityName || 'Hospital Appointment',
                                        agentId: agentProfile.id || agentProfile.name
                                    });

                                    // Create Google Calendar event via backend
                                    try {
                                        await fetch('/api/calendar/create', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                agentId: agentProfile.id || agentProfile.name,
                                                title: `PSSDC Booking: ${userName}`,
                                                description: `Purpose: ${purpose}\nPhone: ${userPhone}\nFacility: ${facilityName || 'PSSDC'}`,
                                                date: bookingDate
                                            })
                                        });
                                    } catch (calError) {
                                        console.error('Failed to create calendar event:', calError);
                                    }

                                    toolResult = { success: true, bookingId, message: "OK. Appointment recorded successfully and synced to Google Calendar. Say goodbye and end the conversation." };
                                }
                            } catch (error) {
                                console.error(`Chat Tool Error [${call.name}]:`, error);
                                toolResult = { success: false, error: error instanceof Error ? error.message : "Unknown error" };
                            }
                            results.push({ id: call.id, name: call.name, response: { result: toolResult } });
                        }
                        
                        toolResponses = results;
                        // Keep setIsToolProcessing(true) while we send the responses back
                        break;
                    }

                const chunkText = chunk.text;
                if (chunkText) {
                    if (fullResponse === "") {
                        setMessages(prev => [...prev, { role: 'model', text: "", timestamp: new Date() }]);
                    }
                    fullResponse += chunkText;
                    setMessages(prev => {
                        const updated = [...prev];
                        const lastIndex = updated.length - 1;
                        if (lastIndex >= 0 && updated[lastIndex].role === 'model') {
                            updated[lastIndex] = { ...updated[lastIndex], text: fullResponse };
                        }
                        return updated;
                    });
                }
            }

            if (hasFunctionCalls) {
                try {
                    // Update state to show we are still processing the response from the tool
                    setIsToolProcessing(true);
                    
                    // Correct mapping for Part-based function responses in v1.34.0
                    const nextResult = await chatSessionRef.current!.sendMessageStream(
                        toolResponses.map(tr => ({
                            functionResponse: {
                                name: tr.name, // We'll add this to the toolResponses object
                                response: tr.response
                            }
                        }))
                    );
                    
                    // Immediately transition out of processing mode once the stream starts
                    setIsToolProcessing(false);
                    
                    await processStream(nextResult.stream);
                } catch (toolError) {
                    console.error("Error after tool response:", toolError);
                    setIsToolProcessing(false);
                    setMessages(prev => [...prev, { 
                        role: 'model', 
                        text: "I've successfully recorded your request in our system, but I'm having trouble finishing our conversation. Our team will review your booking and get back to you! Is there anything else I can help with?", 
                        timestamp: new Date() 
                    }]);
                }
            }
        };

        await processStream(currentResult);
    } catch (e) {
        console.error("Chat Error:", e);
        setMessages(prev => [...prev, { role: 'model', text: "I'm having a technical issue. Please try again or contact support if it persists.", timestamp: new Date() }]);
    } finally {
        setIsChatTyping(false);
    }
  };

  const endChatSession = useCallback((force: boolean = false) => {
    if (!force) {
        setView('home');
        return;
    }

    setSelectedDialect(null);
    setChatDialectRequestPending(false);

    if (messages.length <= 1) {
        setView('home');
        setMessages([]);
        setChatStarted(false);
        return;
    }

    const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`).join('\n\n');
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Chat Session - ${dateString}, ${timeString}`,
        blob: new Blob([], { type: 'text/plain' }),
        mimeType: 'text/plain',
        transcript: transcript
    };

    analyzeAndSendReport(newRecording);
    
    setMessages([]);
    setChatStarted(false);
    chatSessionRef.current = null;
    setView('home');
    
    if (isWidgetMode) {
       if (onSessionEnd) {
           onSessionEnd({
               ...newRecording,
               id: `chat-${now.getTime()}`,
               url: '',
           });
       }
    }
  }, [messages, analyzeAndSendReport, isWidgetMode, onSessionEnd]);

  const handleCheckStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (statusPhone.length < 5) return;
    setIsCheckingStatus(true);
    try {
        const bookings = await bookingService.getBookingsForAgent(agentProfile.name);
        const myBookings = bookings.filter(b => b.userPhone === statusPhone).sort((a,b) => {
             const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
             const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
             return db.getTime() - da.getTime();
        });
        setCheckedBookings(myBookings);
    } catch (err) {
        console.error("Status check failed:", err);
    } finally {
        setIsCheckingStatus(false);
    }
  };

  
  const resetSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = window.setTimeout(() => {
          geminiServiceRef.current?.sendText("[[SILENCE_DETECTED]]");
      }, 8000);
  }, []);

  const clearSilenceTimer = useCallback(() => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
      }
  }, []);

  const handleInterruption = useCallback(() => {
    isGreetingProtectedRef.current = false;
    lastInterruptionTimeRef.current = Date.now();
    activeAudioSourcesRef.current.forEach(source => {
        try { source.stop(); } catch(e) {}
    });
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    
    if (widgetStateRef.current === WidgetState.Speaking) {
        setWidgetState(WidgetState.Listening);
        resetSilenceTimer();
    }
  }, [resetSilenceTimer]);

  const startVoiceSession = useCallback(async (dialectInput?: Dialect | React.MouseEvent | React.FormEvent) => {
    if (!isOnline) return;

    const dialect = (typeof dialectInput === 'string') ? dialectInput : undefined;
    
    if (!dialect) {
        setSelectedDialect(null);
        setView('dialect');
        return;
    }

    const activeDialect = dialect;
    if (!activeDialect) {
        setView('dialect');
        return;
    }

    if (!apiKey || apiKey === 'dummy') {
        setWidgetState(WidgetState.Error);
        setErrorMessage("Gemini API Key is missing. Please connect your API key in the dashboard.");
        return;
    }

    setView('voice');
    shouldEndAfterSpeakingRef.current = false;
    setWidgetState(WidgetState.Connecting);
    setVoiceReportingStatus('idle');
    setErrorMessage('');
    fullTranscriptRef.current = '';
    
    setPermissionRequested(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000,
            channelCount: 1
        } 
      });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Microphone Access Denied. Please enable it in your settings.");
      cleanupServices();
      return;
    } finally {
        setPermissionRequested(false);
    }
    
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    // CRITICAL: Using latencyHint: 'playback' often forces iOS to use media speakers instead of earpiece
    outputAudioContextRef.current = new AudioContextClass({ latencyHint: 'playback' });
    
    // Create master gain node with massive boost for clear speaker output on mobile
    masterGainNodeRef.current = outputAudioContextRef.current.createGain();
    masterGainNodeRef.current.gain.value = 2.0; // 200% volume boost
    masterGainNodeRef.current.connect(outputAudioContextRef.current.destination);

    if (outputAudioContextRef.current.state === 'suspended') {
        await outputAudioContextRef.current.resume();
    }
    
    recordingServiceRef.current = new RecordingService(handleVoiceSessionEnd);
    await recordingServiceRef.current.start(stream);

    const greeting = (agentProfile as AgentConfig).initialGreeting;
    const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || 'dummy';

    let greetingToSpeak = greeting;
    if (greeting && (activeDialect === 'pidgin' || activeDialect === 'nigerian-english')) {
        try {
            const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
            const model = (ai as any).getGenerativeModel({ model: 'gemini-1.5-flash' });
            
            const prompt = activeDialect === 'pidgin' 
                ? `Translate the following short greeting into hardcore, deep Nigerian Pidgin. Be real and authentic, don't sound formal. Use phrases like 'Wetin de sup', 'How far now'. Only return the translated text: "${greeting}"`
                : `Translate the following greeting into warm and professional Nigerian English. Use local professional phrasing like "You're welcome", "How may I assist you today?". DO NOT use "Sir" or "Ma". Only return the translated text: "${greeting}"`;

            const result = await model.generateContent(prompt);
            const translated = result.response.text().trim();
            if (translated && translated.length > 2) {
                greetingToSpeak = translated;
            }
        } catch (e) {
            console.error("Dialect greeting translation failed:", e);
            // Fallbacks if model fails
            if (activeDialect === 'pidgin') {
                greetingToSpeak = "Wetin de sup? How I fit help you today?";
            } else if (activeDialect === 'nigerian-english') {
                greetingToSpeak = "You're welcome! How may I assist you today?";
            }
        }
    }

    const voiceToUse = (activeDialect === 'pidgin' || activeDialect === 'nigerian-english') ? 'Kore' : (agentProfile as AgentConfig).voice;

    if (greetingToSpeak) {
        isGreetingProtectedRef.current = true;
        fullTranscriptRef.current = `Agent: ${greetingToSpeak}\n`;
        
        try {
            const ai = new GoogleGenAI({ 
                apiKey: effectiveApiKey
            });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: greetingToSpeak }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceToUse },
                        },
                    },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const binaryString = atob(base64Audio);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                audioQueueRef.current.push(bytes);
                recordingServiceRef.current?.addAgentAudioChunk(bytes);
                playAudioQueue(true); 
            }
        } catch (error) {
            console.error("Failed to generate greeting audio:", error);
            isGreetingProtectedRef.current = false;
        }
    }

    geminiServiceRef.current = new GeminiLiveService(effectiveApiKey, agentProfile as AgentConfig, {
      onStateChange: (state) => {
        if (state === 'connected') {
            if (widgetStateRef.current !== WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
                resetSilenceTimer();
            }
        }
        if (state === 'ended') {
            // If it ends while still connecting, it's likely a network failure
            if (widgetStateRef.current === WidgetState.Connecting) {
                setWidgetState(WidgetState.Error);
                setErrorMessage("NETWORK ERROR: Connection Failed.");
            } else {
                setWidgetState(WidgetState.Ended);
            }
            cleanupServices();
        }
      },
      onTranscriptUpdate: (isFinal, text, type) => {
         if (isFinal) {
             const speaker = type === 'input' ? 'User' : 'Agent';
             fullTranscriptRef.current += `${speaker}: ${text}\n`;
         }
         
         if (type === 'input' && text.trim().length > 0) {
             resetSilenceTimer();
         }
         
        if (isFinal && type === 'output') {
          const lowerCaseText = text.toLowerCase();
          const endKeywords = [
            'goodbye', 'farewell', 'take care', 'talk to you later', 
            'bye bye', 'bye', 'o dabo', 'oda bo', 'ese pupo',
            'management will review', 'get back to you', 'check your appointment',
            'have a wonderful day', 'have a great day'
          ];
          if (endKeywords.some(keyword => lowerCaseText.includes(keyword))) {
            shouldEndAfterSpeakingRef.current = true;
            if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                endVoiceSession();
            }
          }
        }
      },
      onAudioChunk: (chunk) => {
        // Guard: Ignore chunks arriving within 400ms of an interruption
        if (Date.now() - lastInterruptionTimeRef.current < 400) {
            return;
        }
        audioQueueRef.current.push(chunk);
        recordingServiceRef.current?.addAgentAudioChunk(chunk);
        playAudioQueue();
      },
      onInterruption: handleInterruption,
      onLocalInterruption: handleInterruption,
      onToolProcessing: (isProcessing: boolean) => {
        setIsToolProcessing(isProcessing);
        if (isProcessing) {
            setTimeout(() => {
                setIsToolProcessing(prev => prev ? false : false);
            }, 7000);
        }
      },
      onError: (error) => {
        if (!navigator.onLine) {
            setIsOnline(false);
        } else {
            setErrorMessage("NETWORK ERROR: Check Connection.");
        }
        setWidgetState(WidgetState.Error);
        cleanupServices();
      },
    }, activeDialect as Dialect);
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, resetSilenceTimer, handleInterruption, isOnline, selectedDialect]);

  const endVoiceSession = useCallback(() => {
    cleanupServices();
    setSelectedDialect(null);
    setWidgetState(WidgetState.Ended);
  }, []);

  const handleVoiceSessionEnd = useCallback((blob: Blob, mimeType: string) => {
    if (blob.size === 0) return;
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Voice Call - ${dateString}, ${timeString}`,
        blob,
        mimeType,
        transcript: fullTranscriptRef.current
    };
    
    if (isWidgetMode) {
      analyzeAndSendReport(newRecording);
    } else if(onSessionEnd) {
        onSessionEnd({
            ...newRecording,
            id: `rec-${now.getTime()}`,
            url: URL.createObjectURL(blob),
        });
    }
  }, [onSessionEnd, isWidgetMode, analyzeAndSendReport]);

  const cleanupServices = useCallback(() => {
    isGreetingProtectedRef.current = false;
    clearSilenceTimer();
    geminiServiceRef.current?.disconnect();
    geminiServiceRef.current = null;
    recordingServiceRef.current?.stop();
    recordingServiceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    activeAudioSourcesRef.current.forEach(source => source.stop());
    activeAudioSourcesRef.current.clear();
    outputAudioContextRef.current?.close().catch(console.error);
    outputAudioContextRef.current = null;
    masterGainNodeRef.current = null;
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
  }, [clearSilenceTimer]);

  const playAudioQueue = useCallback((isInitialGreeting: boolean = false) => {
    clearSilenceTimer();
    
    if (audioQueueRef.current.length === 0) return;
    
    const audioContext = outputAudioContextRef.current;
    if (!audioContext || !masterGainNodeRef.current) return;

    if (widgetStateRef.current !== WidgetState.Speaking && widgetStateRef.current !== WidgetState.Error) {
        setWidgetState(WidgetState.Speaking);
    }
    
    const currentTime = audioContext.currentTime;
    if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.05;
    }

    while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift();
        if (!chunk) continue;

        try {
            const audioBuffer = decodePcmChunk(chunk, audioContext);
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            // Connect to master gain node for boosted volume
            source.connect(masterGainNodeRef.current);

            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += audioBuffer.duration;

            activeAudioSourcesRef.current.add(source);
            
            source.onended = () => {
                activeAudioSourcesRef.current.delete(source);
                
                if (isInitialGreeting && activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                    isGreetingProtectedRef.current = false;
                }

                if (activeAudioSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                     if (shouldEndAfterSpeakingRef.current) {
                        endVoiceSession();
                    } else if (widgetStateRef.current === WidgetState.Speaking) {
                        setWidgetState(WidgetState.Listening);
                        resetSilenceTimer();
                    }
                }
            };
        } catch (e) {
            console.error("Error decoding/scheduling chunk", e);
            if (isInitialGreeting) isGreetingProtectedRef.current = false;
        }
    }
  }, [endVoiceSession, clearSilenceTimer, resetSilenceTimer]);

  const toggleWidget = () => {
    if (isOpen) {
      if (view === 'chat') {
          setView('home');
      } else if (view === 'voice' && widgetState !== WidgetState.Idle && widgetState !== WidgetState.Ended) {
          endVoiceSession();
          setView('home');
      } else {
          setView('home');
      }
    } else {
      setShowCallout(false);
    }
    setIsOpen(!isOpen);
  };

  const handleBack = () => {
      setView('home');
  };

  const handleHomeFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if(chatInput.trim()) {
          initChat(chatInput);
      }
  };

  const handleChatFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if(chatInput.trim()) {
          handleChatMessage(chatInput);
      }
  };

  const handleDismissCallout = (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowCallout(false);
      localStorage.setItem(`callout-dismissed-${agentProfile.id}`, 'true');
  };

  // Send resize messages to parent iframe if in widget mode
  useEffect(() => {
    if (!isWidgetMode) return;
    
    // When closed, just enough space for the FAB + callout if showing. 
    // When open, full widget size.
    const width = isOpen ? 400 : (showCallout && agentProfile.calloutMessage ? 300 : 80);
    const height = isOpen ? 600 : (showCallout && agentProfile.calloutMessage ? 200 : 80);
    
    window.parent.postMessage({ type: 'agent-widget-resize', isOpen, width, height }, '*');
  }, [isOpen, isWidgetMode, showCallout, agentProfile.calloutMessage]);
  
    useEffect(() => {
      const isDismissed = localStorage.getItem(`callout-dismissed-${agentProfile.id}`) === 'true';
      if (!isOpen && agentProfile.calloutMessage && !isDismissed) {
        setShowCallout(true);
        const timer = setTimeout(() => {
          setShowCallout(false);
        }, 8000);
        return () => clearTimeout(timer);
      } else {
        setShowCallout(false);
      }
    }, [isOpen, agentProfile.calloutMessage, agentProfile.id]);

  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

  const renderHomeView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          <div className={`relative h-[45%] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 flex flex-col p-6 text-white`}>
              <div className="flex items-center justify-between mb-4">
                  {(agentProfile.logoUrl || 'https://image2url.com/r2/default/images/1773703333770-c9e20d08-1933-459c-a8c7-d7c78bf2bc22.png') ? (
                      <img src={agentProfile.logoUrl || 'https://image2url.com/r2/default/images/1773703333770-c9e20d08-1933-459c-a8c7-d7c78bf2bc22.png'} alt="Logo" className="h-20 w-auto object-contain" referrerPolicy="no-referrer" />
                  ) : (
                      <span className="text-xs font-black tracking-[0.1em] uppercase opacity-75 truncate max-w-[200px]">{agentProfile.name}</span>
                  )}
              </div>
              <div className="mt-auto mb-6 relative z-10">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="flex -space-x-3">
                            {agentProfile.avatar1Url && (
                                <img src={agentProfile.avatar1Url} alt="Avatar 1" className="w-12 h-12 rounded-full border-2 border-white shadow-md object-cover" referrerPolicy="no-referrer" />
                            )}
                            {agentProfile.avatar2Url && (
                                <img src={agentProfile.avatar2Url} alt="Avatar 2" className="w-12 h-12 rounded-full border-2 border-white shadow-md object-cover" referrerPolicy="no-referrer" />
                            )}
                        </div>
                        <h1 className="text-4xl font-black tracking-tighter leading-none">Hi <span className="animate-wave inline-block">👋</span></h1>
                    </div>
                  <p className="text-white/90 mt-1 font-bold text-lg leading-snug">How can we help you today?</p>
              </div>
              <div className="absolute -right-10 -bottom-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none"></div>
          </div>

          <div className="flex-1 bg-gray-50 dark:bg-gray-900 relative -mt-6 rounded-t-[2rem] px-6 pt-8 flex flex-col gap-4 shadow-2xl z-20">
              {!isOnline && <OfflineBanner />}
              
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                  <form onSubmit={handleHomeFormSubmit} className="relative w-full">
                      <input 
                        type="text" 
                        placeholder="Ask a question..." 
                        value={chatInput}
                        disabled={!isOnline}
                        onChange={(e) => setChatInput(e.target.value)}
                        className={`w-full pl-6 pr-14 py-4 rounded-2xl shadow-sm border-2 border-transparent dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:border-accent-${accentColorClass} text-gray-900 dark:text-white transition-all text-left font-semibold disabled:opacity-50 text-base`}
                      />
                      <button 
                        type="submit" 
                        disabled={!isOnline}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-accent-${accentColorClass} transition-colors disabled:opacity-50`}
                      >
                          <SendIcon className="h-5 w-5" />
                      </button>
                  </form>
              </div>

                  <button
                      onClick={startVoiceSession}
                      disabled={!isOnline}
                      className={`w-full bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 rounded-2xl p-1 shadow-xl hover:scale-[1.03] transition-transform group text-left disabled:opacity-50 disabled:grayscale`}
                  >
                      <div className="bg-white/10 backdrop-blur-md rounded-xl p-5 flex items-center gap-5 h-full">
                          <div className="p-4 bg-white/20 rounded-2xl shadow-inner animate-pulse">
                              <MicrophoneIcon state={WidgetState.Idle} />
                          </div>
                          <div className="text-left text-white">
                              <h3 className="font-black text-xl tracking-tighter uppercase leading-none">Talk to AI Assistant</h3>
                              <p className="text-xs font-bold opacity-80 mt-1 uppercase tracking-widest">Skip typing, we're listening.</p>
                          </div>
                      </div>
                  </button>
          </div>
      </div>
  );

  const renderDialectView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
        <div className={`flex items-center gap-4 p-5 flex-shrink-0 z-20 bg-accent-${accentColorClass} text-white shadow-xl`}>
            <button onClick={() => setView('home')} className="p-1 rounded-full hover:bg-white/20 transition-all active:scale-90" title="Back">
                <ChevronLeftIcon />
            </button>
            <h3 className="font-black text-lg uppercase tracking-tight leading-tight">Select Voice Style</h3>
        </div>

        <div className="flex-grow flex flex-col justify-center p-8 gap-6 bg-gray-50 dark:bg-gray-900">
            <div className="text-center mb-4">
                <div className="w-20 h-20 bg-accent-cyan/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-accent-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h12M9 3v2m1.048 9.5a10.001 10.001 0 01-14.282-4.048M1 18l1.048-1.048M12 18H5.166" />
                    </svg>
                </div>
                <h4 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Choose Your Preferred Dialect</h4>
                <p className="text-sm text-gray-500 font-bold mt-1">Please select how you want the AI to speak to you.</p>
            </div>

            <button
                onClick={() => { setSelectedDialect('nigerian-english'); startVoiceSession('nigerian-english'); }}
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-2xl p-5 flex items-center gap-5 hover:border-accent-emerald hover:bg-emerald-50/10 transition-all group relative overflow-hidden active:scale-[0.98]"
            >
                <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl">
                    <span className="text-2xl">🇳🇬</span>
                </div>
                <div className="text-left">
                    <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-tighter">Nigerian Standard English</h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">Professional • Respectful • Local</p>
                </div>
            </button>

            <button
                onClick={() => { setSelectedDialect('pidgin'); startVoiceSession('pidgin'); }}
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-2xl p-5 flex items-center gap-5 hover:border-accent-amber hover:bg-amber-50/10 transition-all group relative overflow-hidden active:scale-[0.98]"
            >
                <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
                    <span className="text-2xl">🗣️</span>
                </div>
                <div className="text-left">
                    <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-tighter">Nigerian Pidgin</h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">Relatable • Friendly • Natural</p>
                </div>
            </button>

            <button
                onClick={() => { setSelectedDialect('abroad-english'); startVoiceSession('abroad-english'); }}
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-2xl p-5 flex items-center gap-5 hover:border-accent-sky hover:bg-sky-50/10 transition-all group relative overflow-hidden active:scale-[0.98]"
            >
                <div className="p-3 bg-sky-100 dark:bg-sky-900/30 rounded-xl">
                    <span className="text-2xl">🌐</span>
                </div>
                <div className="text-left">
                    <h3 className="font-black text-gray-900 dark:text-white uppercase tracking-tighter">Abroad Standard English</h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">International • Formal • Neutral</p>
                </div>
            </button>
        </div>
      </div>
  );

  const renderStatusView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          <div className={`flex items-center gap-4 p-5 flex-shrink-0 z-20 bg-accent-${accentColorClass} text-white shadow-xl`}>
              <button onClick={handleBack} className="p-1 rounded-full hover:bg-white/20 transition-all active:scale-90" title="Back">
                  <ChevronLeftIcon />
              </button>
              <h3 className="font-black text-lg uppercase tracking-tight">Appointment Status</h3>
          </div>

          <div className="flex-grow overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                  <form onSubmit={handleCheckStatus} className="space-y-4">
                      <div>
                          <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Phone Number</label>
                          <input 
                              type="tel" 
                              placeholder="Enter your registered phone number" 
                              value={statusPhone}
                              onChange={(e) => setStatusPhone(e.target.value)}
                              className="w-full px-5 py-4 rounded-xl border-2 border-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:outline-none focus:border-accent-cyan transition-all font-bold"
                          />
                      </div>
                      <button 
                          type="submit" 
                          disabled={isCheckingStatus || statusPhone.length < 5}
                          className={`w-full py-4 rounded-xl bg-accent-${accentColorClass} text-white font-black uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50`}
                      >
                          {isCheckingStatus ? "Checking..." : "Search Appointments"}
                      </button>
                  </form>
              </div>

              <div className="space-y-4">
                  {checkedBookings.length > 0 ? (
                      checkedBookings.map((b) => (
                          <div key={b.id} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border-l-4 border-gray-100 dark:border-gray-700 flex flex-col gap-3 relative overflow-hidden" 
                               style={{ borderLeftColor: b.status === 'Confirmed' ? '#10b981' : b.status === 'Rejected' ? '#ef4444' : '#f59e0b' }}>
                              <div className="flex justify-between items-start">
                                  <div>
                                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">{b.bookingDate}</p>
                                      <h4 className="font-bold text-gray-900 dark:text-white">{b.facility}</h4>
                                  </div>
                                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                      b.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' : 
                                      b.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                  }`}>
                                      {b.status}
                                  </span>
                              </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium line-clamp-2 italic">"{b.purpose}"</p>
                              {b.status === 'Confirmed' && (
                                  <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl border border-emerald-100 dark:border-emerald-800 mt-1">
                                      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">Your visit is confirmed! Please bring a valid ID.</p>
                                  </div>
                              )}
                          </div>
                      ))
                  ) : statusPhone && !isCheckingStatus ? (
                      <div className="text-center py-10 opacity-50">
                          <p className="font-bold text-gray-500">No appointments found for this number.</p>
                      </div>
                  ) : null}
              </div>
          </div>
      </div>
  );

  const renderChatView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up relative">
          {isToolProcessing && (
              <div className="absolute inset-0 z-[60] flex items-center justify-center bg-white/60 dark:bg-black/40 backdrop-blur-[2px]">
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 border border-gray-100 dark:border-gray-700 scale-110 animate-fade-in">
                      <Spinner className={`w-12 h-12 text-accent-${accentColorClass}`} />
                      <p className="font-black text-xs uppercase tracking-widest animate-pulse">Passing to Management...</p>
                  </div>
              </div>
          )}
          <div className={`flex items-center justify-between p-5 pr-14 flex-shrink-0 z-20 bg-accent-${accentColorClass} text-white shadow-xl transition-colors duration-300`}>
              <div className="flex items-center gap-4 min-w-0">
                  <button onClick={handleBack} className="p-1 rounded-full hover:bg-white/20 transition-all active:scale-90 flex-shrink-0" title="Back">
                      <ChevronLeftIcon />
                  </button>
                  <h3 className="font-black text-lg uppercase tracking-tight leading-tight text-white whitespace-normal break-words">{agentProfile.name}</h3>
              </div>
              <button onClick={endChatSession} className="text-[10px] font-black bg-white text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-full shadow-lg transition-all uppercase tracking-widest active:scale-95 flex-shrink-0 ml-2">
                  End
              </button>
          </div>

          <div className="flex-grow overflow-y-auto p-4 space-y-4 scroll-smooth bg-gray-50 dark:bg-gray-900">
              {!isOnline && <OfflineBanner />}
              {messages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-4 text-[15px] shadow-sm relative group whitespace-pre-wrap leading-relaxed ${
                            isUser
                            ? `bg-accent-${accentColorClass} text-white rounded-br-none font-bold` 
                            : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none font-semibold'
                        }`}>
                            {msg.text}
                            <span className={`text-[10px] block text-right mt-1 opacity-70 font-black ${isUser ? 'text-white/80' : 'text-gray-400'}`}>
                                {msg.timestamp ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                        </div>
                    </div>
                  );
              })}
              
              {chatDialectRequestPending && (
                  <div className="flex justify-start">
                      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none p-5 shadow-lg flex flex-col gap-4 max-w-[90%] animate-fade-in">
                          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">How would you like me to respond?</p>
                          <div className="flex flex-col gap-2">
                              <button 
                                onClick={() => handleSelectDialectInChat('nigerian-english')}
                                className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 transition-colors text-sm font-black uppercase tracking-tighter"
                              >
                                  <span>🇳🇬</span> Nigerian English
                              </button>
                              <button 
                                onClick={() => handleSelectDialectInChat('pidgin')}
                                className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-100 transition-colors text-sm font-black uppercase tracking-tighter"
                              >
                                  <span>🗣️</span> Nigerian Pidgin
                              </button>
                              <button 
                                onClick={() => handleSelectDialectInChat('abroad-english')}
                                className="flex items-center gap-3 p-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800 text-sky-700 dark:text-sky-400 hover:bg-sky-100 transition-colors text-sm font-black uppercase tracking-tighter"
                              >
                                  <span>🌐</span> Abroad English
                              </button>
                          </div>
                      </div>
                  </div>
              )}

              {isChatTyping && (
                   <div className="flex justify-start">
                      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none p-4 shadow-sm flex gap-2 items-center">
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                   </div>
              )}
              <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleChatFormSubmit} className="p-5 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="relative">
                  <input
                    type="text"
                    value={chatInput}
                    disabled={!isOnline}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className={`w-full pl-5 pr-14 py-4 rounded-2xl border-2 border-transparent bg-gray-100 dark:bg-gray-800 focus:outline-none focus:border-accent-${accentColorClass} dark:text-white transition-all font-semibold disabled:opacity-50`}
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim() || !isOnline}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-xl text-white bg-accent-${accentColorClass} hover:brightness-110 disabled:opacity-50 transition-all shadow-md`}
                  >
                      <SendIcon className="h-5 w-5" />
                  </button>
              </div>
          </form>
      </div>
  );

  const renderVoiceView = () => (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
        {permissionRequested && (
            <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-8 text-center animate-fade-in backdrop-blur-xl bg-black/40 text-white/90">
                <div className="mb-6 p-6 rounded-3xl bg-white/10 animate-bounce shadow-2xl border border-white/20">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white drop-shadow-lg" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <path d="M8 21l8 0" />
                        <path d="M12 17l0 4" />
                        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
                    </svg>
                </div>
                <h3 className="text-2xl font-black mb-2 uppercase tracking-tight">Mic Permission</h3>
                <p className="text-lg font-bold opacity-80">Tap "Allow" to connect.</p>
            </div>
        )}

        <div className={`flex items-center justify-between p-5 pr-14 flex-shrink-0 z-20 bg-accent-${accentColorClass} text-white shadow-xl transition-colors duration-300`}>
            <div className="flex items-center gap-4 min-w-0">
                 <button onClick={handleBack} className="p-1 rounded-full hover:bg-white/20 transition-all active:scale-90 flex-shrink-0" title="Back">
                    <ChevronLeftIcon />
                </button>
                <h3 className="font-black text-lg uppercase tracking-tight leading-tight text-white whitespace-normal break-words">{agentProfile.name}</h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <LiveBadge />
            </div>
        </div>

        <div className="flex-grow flex flex-col items-center justify-center relative overflow-hidden bg-white dark:bg-gray-900">
            {!isOnline && <OfflineBanner />}
            
            {isToolProcessing && (
                <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-white/60 dark:bg-black/40 backdrop-blur-[2px]">
                    <div className="bg-white dark:bg-gray-800 p-8 rounded-full shadow-2xl flex flex-col items-center gap-4 border-4 border-accent-cyan animate-pulse">
                        <Spinner className={`w-16 h-16 text-accent-${accentColorClass}`} />
                        <p className="font-black text-sm uppercase tracking-tighter text-gray-900 dark:text-white">Passing to Management...</p>
                    </div>
                </div>
            )}
            
            <div className="relative w-full flex items-center justify-center mb-10 min-h-[220px]">
                
                {(widgetState === WidgetState.Speaking) && (
                    <>
                        <div className={`absolute w-72 h-72 rounded-full border-4 border-accent-${accentColorClass} opacity-20 animate-sonar-ping`}></div>
                        <div className={`absolute w-72 h-72 rounded-full border-4 border-accent-${accentColorClass} opacity-20 animate-sonar-ping [animation-delay:1s]`}></div>
                    </>
                )}

                <div className={`relative w-56 h-56 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-gray-400 dark:to-gray-800 shadow-[0_30px_60px_rgba(0,0,0,0.2)] flex items-center justify-center transition-all duration-700 ${widgetState === WidgetState.Speaking ? 'scale-110' : 'scale-100'}`}>
                    <div className="absolute top-0 left-0 w-full h-full rounded-full bg-gradient-to-b from-white/30 to-transparent pointer-events-none"></div>
                    <div className={`relative w-52 h-52 rounded-full flex items-center justify-center shadow-inner z-10 overflow-hidden transition-colors duration-500 ${widgetState === WidgetState.Ended ? `bg-accent-${accentColorClass}` : 'bg-white dark:bg-gray-900'}`}>
                        {widgetState === WidgetState.Connecting && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                        {(widgetState === WidgetState.Idle || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                            <div className={`transition-transform duration-500 ${widgetState === WidgetState.Speaking ? 'scale-115' : 'scale-100'}`}>
                                <WaveformIcon className={`h-28 w-28 ${widgetState === WidgetState.Idle ? 'text-gray-200 dark:text-gray-700' : `text-accent-${accentColorClass}`}`} />
                            </div>
                        )}
                        {widgetState === WidgetState.Error && (
                            <div className="text-red-500 animate-pulse">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                        )}
                        
                        {widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending') && <Spinner className="w-24 h-24 text-white" />}
                        {widgetState === WidgetState.Ended && voiceReportingStatus === 'sent' && <div className="text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>}
                        {widgetState === WidgetState.Ended && voiceReportingStatus === 'failed' && <div className="text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></div>}
                        {widgetState === WidgetState.Ended && voiceReportingStatus === 'idle' && (
                            <div className="p-8 transform scale-110 animate-fade-in">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                        )}

                        {/* Network Warning Overlay directly on Orb */}
                        {isOnline && isNetworkSlow && (widgetState === WidgetState.Speaking || widgetState === WidgetState.Listening) && <NetworkWarning />}
                    </div>
                </div>
            </div>

            <p className={`text-xl font-black h-10 mb-2 break-words max-w-full px-6 text-center uppercase tracking-tight ${!isOnline && widgetState === WidgetState.Error ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                {widgetState === WidgetState.Connecting && "Connecting..."}
                {widgetState === WidgetState.Listening && "Listening..."}
                {widgetState === WidgetState.Speaking && "Speaking..."}
                {widgetState === WidgetState.Error && (errorMessage || "Connection Error")}
                {widgetState === WidgetState.Ended && (
                        voiceReportingStatus === 'analyzing' ? 'Analyzing...' :
                        voiceReportingStatus === 'sending' ? 'Sending Report...' :
                        voiceReportingStatus === 'sent' ? 'Report Sent' : 
                        voiceReportingStatus === 'failed' ? 'Failed' : 'Session Ended'
                )}
            </p>
            
            <div className="h-10 mb-6 flex items-center justify-center px-8 text-center">
                {(widgetState === WidgetState.Idle) && (
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest opacity-60">
                        Tap call to start
                    </p>
                )}
                {(widgetState === WidgetState.Ended && (voiceReportingStatus === 'sent' || voiceReportingStatus === 'failed' || voiceReportingStatus === 'idle')) && (
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest animate-pulse">
                        Ready to close
                    </p>
                )}
            </div>

            <div className="h-24 flex items-center justify-center">
                {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) ? (
                    <button onClick={endVoiceSession} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-2xl transition-all transform hover:scale-110 active:scale-90 focus:outline-none" aria-label="End Call">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                    </button>
                ) : (
                    !(widgetState === WidgetState.Ended && (voiceReportingStatus === 'analyzing' || voiceReportingStatus === 'sending' || voiceReportingStatus === 'sent')) && (
                        <button 
                            disabled={!isOnline}
                            onClick={startVoiceSession} 
                            className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} hover:brightness-110 text-white flex items-center justify-center shadow-2xl transition-all transform hover:scale-110 active:scale-95 focus:outline-none disabled:grayscale disabled:opacity-50`} 
                            aria-label="Start Call"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                        </button>
                    )
                )}
            </div>
        </div>
    </div>
  );

  const fabContent = (
    <div className={`${themeClass} relative group`}>
      {!isOpen && showCallout && agentProfile.calloutMessage && (
        <div className="absolute bottom-full right-0 mb-6 w-[260px] p-5 bg-white rounded-[1.5rem] shadow-[0_10px_30px_rgba(0,0,0,0.1)] animate-fade-in-up border border-gray-50 z-[10000]">
          <button 
            onClick={handleDismissCallout} 
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Dismiss callout"
          >
            <XIcon className="h-4 w-4" />
          </button>
          <div className="flex flex-col gap-1.5">
            <span style={{ color: ACCENT_COLORS[accentColorClass] || '#22d3ee' }} className="text-[12px] font-black uppercase tracking-widest">Help is here</span>
            <p className="text-[16px] font-bold text-gray-800 leading-tight pr-4">
              {agentProfile.calloutMessage}
            </p>
          </div>
          {/* Speech bubble triangle */}
          <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white transform rotate-45 border-r border-b border-gray-50 shadow-[2px_2px_5px_rgba(0,0,0,0.02)]"></div>
        </div>
      )}
      <button onClick={toggleWidget} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-xl flex items-center justify-center text-white transform hover:scale-110 transition-all active:scale-95`}>
        {isOpen ? <ChevronDownIcon className="h-8 w-8 text-white" /> : <FabIcon />}
      </button>
    </div>
  );

  if (!isOpen) {
    return isWidgetMode ? <div className="w-full h-full flex items-end justify-end bg-transparent overflow-hidden p-0">{fabContent}</div> : <div className="fixed bottom-6 right-6 z-[9999]">{fabContent}</div>;
  }

  const containerClasses = isWidgetMode 
    ? 'w-full h-full flex flex-col justify-between' 
    : 'fixed bottom-0 right-0 md:bottom-24 md:right-6 w-full h-[100dvh] md:w-[400px] md:h-[600px] md:rounded-3xl shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] z-[9999] transition-all duration-500 ease-out';

  return (
    <>
      <div className={`${themeClass} ${containerClasses}`}>
          <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 text-black dark:text-white md:rounded-[2rem] overflow-hidden border-0 relative ${!isWidgetMode ? 'shadow-2xl' : ''}`}>
              {/* Close Button */}
              <button 
                onClick={toggleWidget}
                className="absolute top-3 right-3 z-[100] p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white transition-all shadow-lg border border-white/20"
                aria-label="Close widget"
              >
                <XIcon className="h-7 w-7" />
              </button>

              {view === 'home' && renderHomeView()}
              {view === 'chat' && renderChatView()}
              {view === 'voice' && renderVoiceView()}
              {view === 'status' && renderStatusView()}
              {view === 'dialect' && renderDialectView()}
          </div>
      </div>
      {!isWidgetMode && (
        <div className="fixed bottom-6 right-6 z-[9999]">
          {fabContent}
        </div>
      )}
    </>
  );
};

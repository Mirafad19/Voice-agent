
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentProfile, AgentConfig, WidgetState, Recording, ReportingStatus } from '../types';
import { GeminiLiveService } from '../services/geminiLiveService';
import { RecordingService } from '../services/recordingService';
import { Spinner } from './ui/Spinner';
import { GoogleGenAI, Type, Modality, Chat } from '@google/genai';
import { blobToBase64 } from '../utils';
import { decodePcmChunk } from '../utils/audio';

interface AgentWidgetProps {
  agentProfile: AgentProfile | AgentConfig;
  apiKey: string;
  isWidgetMode: boolean;
  onSessionEnd?: (recording: Recording) => void;
}

// --- Icons ---

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

const NetworkIcon = ({ isOnline }: { isOnline: boolean }) => (
    <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 border transition-colors ${isOnline ? 'bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-600' : 'bg-red-100 border-red-200 dark:bg-red-900/30 dark:border-red-800'}`} title={isOnline ? "Network Stable" : "Network Unstable"}>
        <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
        <span className={`text-[10px] font-medium uppercase tracking-wider ${isOnline ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
            {isOnline ? 'LIVE' : 'OFFLINE'}
        </span>
    </div>
);

const ChevronLeftIcon = ({className = "h-6 w-6"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
);

const MicIcon = ({className = "h-6 w-6"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
);

const SendIcon = ({className = "h-5 w-5"}) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
  </svg>
);

// --- Helpers ---

async function getCloudinaryShareableLink(cloudName: string, uploadPreset: string, recording: Omit<Recording, 'id' | 'url'>): Promise<string> {
    const formData = new FormData();
    formData.append('file', recording.blob);
    formData.append('upload_preset', uploadPreset.trim());

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName.trim()}/video/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.error.message;
        if (errorMsg === "Unknown API key") {
            throw new Error(`Cloudinary Error: "Unknown API key". This means the Upload Preset Name (${uploadPreset}) does not exist in your Cloudinary Dashboard. Please check the spelling exactly.`);
        }
        throw new Error(`Cloudinary upload failed: ${errorMsg}`);
    }

    const result = await response.json();
    return result.secure_url;
}

const parseInline = (text: string): React.ReactNode[] => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
             return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return part;
    });
}

const formatMessageText = (text: string) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  
  let inList = false;
  let listItems: React.ReactNode[] = [];

  lines.forEach((line, index) => {
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const content = line.trim().substring(2);
      listItems.push(<li key={`li-${index}`} className="ml-4 pl-1 marker:text-gray-400">{parseInline(content)}</li>);
      inList = true;
    } else {
      if (inList) {
        elements.push(<ul key={`ul-${index}`} className="list-disc mb-2 space-y-1">{listItems}</ul>);
        listItems = [];
        inList = false;
      }
      if (line.trim() === '') {
        if (index > 0) elements.push(<div key={`br-${index}`} className="h-2" />);
      } else {
        elements.push(<p key={`p-${index}`} className="mb-1 leading-relaxed">{parseInline(line)}</p>);
      }
    }
  });
  
  if (inList) {
      elements.push(<ul key={`ul-end`} className="list-disc mb-2 space-y-1">{listItems}</ul>);
  }

  return elements;
};

// --- Component ---

type InteractionMode = 'home' | 'voice' | 'chat';

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
}

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showCallout, setShowCallout] = useState(false);
  
  // Navigation State
  const [mode, setMode] = useState<InteractionMode>('home');

  // --- Voice State ---
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };
  const [reportingStatus, setReportingStatus] = useState<ReportingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // --- Voice Refs ---
  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const recordingServiceRef = useRef<RecordingService | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const shouldEndAfterSpeakingRef = useRef(false);
  const fullTranscriptRef = useRef<string>(''); // Capture full conversation

  // --- Chat State ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatSessionRef = useRef<Chat | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const accentColorClass = agentProfile.accentColor;

  // --- Effects ---

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (mode === 'chat') {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, mode]);

  useEffect(() => {
    if (!isWidgetMode) return;
    if (isOpen) {
      window.parent.postMessage({ type: 'agent-widget-resize', width: 400, height: 600 }, '*');
    } else {
      window.parent.postMessage({ type: 'agent-widget-resize', width: 300, height: 140 }, '*');
    }
  }, [isOpen, isWidgetMode]);
  
  useEffect(() => {
    const calloutShown = sessionStorage.getItem('ai-agent-callout-shown');
    let showTimer: number;
    let hideTimer: number;

    if (!isOpen && !calloutShown && agentProfile.calloutMessage) {
      showTimer = window.setTimeout(() => {
        setShowCallout(true);
        sessionStorage.setItem('ai-agent-callout-shown', 'true');
        hideTimer = window.setTimeout(() => {
          setShowCallout(false);
        }, 5000); 
      }, 1500); 
    }

    if (isOpen) {
        setShowCallout(false);
    }

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isOpen, agentProfile.calloutMessage]);

  // --- Chat Functions ---

  const initChat = useCallback(() => {
      setMode('chat');
      const ai = new GoogleGenAI({ apiKey });
      
      const systemInstruction = agentProfile.chatKnowledgeBase || agentProfile.knowledgeBase;
      
      chatSessionRef.current = ai.chats.create({
          model: 'gemini-2.5-flash',
          config: { systemInstruction }
      });
      
      const greeting = agentProfile.initialGreetingText || agentProfile.initialGreeting;

      if (chatMessages.length === 0 && greeting) {
          setChatMessages([{ role: 'model', text: greeting, timestamp: new Date() }]);
      }
  }, [apiKey, agentProfile, chatMessages.length]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;
    
    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg, timestamp: new Date() }]);
    setIsChatLoading(true);

    try {
        if (!chatSessionRef.current) {
             const ai = new GoogleGenAI({ apiKey });
             const systemInstruction = agentProfile.chatKnowledgeBase || agentProfile.knowledgeBase;
             chatSessionRef.current = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: { systemInstruction }
            });
        }
        const response = await chatSessionRef.current!.sendMessageStream({ message: userMsg });
        
        let fullText = '';
        setChatMessages(prev => [...prev, { role: 'model', text: '', timestamp: new Date() }]);
        
        for await (const chunk of response) {
            const text = chunk.text;
            fullText += text;
            setChatMessages(prev => {
                const newArr = [...prev];
                newArr[newArr.length - 1] = { ...newArr[newArr.length - 1], text: fullText };
                return newArr;
            });
        }
    } catch (err) {
        console.error("Chat error:", err);
        setChatMessages(prev => [...prev, { role: 'model', text: "I'm having trouble connecting right now. Please check your network or try again later.", timestamp: new Date() }]);
    } finally {
        setIsChatLoading(false);
    }
 };

  // --- Voice Functions ---

  const analyzeAndSendReport = useCallback(async (recording: Omit<Recording, 'id' | 'url'>) => {
    const { emailConfig, fileUploadConfig } = agentProfile as AgentConfig;
    if (!emailConfig?.formspreeEndpoint) {
        let detailedError = "Formspree endpoint not configured.";
        if (isWidgetMode) {
          detailedError = "Email report failed: Formspree URL is missing. Please update your agent profile in the dashboard and generate a new embed code.";
        } else {
          detailedError = "Formspree endpoint not configured. Please add it in the Agent Configuration panel.";
        }
        setErrorMessage(detailedError);
        setReportingStatus('failed');
        return;
    }

    setReportingStatus('analyzing');

    let audioLink = 'Not configured';

    // 1. Cloudinary Upload (Soft-Fail)
    if (fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset) {
        try {
            audioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
        } catch (uploadError) {
            console.error("Audio upload to Cloudinary failed:", uploadError);
            audioLink = "Upload unavailable";
        }
    }

    // 2. Gemini Analysis (Soft-Fail)
    // PREFER TRANSCRIPT OVER AUDIO FOR STABILITY
    let analysis = { summary: 'Analysis unavailable due to network/model error.', sentiment: 'N/A', actionItems: [] };
    
    try {
        const ai = new GoogleGenAI({ apiKey });
        
        let contents;
        // Prioritize Text Transcript if available (Faster, Cheaper, More Reliable)
        if (recording.transcript && recording.transcript.length > 50) {
            contents = { parts: [
                { text: `Analyze this call transcript. Return JSON: { summary, sentiment (Positive/Neutral/Negative), actionItems[] }.` },
                { text: `TRANSCRIPT:\n${recording.transcript}` }
            ] };
        } else {
            // Fallback to Audio if transcript is empty/missing
            const audioBase64 = await blobToBase64(recording.blob);
            const cleanMimeType = recording.mimeType.split(';')[0];
            contents = { parts: [
                { text: `Analyze this call audio. Return JSON: { summary, sentiment (Positive/Neutral/Negative), actionItems[] }.` },
                { inlineData: { mimeType: cleanMimeType, data: audioBase64 } },
            ] };
        }
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contents,
            config: {
                responseMimeType: "application/json",
            },
        });
        if (response.text) {
             analysis = JSON.parse(response.text);
        }
    } catch (geminiError) {
         console.warn("AI Analysis failed (proceeding without it):", geminiError);
    }

    // 3. Send Email (Hard-Fail)
    setReportingStatus('sending');

    try {
        const reportData = {
          _subject: `Session Insight Report: ${recording.name}`,
          agent: agentProfile.name,
          sentiment: analysis.sentiment || 'N/A',
          summary: analysis.summary || 'No summary available.',
          actionItems: (analysis.actionItems && analysis.actionItems.length > 0) ? analysis.actionItems.map((item:string) => `- ${item}`).join('\n') : 'None',
          audioLink: audioLink,
          // Optional: You could attach the transcript to the email body if Formspree supports large payloads
        };

        const formspreeResponse = await fetch(emailConfig.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(reportData)
        });

        if (!formspreeResponse.ok) {
            throw new Error('Failed to send report via Formspree.');
        }

        setReportingStatus('sent');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        console.error("Failed to send report:", error);
        setErrorMessage(message);
        setReportingStatus('failed');
    }
  }, [agentProfile, apiKey, isWidgetMode]);

  const cleanupServices = useCallback(() => {
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
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
  }, []);

  const endSession = useCallback(() => {
    cleanupServices();
    setWidgetState(WidgetState.Ended);
  }, [cleanupServices]);

  const handleSessionEnd = useCallback((blob: Blob, mimeType: string) => {
    if (blob.size === 0) return;
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Recording - ${dateString}, ${timeString}`,
        blob,
        mimeType,
        transcript: fullTranscriptRef.current, // Attach the captured transcript
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

  const playAudioQueue = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    if (widgetStateRef.current !== WidgetState.Speaking && widgetStateRef.current !== WidgetState.Error) {
        setWidgetState(WidgetState.Speaking);
    }
    
    const audioContext = outputAudioContextRef.current;
    if (!audioContext) {
      isPlayingRef.current = false;
      return;
    }

    const processNextChunk = () => {
        if(audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            if (shouldEndAfterSpeakingRef.current) {
                endSession();
                return;
            }
            if(widgetStateRef.current === WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
            }
            return;
        }

        const chunk = audioQueueRef.current.shift()!;
        const audioBuffer = decodePcmChunk(chunk, audioContext);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        activeAudioSourcesRef.current.add(source);
        source.addEventListener('ended', () => {
            activeAudioSourcesRef.current.delete(source);
        });

        const startTime = Math.max(nextStartTimeRef.current, audioContext.currentTime);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        source.onended = processNextChunk;
    }

    processNextChunk();
  }, [endSession]);

  const handleInterruption = useCallback(() => {
    activeAudioSourcesRef.current.forEach(source => {
      source.stop();
    });
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
    if (widgetStateRef.current === WidgetState.Speaking) {
        setWidgetState(WidgetState.Listening);
    }
  }, []);

  const startSession = useCallback(async () => {
    if (!navigator.onLine) {
        setWidgetState(WidgetState.Error);
        setErrorMessage("No internet connection.");
        return;
    }

    shouldEndAfterSpeakingRef.current = false;
    setWidgetState(WidgetState.Connecting);
    setReportingStatus('idle');
    setErrorMessage('');
    fullTranscriptRef.current = ''; // Reset transcript

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Failed to get microphone access.");
      cleanupServices();
      return;
    }
    
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    recordingServiceRef.current = new RecordingService(handleSessionEnd);
    await recordingServiceRef.current.start(stream);

    // VOICE GREETING LOGIC
    const greeting = (agentProfile as AgentConfig).initialGreeting;
    if (greeting) {
        // Append Agent Greeting to transcript
        fullTranscriptRef.current += `Agent: ${greeting}\n`;
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: greeting }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: (agentProfile as AgentConfig).voice },
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
                playAudioQueue();
            }
        } catch (error) {
            console.error("Failed to generate greeting audio:", error);
        }
    }

    geminiServiceRef.current = new GeminiLiveService(apiKey, agentProfile as AgentConfig, {
      onStateChange: (state) => {
        if (state === 'connected') {
            if (widgetStateRef.current !== WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
            }
        }
        if (state === 'ended') {
            setWidgetState(WidgetState.Ended);
            cleanupServices();
        }
      },
      onTranscriptUpdate: (isFinal, text, type) => {
        if (isFinal) {
             const prefix = type === 'input' ? 'User: ' : 'Agent: ';
             fullTranscriptRef.current += `${prefix}${text}\n`;
             
             if (type === 'output') {
                const lowerCaseText = text.toLowerCase();
                const endKeywords = ['goodbye', 'farewell', 'take care', 'talk to you later', 'bye bye', 'bye'];
                if (endKeywords.some(keyword => lowerCaseText.includes(keyword))) {
                    shouldEndAfterSpeakingRef.current = true;
                }
             }
        }
      },
      onAudioChunk: (chunk) => {
        audioQueueRef.current.push(chunk);
        recordingServiceRef.current?.addAgentAudioChunk(chunk);
        playAudioQueue();
      },
      onInterruption: handleInterruption,
      onError: (error) => {
        setWidgetState(WidgetState.Error);
        setErrorMessage(error);
        cleanupServices();
      },
    });
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, cleanupServices, handleSessionEnd, playAudioQueue, handleInterruption]);
  
  // --- Navigation & Helper Functions ---

  const handleBack = () => {
    if (mode === 'voice') {
        endSession();
        setWidgetState(WidgetState.Idle);
    }
    setMode('home');
  };

  const toggleWidget = () => {
    if (isOpen) {
      endSession();
      setMode('home');
    }
    setIsOpen(!isOpen);
  };
  
  const getStatusText = () => {
    if (!isOnline) return "Network Connection Lost";
    
    if (widgetState === WidgetState.Ended) {
        switch(reportingStatus) {
            case 'analyzing': return 'Analyzing & uploading...';
            case 'sending': return 'Sending report...';
            case 'sent': return 'Report sent successfully!';
            case 'failed': return errorMessage || 'Failed to generate report.';
            default: return 'Session Ended';
        }
    }
    switch(widgetState){
        case WidgetState.Connecting: return "Connecting...";
        case WidgetState.Listening: return "Listening...";
        case WidgetState.Speaking: return "Speaking...";
        case WidgetState.Error: return errorMessage || "An error occurred";
        default: return "Ready to talk";
    }
  }
  
  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

  // --- Render Views ---

  // 1. Home / Selection View
  const renderHomeView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          {/* Hero Header */}
          <div className={`relative h-[40%] bg-gradient-to-br from-accent-${accentColorClass} to-gray-900 flex flex-col p-6 text-white`}>
              <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold tracking-widest uppercase opacity-80">{agentProfile.name}</span>
              </div>
              <div className="mt-auto mb-6 relative z-10">
                  <h1 className="text-4xl font-bold">Hi <span className="animate-wave inline-block">👋</span></h1>
                  <p className="text-white/80 mt-2 font-medium">How can we help you today?</p>
              </div>
              {/* Decorative Glow */}
              <div className="absolute -right-10 -bottom-20 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none"></div>
          </div>

          {/* Action Body */}
          <div className="flex-1 bg-gray-50 dark:bg-gray-900 relative -mt-6 rounded-t-3xl px-6 pt-8 flex flex-col gap-4">
              
              {/* Fake Search Bar -> Chat */}
              <button 
                  onClick={initChat}
                  className="w-full bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-center justify-between group hover:shadow-md transition-all text-left"
              >
                  <span className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">Ask a question...</span>
                  <div className={`p-2 rounded-full bg-gray-100 dark:bg-gray-700 group-hover:bg-accent-${accentColorClass} transition-colors`}>
                      <SendIcon className={`h-4 w-4 text-gray-500 dark:text-gray-400 group-hover:text-white`} />
                  </div>
              </button>

              {/* Voice Card */}
              <button
                  onClick={() => setMode('voice')}
                  className={`w-full bg-gradient-to-r from-accent-${accentColorClass} to-gray-800 rounded-xl p-1 shadow-md hover:scale-[1.02] transition-transform group`}
              >
                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 flex items-center gap-4 h-full">
                      <div className="p-3 bg-white/20 rounded-full animate-pulse">
                          <MicIcon className="h-6 w-6 text-white" />
                      </div>
                      <div className="text-left text-white">
                          <h3 className="font-bold text-lg">Talk to AI Assistant</h3>
                          <p className="text-xs opacity-90">Skip typing, we're listening.</p>
                      </div>
                  </div>
              </button>
          </div>
      </div>
  );

  // 2. Chat View
  const renderChatView = () => (
      <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 animate-fade-in-up">
          {/* Header Extension for Chat */}
          <div className={`h-1 bg-gradient-to-r from-accent-${accentColorClass} to-gray-200 dark:to-gray-800 flex-shrink-0`} />

          {/* Chat Messages */}
          <div className="flex-grow overflow-y-auto p-4 space-y-4 scroll-smooth bg-gray-50 dark:bg-gray-900">
              {chatMessages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm relative group ${
                            isUser
                            ? `bg-accent-${accentColorClass} text-white rounded-br-none` 
                            : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none'
                        }`}>
                            <div className={isUser ? '' : 'markdown-body'}>
                                {isUser ? msg.text : formatMessageText(msg.text)}
                            </div>
                            <span className={`text-[10px] block text-right mt-1 opacity-70 ${isUser ? 'text-white/80' : 'text-gray-400'}`}>
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    </div>
                  );
              })}
              {isChatLoading && (
                   <div className="flex justify-start">
                      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none p-4 shadow-sm flex gap-1 items-center">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                   </div>
              )}
              <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="relative">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className="w-full pl-4 pr-12 py-3 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-white transition-shadow"
                  />
                  <button 
                    type="submit"
                    disabled={!chatInput.trim() || isChatLoading}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full text-white bg-accent-${accentColorClass} hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all`}
                  >
                      <SendIcon className="h-4 w-4" />
                  </button>
              </div>
          </form>
      </div>
  );

  // 3. Voice View
  const renderVoiceView = () => (
    <div className="flex-grow flex flex-col items-center justify-center p-6 text-center relative overflow-hidden animate-fade-in-up bg-white dark:bg-gray-900">
        {!isOnline && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 z-30 flex flex-col items-center justify-center backdrop-blur-sm">
                <div className="bg-red-100 dark:bg-red-900/50 p-4 rounded-xl border border-red-200 dark:border-red-700 max-w-[80%]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600 dark:text-red-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
                    </svg>
                    <h4 className="font-bold text-red-800 dark:text-red-200">Network Unstable</h4>
                    <p className="text-xs text-red-700 dark:text-red-300 mt-1">Check your internet connection.</p>
                </div>
            </div>
        )}

        <div className="relative w-full flex items-center justify-center mb-8 min-h-[200px]">
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-accent-${accentColorClass} opacity-10 blur-[60px] rounded-full`}></div>

            {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                <>
                    <div className={`absolute w-64 h-64 rounded-full border-2 border-accent-${accentColorClass} opacity-20 animate-sonar-ping`}></div>
                    <div className={`absolute w-64 h-64 rounded-full border-2 border-accent-${accentColorClass} opacity-20 animate-sonar-ping [animation-delay:1s]`}></div>
                </>
            )}

            <div className={`relative w-48 h-48 rounded-full bg-gradient-to-br from-accent-${accentColorClass} to-gray-300 dark:to-gray-800 shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all duration-500 ${widgetState === WidgetState.Speaking ? 'scale-105' : 'scale-100'}`}>
                <div className="absolute top-0 left-0 w-full h-full rounded-full bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                <div className="relative w-44 h-44 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center shadow-inner z-10 overflow-hidden">
                    {widgetState === WidgetState.Connecting && <Spinner className={`w-20 h-20 text-accent-${accentColorClass}`} />}
                    {widgetState === WidgetState.Idle && (
                        <WaveformIcon className={`h-24 w-24 text-gray-300 dark:text-gray-600`} />
                    )}
                    {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                        <div className={`transition-transform duration-300 ${widgetState === WidgetState.Speaking ? 'scale-110' : 'scale-100'}`}>
                            <WaveformIcon className={`h-24 w-24 text-accent-${accentColorClass}`} />
                        </div>
                    )}
                    {widgetState === WidgetState.Error && <div className="text-red-500 animate-pulse"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && (reportingStatus === 'analyzing' || reportingStatus === 'sending') && <Spinner className={`w-20 h-20 text-accent-${accentColorClass}`} />}
                    {widgetState === WidgetState.Ended && reportingStatus === 'sent' && <div className="text-green-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && reportingStatus === 'failed' && <div className="text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                </div>
            </div>
        </div>

        <p className="text-lg font-medium text-gray-700 dark:text-gray-200 h-8 mb-2 break-words max-w-full px-2">{getStatusText()}</p>
        
        <div className="h-10 mb-4 flex items-center justify-center">
            {(widgetState === WidgetState.Idle || (widgetState === WidgetState.Ended && reportingStatus === 'idle')) && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 transition-opacity duration-500">
                    Click the call button to start.
                </p>
            )}
            {(widgetState === WidgetState.Ended && (reportingStatus === 'sent' || reportingStatus === 'failed')) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 transition-opacity duration-500">
                You may now close the widget.
                </p>
            )}
        </div>

        <div className="h-20 flex items-center justify-center">
            {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) ? (
                <button onClick={endSession} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-red-300 dark:focus:ring-red-900" aria-label="End Call">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                </button>
            ) : (
                !(widgetState === WidgetState.Ended && (reportingStatus === 'analyzing' || reportingStatus === 'sending' || reportingStatus === 'sent')) && (
                    <button onClick={startSession} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} hover:brightness-110 text-white flex items-center justify-center shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-offset-2`} aria-label={widgetState === WidgetState.Error || (widgetState === WidgetState.Ended && reportingStatus === 'failed') ? "Retry" : "Start Call"}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                    </button>
                )
            )}
        </div>
    </div>
  );

  // --- Main Render ---

  if (!isOpen) {
    const fabContent = (
      <div className={`${themeClass} relative group`}>
        {showCallout && agentProfile.calloutMessage && (
          <div className="absolute bottom-full right-0 mb-3 w-max max-w-[200px] px-4 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl shadow-xl text-left text-sm animate-fade-in-up border border-gray-100 dark:border-gray-700">
            <p>{agentProfile.calloutMessage}</p>
            <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white dark:bg-gray-800 transform rotate-45 border-b border-r border-gray-100 dark:border-gray-700"></div>
          </div>
        )}
        <button onClick={toggleWidget} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-lg flex items-center justify-center text-white transform hover:scale-110 transition-transform animate-pulse`}>
          <FabIcon />
        </button>
      </div>
    );
    return isWidgetMode ? <div className="w-full h-full p-2 flex items-end justify-end bg-transparent">{fabContent}</div> : <div className="fixed bottom-5 right-5 z-50">{fabContent}</div>;
  }

  return (
    <div className={`${themeClass} ${isWidgetMode ? 'w-full h-full' : 'fixed bottom-24 right-5 w-96 h-[600px] rounded-2xl shadow-2xl z-40'}`}>
        <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 text-black dark:text-white rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700`}>
            {/* Widget Header */}
            <div className={`flex items-center justify-between p-4 flex-shrink-0 z-20 ${mode === 'home' ? 'absolute top-0 left-0 w-full text-white' : 'border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md'}`}>
                <div className="flex items-center gap-2">
                    {mode !== 'home' && (
                        <button onClick={handleBack} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" title="Back">
                            <ChevronLeftIcon />
                        </button>
                    )}
                    {mode !== 'home' && (
                       <h3 className="font-bold text-lg truncate max-w-[180px]">{agentProfile.name}</h3>
                    )}
                    {mode === 'voice' && <NetworkIcon isOnline={isOnline} />}
                </div>
                <button onClick={toggleWidget} className={`p-1 rounded-full transition-colors ${mode === 'home' ? 'hover:bg-white/20 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            {/* Widget Content Body */}
            <div className="flex-grow flex flex-col relative overflow-hidden bg-gray-50/50 dark:bg-gray-900/50">
                {mode === 'home' && renderHomeView()}
                {mode === 'voice' && renderVoiceView()}
                {mode === 'chat' && renderChatView()}
            </div>
        </div>
    </div>
  );
};

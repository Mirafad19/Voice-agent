
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AgentWidget } from './components/AgentWidget';
import { AgentProfile, AgentConfig } from './types';
import { safeAtob } from './utils';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Spinner } from './components/ui/Spinner';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}
const root = ReactDOM.createRoot(rootElement);

interface WidgetLoaderProps {
  configOrId: string;
  apiKey: string | null;
}

const WidgetLoader: React.FC<WidgetLoaderProps> = ({ configOrId, apiKey }) => {
  const [profile, setProfile] = useState<AgentProfile | AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Try to see if it is a legacy JSON config encoded in base64
    try {
      if (!configOrId.startsWith('custom-') && !configOrId.startsWith('fallback-')) {
        const decoded = safeAtob(configOrId);
        const parsed = JSON.parse(decoded) as AgentProfile;
        if (parsed && typeof parsed === 'object' && (parsed.id || parsed.name)) {
          setProfile(parsed);
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      // Not a base64 encoded JSON, proceed to treat it as a profile ID
    }

    // 2. Treat as profile ID and fetch from Firestore
    const fetchProfile = async () => {
      try {
        const docRef = doc(db, 'agents', configOrId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProfile(docSnap.data() as AgentProfile);
        } else {
          setError(`Agent profile config not found for ID: ${configOrId}`);
        }
      } catch (err: any) {
        console.error("Error fetching agent profile:", err);
        setError(`Failed to load agent configuration: ${err.message || err}`);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [configOrId]);

  if (loading) {
    return (
      <div className="flex w-screen h-screen items-center justify-center bg-transparent">
        <Spinner className="w-10 h-10 text-emerald-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', color: '#ef4444', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #fee2e2', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
        <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 'bold' }}>Configuration Error</h4>
        <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{error}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ padding: '1rem', color: '#ef4444', fontFamily: 'sans-serif', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #fee2e2' }}>
        <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 'bold' }}>Error</h4>
        <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>Could not initialize Agent configuration.</p>
      </div>
    );
  }

  return (
    <AgentWidget
      agentProfile={profile}
      apiKey={apiKey || process.env.GEMINI_API_KEY || ''}
      isWidgetMode={true}
    />
  );
};

const urlParams = new URLSearchParams(window.location.search);
const configParam = urlParams.get('config') || urlParams.get('id');

if (configParam) {
  // Set transparent background and disable scrolling for widget mode
  document.documentElement.style.backgroundColor = 'transparent';
  document.body.style.backgroundColor = 'transparent';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  rootElement.style.height = '100vh';
  
  const apiKeyParam = urlParams.get('apiKey');

  root.render(
    <React.StrictMode>
      <WidgetLoader
        configOrId={configParam}
        apiKey={apiKeyParam}
      />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

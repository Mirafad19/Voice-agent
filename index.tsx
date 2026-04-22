
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AgentWidget } from './components/AgentWidget';
import { AgentConfig } from './types';
import { safeAtob } from './utils';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const urlParams = new URLSearchParams(window.location.search);
const configParam = urlParams.get('config');

// Safe environment variable access for Vite
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    return (window.process?.env?.[key]) || (import.meta.env[`VITE_${key}`]) || '';
  } catch (e) { return ''; }
};

const hidePreloader = () => {
    // @ts-ignore
    if (window.__BOOT_DIAGNOSTICS__) {
        // @ts-ignore
        window.__BOOT_DIAGNOSTICS__.reactMounted = true;
    }
    const preloader = document.getElementById('preloader');
    if (preloader) {
        preloader.style.opacity = '0';
        setTimeout(() => preloader.remove(), 500);
    }
};

const root = createRoot(rootElement);

try {
  // @ts-ignore
  if (window.__BOOT_DIAGNOSTICS__) {
      // @ts-ignore
      window.__BOOT_DIAGNOSTICS__.scriptLoadStarted = true;
  }
  if (configParam) {
    const decodedConfig = safeAtob(configParam);
    const agentConfig: AgentConfig = JSON.parse(decodedConfig || '{}');
    const apiKeyParam = urlParams.get('apiKey');
    
    // Set transparent background for widget mode
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    rootElement.style.height = '100vh';
    
    root.render(
      <React.StrictMode>
        <AgentWidget
          agentProfile={agentConfig}
          apiKey={apiKeyParam || getEnv('GEMINI_API_KEY') || ''}
          isWidgetMode={true}
        />
      </React.StrictMode>
    );
    // Use a small timeout to ensure React has started rendering
    setTimeout(hidePreloader, 100);
  } else {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    setTimeout(hidePreloader, 100);
  }
} catch (globalError) {
  hidePreloader();
  console.error("CRITICAL INITIALIZATION ERROR:", globalError);
  root.render(
    <div style={{ padding: '2rem', color: '#721c24', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '0.5rem', margin: '1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ marginTop: 0 }}>Application Error</h1>
      <p>The application failed to start. This is usually due to an environment configuration issue.</p>
      <pre style={{ fontSize: '0.75rem', marginTop: '1rem', overflowX: 'auto' }}>
        {globalError instanceof Error ? globalError.message : String(globalError)}
      </pre>
      <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
        Try Refreshing
      </button>
    </div>
  );
}

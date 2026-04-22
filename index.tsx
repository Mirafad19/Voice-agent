
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AgentWidget } from './components/AgentWidget';
import { AgentConfig } from './types';
import { safeAtob } from './utils';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}
const root = ReactDOM.createRoot(rootElement);

const urlParams = new URLSearchParams(window.location.search);
const configParam = urlParams.get('config');

// Safe environment variable access for Vite
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    return (typeof process !== 'undefined' && process.env && process.env[key]) || '';
  } catch (e) { return ''; }
};

try {
  if (configParam) {
    const decodedConfig = safeAtob(configParam);
    const agentConfig: AgentConfig = JSON.parse(decodedConfig);
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
  } else {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
} catch (globalError) {
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

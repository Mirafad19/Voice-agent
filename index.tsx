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
const apiKeyParam = urlParams.get('apiKey');

if (configParam && apiKeyParam) {
  try {
    const decodedConfig = safeAtob(configParam);
    const agentConfig: AgentConfig = JSON.parse(decodedConfig);
    
    // Set transparent background for widget mode
    document.body.style.backgroundColor = 'transparent';
    rootElement.style.height = '100vh';
    
    root.render(
      <React.StrictMode>
        <AgentWidget
          agentProfile={agentConfig}
          apiKey={apiKeyParam}
          isWidgetMode={true}
        />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Failed to parse widget config:", error);
    root.render(
      <div style={{ padding: '1rem', color: 'red', fontFamily: 'sans-serif' }}>
        <h2>Error</h2>
        <p>Invalid configuration provided in URL.</p>
      </div>
    );
  }
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

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

if (configParam) {
  try {
    const decodedConfig = safeAtob(configParam);
    const agentConfig: AgentConfig = JSON.parse(decodedConfig);
    const apiKeyParam = urlParams.get('apiKey');

    // Set transparent background for widget mode
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.overflow = 'visible';
    document.body.style.overflow = 'visible';
    rootElement.style.height = '100vh';

    // Prevent zoom in widget mode - lock the viewport
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }
    // Prevent touch zoom gestures on the entire widget
    document.documentElement.style.touchAction = 'manipulation';
    document.body.style.touchAction = 'manipulation';

    root.render(
      <React.StrictMode>
        <AgentWidget
          agentProfile={agentConfig}
          apiKey={apiKeyParam || process.env.GEMINI_API_KEY || ''}
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